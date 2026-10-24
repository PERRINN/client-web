import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { EchookDecoder, EchookReading } from './echookProtocol';

export interface EchookPort {
  readable: ReadableStream<Uint8Array> | null;
  getInfo(): { bluetoothServiceClassId?: string };
  open(options: { baudRate: number; bufferSize: number }): Promise<void>;
  close(): Promise<void>;
}
interface SerialAccess extends EventTarget {
  getPorts(): Promise<EchookPort[]>;
  requestPort(options: { filters: { bluetoothServiceClassId: string }[] }): Promise<EchookPort>;
}
interface Session {
  cancelled: boolean; opened?: boolean; port?: EchookPort; healthy?: boolean;
  reader?: ReadableStreamDefaultReader<Uint8Array>; task?: Promise<void>;
}
export interface EchookState {
  status: 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'error';
  message: string; readings: EchookReading[]; now: number; needsPermission: boolean;
}
const SPP = '00001101-0000-1000-8000-00805f9b34fb';
export const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000];
export const MAX_CONNECTION_ATTEMPTS = 6;

@Injectable()
export class EchookConnectionService implements OnDestroy {
  readonly unavailable = !window.isSecureContext ? 'Open this page over HTTPS to connect.'
    : !(navigator as Navigator & { serial?: SerialAccess }).serial
      ? 'Bluetooth serial is unavailable. Open this page in an up-to-date Chrome on Android.' : '';
  readonly state$ = new BehaviorSubject<EchookState>({ status: 'idle', message: '', readings: [], now: Date.now(), needsPermission: false });
  private session?: Session;
  private selected?: EchookPort;
  private destroyed = false;
  private automatic = false;
  private checking = false;
  private generation = 0;
  private attempts = 0;
  private closeFailed = false;
  private retry?: ReturnType<typeof setTimeout>;
  private get serial() { return (navigator as Navigator & { serial: SerialAccess }).serial; }
  private get active() { return this.automatic && !this.destroyed && !document.hidden && !this.closeFailed; }

  constructor(private zone: NgZone) {}

  start() {
    if (this.automatic || this.unavailable || this.destroyed) return;
    this.automatic = true;
    this.attempts = 0;
    this.serial.addEventListener('connect', this.available);
    document.addEventListener('visibilitychange', this.visibility);
    void this.restore();
  }

  // Only the browser's initial permission chooser needs a user activation.
  connect() {
    if (this.session || this.checking || this.unavailable || this.destroyed || this.closeFailed) return;
    if (!this.automatic) {
      this.automatic = true;
      this.serial.addEventListener('connect', this.available);
      document.addEventListener('visibilitychange', this.visibility);
    }
    this.clearRetry();
    this.attempts = 0;
    this.begin();
  }

  private readonly available = (event: Event) => {
    const port = (event as Event & { port?: EchookPort }).port || event.target as unknown as EchookPort;
    if (this.selected && port !== this.selected) return;
    if (!this.active || this.session || this.checking) return;
    this.clearRetry();
    this.attempts = 0;
    void this.restore();
  };

  private readonly visibility = () => {
    if (document.hidden) { this.clearRetry(); return; }
    if (!this.active || this.session || this.checking) return;
    this.clearRetry();
    this.attempts = 0;
    void this.restore();
  };

  private async restore() {
    if (!this.active || this.session || this.checking) return;
    this.checking = true;
    const generation = this.generation;
    try {
      const ports = (await this.serial.getPorts()).filter(port => port.getInfo().bluetoothServiceClassId?.toLowerCase() === SPP);
      if (generation !== this.generation || !this.active) return;
      // Web Serial exposes no stable device ID. Never guess among multiple grants.
      this.selected = ports.includes(this.selected) ? this.selected : ports.length === 1 ? ports[0] : undefined;
      if (this.selected) this.begin(this.selected);
      else this.publish({ status: 'idle', message: '', needsPermission: true, readings: [] });
    } catch {
      if (generation === this.generation && this.active) {
        this.publish({ status: 'error', message: 'Choose eChook to restore Bluetooth access.', needsPermission: true });
      }
    } finally {
      this.checking = false;
      if (generation !== this.generation && this.active) void this.restore();
    }
  }

  private begin(port?: EchookPort) {
    const session: Session = { cancelled: false };
    this.session = session;
    this.publish({ status: 'connecting', message: '', readings: [], needsPermission: false });
    session.task = this.zone.runOutsideAngular(() => this.receive(session, port));
  }

  private async receive(session: Session, port?: EchookPort) {
    const decoder = new EchookDecoder();
    const latest = new Map<string, EchookReading>();
    let timer: ReturnType<typeof setInterval> | undefined;
    let failure = '';
    let retryable = false;
    try {
      session.port = port || await this.serial.requestPort({ filters: [{ bluetoothServiceClassId: SPP }] });
      if (session.cancelled || !this.active) return;
      this.selected = session.port;
      this.attempts++;
      retryable = true;
      await session.port.open({ baudRate: 115200, bufferSize: 4096 });
      session.opened = true;
      if (session.cancelled || !this.active) return;
      if (!session.port.readable) throw new Error('No readable stream');
      session.reader = session.port.readable.getReader();
      this.publish({ status: 'connected' });
      let lastData = Date.now();
      let stalled = false;
      // Latest values only; one read at a time and UI at 2 Hz. No valid packets
      // for ten seconds closes the stalled stream and enters bounded recovery.
      timer = setInterval(() => {
        this.publish({ readings: [...latest.values()], now: Date.now() });
        if (!stalled && Date.now() - lastData > 10000) {
          stalled = true;
          void session.reader.cancel().catch(() => undefined);
        }
      }, 500);
      while (!session.cancelled) {
        const { value, done } = await session.reader.read();
        if (session.cancelled) break;
        if (done) throw new Error('Connection ended');
        if (value) decoder.push(value, Date.now(), reading => {
          latest.set(reading.id, reading);
          lastData = reading.at;
          // A successful open alone is insufficient: broken streams must not
          // reset the attempt budget and create an endless reconnect loop.
          if (!session.healthy) { session.healthy = true; this.attempts = 0; }
        });
      }
    } catch (error) {
      if (!session.cancelled) {
        if (!session.port) this.publish({ needsPermission: true });
        if ((error as { name?: string })?.name !== 'NotFoundError' || session.port) {
          failure = 'Waiting for eChook. Check its power and close OMNI.';
        }
      }
    } finally {
      if (timer) clearInterval(timer);
      session.reader?.releaseLock();
      if (session.opened) {
        try { await session.port.close(); }
        catch {
          this.closeFailed = true;
          failure = 'Couldn’t close the connection. Close this tab before trying again.';
        }
      }
      if (this.session === session) this.session = undefined;
      this.publish({ status: failure ? 'error' : 'idle', message: failure, readings: [...latest.values()], now: Date.now() });
      if (retryable && !session.cancelled) this.scheduleRetry();
      else if (session.cancelled && this.active) void this.restore();
    }
  }

  private scheduleRetry() {
    if (!this.active || this.retry !== undefined || this.attempts >= MAX_CONNECTION_ATTEMPTS) return;
    const delay = RECONNECT_DELAYS[Math.max(0, this.attempts - 1)];
    this.zone.runOutsideAngular(() => {
      this.retry = setTimeout(() => { this.retry = undefined; void this.restore(); }, delay);
    });
  }

  private clearRetry() {
    if (this.retry !== undefined) clearTimeout(this.retry);
    this.retry = undefined;
  }

  async disconnect() {
    this.automatic = false;
    this.generation++;
    this.clearRetry();
    this.serial?.removeEventListener('connect', this.available);
    document.removeEventListener('visibilitychange', this.visibility);
    const session = this.session;
    if (!session) { this.publish({ status: 'idle' }); return; }
    session.cancelled = true;
    this.publish({ status: 'disconnecting' });
    await session.reader?.cancel().catch(() => undefined);
    await session.task;
  }

  ngOnDestroy() { this.destroyed = true; void this.disconnect(); }

  private publish(change: Partial<EchookState>) {
    if (!this.destroyed) this.zone.run(() => this.state$.next({ ...this.state$.value, ...change }));
  }
}
