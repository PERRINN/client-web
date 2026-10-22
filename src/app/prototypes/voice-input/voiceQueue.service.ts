import { EnvironmentInjector, Injectable, OnDestroy, runInInjectionContext } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { defer, firstValueFrom, from, merge, Subject, Subscription, takeUntil, timeout } from 'rxjs';
import { voiceBase64 } from './voiceAudio';
import { VoiceQueueStore, VoiceRecording, VOICE_QUEUE_LIMIT, VOICE_REQUEST_LIMIT } from './voiceQueueStore.service';

interface Receipt { eventId: string; status: string; transcript?: string }
interface Attempt { deadline: number; stopped: Subject<void>; expired: boolean; record?: VoiceRecording }
class QueueStorageError extends Error {}
const DAY = 86400000;

@Injectable()
export class VoiceQueueService implements OnDestroy {
  readonly changed = new Subject<void>();
  readonly completed = new Subject<{ id: string; transcript: string; failed?: boolean }>();
  items: VoiceRecording[] = [];
  ready = false;
  storageError = '';
  total = 0;
  private owner = '';
  private epoch = 0;
  private refreshId = 0;
  private running = false;
  private attempt?: Attempt;
  private timer?: ReturnType<typeof setTimeout>;
  private storageTimer?: ReturnType<typeof setTimeout>;
  private storageRetries = 0;
  private resultTimer?: ReturnType<typeof setTimeout>;
  private resultRetries = 0;
  private resultFailures = new Set<string>();
  private cancelled = new Subject<void>();
  private unsaved?: VoiceRecording;
  private watchers = new Map<string, Subscription>();
  private finishing = new Set<string>();
  private readonly wake = () => {
    // Mobile OS suspension can delay timer callbacks. Resume by wall-clock
    // deadline, never by trusting the SDK promise or the running flag.
    if (this.attempt && Date.now() >= this.attempt.deadline) {
      this.attempt.expired = true; this.attempt.stopped.next();
    }
    this.storageRetries = 0; this.resultRetries = 0; this.resultFailures.clear();
    clearTimeout(this.resultTimer); this.resultTimer = undefined; void this.refresh();
  };
  constructor(private store: VoiceQueueStore, private auth: AngularFireAuth,
    private functions: AngularFireFunctions, private firestore: AngularFirestore, private injector: EnvironmentInjector) {
    for (const event of ['online', 'offline', 'pageshow', 'focus']) window.addEventListener(event, this.wake);
    document.addEventListener('visibilitychange', this.wake);
  }
  get canRecord(): boolean { return this.ready && !this.storageError && !this.unsaved && this.total < VOICE_QUEUE_LIMIT; }
  get offline(): boolean { return navigator.onLine === false; }
  active(item: VoiceRecording): boolean { return !item.received && (item.leaseUntil || 0) > Date.now(); }
  label(item: VoiceRecording): string {
    if (this.unsaved?.id === item.id) return 'Saving recording';
    if (item.received) return 'Transcribing';
    if (this.active(item)) return 'Sending';
    return this.offline ? 'Waiting for connection' : 'Waiting';
  }
  start(owner: string): void {
    this.epoch++; this.cancelled.next(); this.attempt?.stopped.next(); this.attempt = undefined;
    clearTimeout(this.timer); clearTimeout(this.storageTimer); clearTimeout(this.resultTimer);
    this.resultTimer = undefined; this.resultRetries = 0; this.resultFailures.clear();
    this.watchers.forEach(watcher => watcher.unsubscribe()); this.watchers.clear(); this.finishing.clear();
    this.owner = owner; this.items = []; this.total = 0; this.ready = false;
    this.unsaved = undefined; this.storageError = ''; this.running = false; this.storageRetries = 0;
    if (owner) void this.refresh();
  }
  async refresh(): Promise<void> {
    const owner = this.owner, epoch = this.epoch, refreshId = ++this.refreshId;
    if (!owner) return;
    if (this.unsaved) { await this.saveUnsent(this.unsaved, epoch); return; }
    let loaded: Awaited<ReturnType<VoiceQueueStore['list']>>;
    try { loaded = await this.storage(this.store.list(owner)); }
    catch {
      if (epoch === this.epoch && refreshId === this.refreshId) this.storageFailure();
      return;
    }
    if (epoch !== this.epoch || refreshId !== this.refreshId) return;
    this.items = loaded.items; this.total = loaded.total; this.ready = true; this.storageError = '';
    this.watchResults(epoch); this.changed.next(); void this.drain();
  }

  async enqueue(audio: Uint8Array): Promise<void> {
    const item: VoiceRecording = { id: crypto.randomUUID(), owner: this.owner, createdAt: Date.now(),
      audio: new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), attempts: 0, nextAt: 0, check: false };
    this.unsaved = item; await this.saveUnsent(item, this.epoch);
  }
  private async saveUnsent(item: VoiceRecording, epoch: number): Promise<void> {
    try {
      await this.storage(this.store.add(item));
      if (epoch !== this.epoch) return;
      this.unsaved = undefined; this.storageRetries = 0;
      void navigator.storage?.persist?.().catch(() => false);
      await this.refresh();
    } catch {
      if (epoch !== this.epoch) return;
      this.items = [...this.items.filter(row => row.id !== item.id), item];
      this.storageFailure('Could not save on this device. Keep this page open.');
    }
  }
  private watchResults(epoch: number): void {
    const received = this.items.filter(item => item.received && item.eventId);
    const ids = new Set(received.map(item => item.id));
    for (const [id, watcher] of this.watchers) if (!ids.has(id)) { watcher.unsubscribe(); this.watchers.delete(id); }
    for (const id of this.resultFailures) if (!ids.has(id)) this.resultFailures.delete(id);
    // At most ten known owner documents; no collection scan or history query.
    for (const item of received) {
      if (this.watchers.has(item.id) || this.resultFailures.has(item.id)) continue;
      try {
        // AngularFire compat document wrappers inject EnvironmentInjector when
        // constructed, including after this asynchronous IndexedDB refresh.
        const watcher = runInInjectionContext(this.injector, () =>
          this.firestore.doc<Receipt & { userId: string }>('VoiceInputEvents/' + item.eventId).snapshotChanges().subscribe({
            next: snapshot => {
              if (epoch !== this.epoch || snapshot.payload.metadata.hasPendingWrites) return;
              const event = snapshot.payload.data();
              // Metadata-only reconnects may not emit another snapshot.
              if (event?.userId !== item.owner) return;
              if (event.status === 'completed' && typeof event.transcript === 'string') void this.finish(item, event.transcript, false, epoch);
              else if (event.status === 'failed') void this.finish(item, 'Could not transcribe this recording.', true, epoch);
            },
            error: () => {
              if (epoch !== this.epoch) return;
              this.watchers.delete(item.id); this.resultFailures.add(item.id); this.recoverResults(epoch);
            }
          })
        );
        if (!watcher.closed) this.watchers.set(item.id, watcher);
      } catch { this.resultFailures.add(item.id); this.recoverResults(epoch); }
    }
  }
  private recoverResults(epoch: number): void {
    // A saved server receipt is independent of local recording storage. Remote
    // listener failures must never disable capture or stop eligible uploads.
    if (epoch !== this.epoch || this.resultTimer || this.resultRetries >= 3) return;
    this.resultRetries++;
    this.resultTimer = setTimeout(() => {
      this.resultTimer = undefined;
      if (epoch === this.epoch) { this.resultFailures.clear(); this.watchResults(epoch); }
    }, 30000);
  }

  private async drain(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running || !this.owner || !this.ready || this.offline || document.hidden) return;
    const pending = this.items.filter(row => !row.received);
    const item = pending.find(row => Math.max(row.nextAt, row.leaseUntil || 0) <= Date.now())
      || pending.reduce<VoiceRecording | undefined>((first, row) => !first || Math.max(row.nextAt, row.leaseUntil || 0) < Math.max(first.nextAt, first.leaseUntil || 0) ? row : first, undefined);
    if (!item) return;
    const delay = Math.max(item.nextAt, item.leaseUntil || 0) - Date.now();
    if (delay > 0) { this.timer = setTimeout(() => { void this.refresh(); }, Math.min(delay, 60000)); return; }
    const epoch = this.epoch;
    const attempt: Attempt = { deadline: Date.now() + 75000, stopped: new Subject(), expired: false };
    this.attempt = attempt; this.running = true;
    const current = () => epoch === this.epoch && this.attempt === attempt;
    const live = () => current() && !attempt.expired && Date.now() < attempt.deadline;
    try {
      await firstValueFrom(defer(() => this.send(item, attempt, live)).pipe(
        timeout({ first: 75000 }), takeUntil(merge(this.cancelled, attempt.stopped))
      ));
    } catch (error) {
      if (!current()) return;
      attempt.expired = true; attempt.stopped.next();
      if (error instanceof QueueStorageError) this.storageFailure();
      else try { await this.failed(attempt.record || item, error, epoch); }
      catch { if (current()) this.storageFailure(); }
    } finally {
      attempt.expired = true; attempt.stopped.next(); attempt.stopped.complete();
      if (current()) {
        this.attempt = undefined; this.running = false;
        if (!this.storageError) await this.refresh();
      }
    }
  }
  private async send(item: VoiceRecording, attempt: Attempt, live: () => boolean): Promise<void> {
    const claimed = await this.storage(this.store.change(item.id, this.owner, row => {
      if (!live() || row.received || this.active(row) || row.nextAt > Date.now()) return undefined;
      const window = row.retryWindow || Date.now(), expired = Date.now() - window >= DAY;
      // Legacy lifetime budgets become a rolling daily budget, without changing
      // IDs/audio. Reopening and network flaps never replenish this window.
      const attempts = row.retryWindow && !expired ? row.attempts : 0;
      if (attempts >= VOICE_REQUEST_LIMIT) return { ...row, nextAt: window + DAY };
      return { ...row, attempts: attempts + 1, retryWindow: expired ? Date.now() : window,
        leaseId: crypto.randomUUID(), leaseUntil: Date.now() + 90000, check: true };
    }));
    if (!claimed || !live() || !this.active(claimed)) return;
    attempt.record = claimed;
    const user = await this.auth.currentUser;
    if (!live()) return;
    if (user?.uid !== this.owner) {
      await this.settle(claimed, { attempts: claimed.attempts - 1 }, live);
      this.start(''); return;
    }
    this.items = this.items.map(row => row.id === claimed.id ? claimed : row); this.changed.next();
    const audio = voiceBase64(new Uint8Array(await claimed.audio.arrayBuffer()));
    if (!live()) return;
    if (this.offline || document.hidden) {
      await this.settle(claimed, { attempts: claimed.attempts - 1 }, live); return;
    }
    // Rx timeout includes AngularFire lazy loading and token preparation, which
    // are outside Firebase's own HTTP timeout. The outer deadline covers auth,
    // IndexedDB and Blob preparation as well.
    const receipt = await firstValueFrom(this.functions.httpsCallable<{ requestId: string; sourcePage: string; audio: string; owner: string }, Receipt>('voiceInputEnqueue', { timeout: 65000 })({
      requestId: claimed.id, sourcePage: '/prototypes/voice-input', audio, owner: claimed.owner
    }).pipe(timeout({ first: 65000 }), takeUntil(merge(this.cancelled, attempt.stopped))));
    if (!live()) return;
    if (!receipt?.eventId || !/^[a-f0-9]{64}$/.test(receipt.eventId) || !['queued', 'completed', 'failed'].includes(receipt.status)) throw new Error('Invalid receipt');
    if (receipt.status === 'completed' && typeof receipt.transcript === 'string') {
      await this.finish(claimed, receipt.transcript, false, this.epoch, live); return;
    }
    // Release local audio only after a durable inbox/task acknowledgement. Keep
    // the receipt across reloads so a server result is observed on reopening.
    await this.settle(claimed, { received: true, eventId: receipt.eventId, audio: new Blob(), error: undefined }, live);
  }
  private async failed(item: VoiceRecording, error: unknown, epoch: number): Promise<void> {
    const code = (error as { code?: string }).code?.replace('functions/', '');
    const details = (error as { details?: { reason?: string } }).details;
    if (code === 'invalid-argument') {
      await this.finish(item, 'Could not use this recording.', true, epoch); return;
    }
    const now = Date.now();
    const delay = [2000, 5000, 15000, 30000, 60000, 300000, 900000, 3600000][Math.min(Math.max(item.attempts - 1, 0), 7)];
    const nextAt = code === 'resource-exhausted' && details?.reason === 'daily-limit'
      ? Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1)
      : item.attempts >= VOICE_REQUEST_LIMIT && item.retryWindow ? item.retryWindow + DAY : now + delay;
    await this.settle(item, { nextAt, error: undefined });
  }
  private async settle(item: VoiceRecording, changes: Partial<VoiceRecording>, live = () => true): Promise<void> {
    const epoch = this.epoch;
    const updated = await this.storage(this.store.change(item.id, item.owner, row => epoch !== this.epoch || !live() || row.leaseId !== item.leaseId ? undefined
      : { ...row, ...changes, leaseId: undefined, leaseUntil: 0 }));
    if (updated && epoch === this.epoch) { this.items = this.items.map(row => row.id === item.id ? updated : row); this.changed.next(); }
  }
  private async finish(item: VoiceRecording, transcript: string, failed: boolean, epoch: number, live = () => true): Promise<void> {
    if (this.finishing.has(item.id)) return;
    this.finishing.add(item.id);
    try {
      const removed = await this.storage(this.store.change(item.id, item.owner, row => epoch === this.epoch && live()
        && (row.received || row.leaseId === item.leaseId) ? null : undefined));
      if (removed && epoch === this.epoch && live()) {
        this.completed.next({ id: item.id, transcript, failed }); this.storageRetries = 0;
        await this.refresh();
      }
    } catch { if (epoch === this.epoch) this.storageFailure(); }
    finally { this.finishing.delete(item.id); }
  }
  private async storage<T>(operation: Promise<T>): Promise<T> {
    try { return await firstValueFrom(from(operation).pipe(timeout({ first: 5000 }))); }
    catch { throw new QueueStorageError(); }
  }
  private storageFailure(message = 'Recording storage is temporarily unavailable.'): void {
    this.storageError = message; this.ready = false; this.changed.next();
    if (this.storageRetries++ < 3) {
      clearTimeout(this.storageTimer);
      this.storageTimer = setTimeout(() => { void this.refresh(); }, 30000);
    }
  }
  ngOnDestroy(): void {
    this.start(''); this.cancelled.complete();
    for (const event of ['online', 'offline', 'pageshow', 'focus']) window.removeEventListener(event, this.wake);
    document.removeEventListener('visibilitychange', this.wake);
    this.changed.complete(); this.completed.complete();
  }
}
