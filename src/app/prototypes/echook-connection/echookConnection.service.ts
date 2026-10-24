import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { EchookDecoder, EchookReading } from './echookProtocol';

export interface EchookPort {
  readable: ReadableStream<Uint8Array> | null;
  open(options: { baudRate: number; bufferSize: number }): Promise<void>;
  close(): Promise<void>;
}
interface SerialAccess {
  requestPort(options: { filters: { bluetoothServiceClassId: string }[] }): Promise<EchookPort>;
}
interface Session {
  cancelled: boolean; opened?: boolean; port?: EchookPort;
  reader?: ReadableStreamDefaultReader<Uint8Array>; task?: Promise<void>;
}
export interface EchookState {
  status: 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'error';
  message: string; readings: EchookReading[]; now: number;
}
const SPP = '00001101-0000-1000-8000-00805f9b34fb';

@Injectable()
export class EchookConnectionService implements OnDestroy {
  readonly unavailable = !window.isSecureContext ? 'Open this page over HTTPS to connect.'
    : !(navigator as Navigator & { serial?: SerialAccess }).serial
      ? 'Bluetooth serial is unavailable. Open this page in an up-to-date Chrome on Android.' : '';
  readonly state$ = new BehaviorSubject<EchookState>({ status: 'idle', message: '', readings: [], now: Date.now() });
  private session?: Session;
  private destroyed = false;

  constructor(private zone: NgZone) {}

  connect() {
    if (this.session || this.unavailable || this.destroyed) return;
    const session: Session = { cancelled: false };
    this.session = session;
    this.publish({ status: 'connecting', message: '', readings: [] });
    // requestPort is called directly within the user's activation; no preflight awaits.
    session.task = this.zone.runOutsideAngular(() => this.receive(session));
  }

  async disconnect() {
    const session = this.session;
    if (!session) return;
    session.cancelled = true;
    this.publish({ status: 'disconnecting' });
    await session.reader?.cancel().catch(() => undefined);
    await session.task;
  }

  ngOnDestroy() {
    this.destroyed = true;
    void this.disconnect();
  }

  private async receive(session: Session) {
    const decoder = new EchookDecoder();
    const latest = new Map<string, EchookReading>();
    let timer: ReturnType<typeof setInterval> | undefined;
    let failure = '';
    try {
      const serial = (navigator as Navigator & { serial: SerialAccess }).serial;
      session.port = await serial.requestPort({ filters: [{ bluetoothServiceClassId: SPP }] });
      if (session.cancelled) return;
      await session.port.open({ baudRate: 115200, bufferSize: 4096 });
      session.opened = true;
      if (session.cancelled) return;
      if (!session.port.readable) throw new Error('No readable stream');
      session.reader = session.port.readable.getReader();
      this.publish({ status: 'connected' });
      // One read at a time, latest values only (at most 94 channel IDs), UI at 2 Hz.
      timer = setInterval(() => this.publish({ readings: [...latest.values()], now: Date.now() }), 500);
      while (!session.cancelled) {
        const { value, done } = await session.reader.read();
        if (session.cancelled) break;
        if (done) throw new Error('Connection ended');
        if (value) decoder.push(value, Date.now(), reading => latest.set(reading.id, reading));
      }
    } catch (error) {
      if (!session.cancelled && (error as { name?: string })?.name !== 'NotFoundError') {
        failure = 'Couldn’t receive data. Close OMNI, check eChook is powered and paired, then reconnect.';
      }
    } finally {
      if (timer) clearInterval(timer);
      session.reader?.releaseLock();
      if (session.opened) {
        try { await session.port.close(); }
        catch { failure = 'Couldn’t close the connection. Close this tab before trying again.'; }
      }
      if (this.session === session) this.session = undefined;
      this.publish({ status: failure ? 'error' : 'idle', message: failure, readings: [...latest.values()], now: Date.now() });
    }
  }

  private publish(change: Partial<EchookState>) {
    if (!this.destroyed) this.zone.run(() => this.state$.next({ ...this.state$.value, ...change }));
  }
}
