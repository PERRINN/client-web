import { EnvironmentInjector, Injectable, OnDestroy, runInInjectionContext } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { defer, firstValueFrom, from, merge, Subject, Subscription, takeUntil, timeout } from 'rxjs';
import { voiceBase64 } from './voiceAudio';
import { voiceDiagnosticCode } from './voiceDiagnostics';
import { VoiceQueueStore, VoiceRecording, VOICE_QUEUE_LIMIT, VOICE_REQUEST_LIMIT } from './voiceQueueStore.service';

interface Receipt { eventId: string; status: string; transcript?: string }
interface Attempt { startedAt: number; stage: string; deadline: number; stopped: Subject<void>; expired: boolean; record?: VoiceRecording }
class QueueStorageError extends Error { constructor(readonly code: string) { super('Local storage failed.'); } }
class QueueAudioError extends Error { constructor(readonly code: string) { super('Local audio is unreadable.'); } }

@Injectable()
export class VoiceQueueService implements OnDestroy {
  readonly changed = new Subject<void>();
  readonly completed = new Subject<{ id: string; transcript: string; failed?: boolean; conversationId?: string }>();
  items: VoiceRecording[] = [];
  ready = false;
  storageError = '';
  total = 0;
  private owner = '';
  private epoch = 0;
  private refreshId = 0;
  private running = false;
  private storageWork = 0;
  private storageSince = 0;
  private storageCode = '';
  private uploadCode = '';
  private uploadFaultStage = '';
  private storageFaultStep = '';
  private resultCode = '';
  private resultStatus = '';
  private resultCached = false;
  private resultDeadline = 0;
  private confirmedResults = new Set<string>();
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
  get diagnostics() {
    const pending = this.items.filter(item => !item.received);
    return { ready: this.ready, total: this.total, unsent: pending.length,
      received: this.items.length - pending.length, unsaved: !!this.unsaved,
      storageError: !!this.storageError, storageWork: this.storageWork, storageSince: this.storageSince,
      storageCode: this.storageCode, storageFaultStep: this.storageFaultStep, storageRetries: Math.min(this.storageRetries, 3),
      running: this.running, stage: this.attempt?.stage || 'Idle', startedAt: this.attempt?.startedAt || 0,
      deadline: this.attempt?.deadline || 0, nextAt: pending.length ? Math.min(...pending.map(row => Math.max(this.retryAt(row), row.leaseUntil || 0))) : 0,
      uploadCode: this.uploadCode, uploadFaultStage: this.uploadFaultStage, recordingFault: pending.some(row => !!row.error), listeners: this.watchers.size, resultFailures: this.resultFailures.size,
      confirmedResults: this.confirmedResults.size, resultRetries: this.resultRetries, resultCode: this.resultCode, resultStatus: this.resultStatus, resultDeadline: this.resultDeadline, resultCached: this.resultCached };
  }
  get canRecord(): boolean { return this.ready && !this.storageError && !this.unsaved && this.total < VOICE_QUEUE_LIMIT; }
  get offline(): boolean { return navigator.onLine === false; }
  active(item: VoiceRecording): boolean { return !item.received && (item.leaseUntil || 0) > Date.now(); }
  label(item: VoiceRecording): string {
    if (this.unsaved?.id === item.id) return 'Saving recording';
    if (item.received) return 'Transcribing';
    if (this.active(item)) return this.running && this.attempt?.record?.id === item.id
      ? this.attempt.stage === 'Checking saved result' ? 'Checking saved result' : 'Sending' : 'Waiting for upload slot';
    return this.offline ? 'Waiting for connection' : 'Waiting';
  }
  start(owner: string): void {
    this.epoch++; this.cancelled.next(); this.attempt?.stopped.next(); this.attempt = undefined;
    clearTimeout(this.timer); clearTimeout(this.storageTimer); clearTimeout(this.resultTimer);
    this.resultTimer = undefined; this.resultRetries = 0; this.resultFailures.clear();
    this.watchers.forEach(watcher => watcher.unsubscribe()); this.watchers.clear(); this.finishing.clear();
    this.storageCode = ''; this.storageFaultStep = ''; this.uploadCode = ''; this.uploadFaultStage = ''; this.resultCode = ''; this.resultStatus = ''; this.resultDeadline = 0; this.resultCached = false; this.confirmedResults.clear();
    this.owner = owner; this.items = []; this.total = 0; this.ready = false;
    this.unsaved = undefined; this.storageError = ''; this.running = false; this.storageRetries = 0;
    if (owner) void this.refresh();
  }
  async refresh(): Promise<void> {
    const owner = this.owner, epoch = this.epoch, refreshId = ++this.refreshId;
    if (!owner) return;
    if (this.unsaved) { await this.saveUnsent(this.unsaved, epoch); return; }
    let loaded: Awaited<ReturnType<VoiceQueueStore['list']>>;
    try { loaded = await this.storage(this.store.list(owner), 'Read queue'); }
    catch {
      if (epoch === this.epoch && refreshId === this.refreshId) this.storageFailure();
      return;
    }
    if (epoch !== this.epoch || refreshId !== this.refreshId) return;
    this.items = loaded.items; this.total = loaded.total; this.ready = true; this.storageError = '';
    this.watchResults(epoch); this.changed.next(); void this.drain();
  }

  async enqueue(audio: Uint8Array, conversationId?: string): Promise<void> {
    const item: VoiceRecording = { id: crypto.randomUUID(), owner: this.owner, createdAt: Date.now(),
      audio: new Uint8Array(audio).buffer, ...(conversationId ? { conversationId } : {}), attempts: 0, nextAt: 0, check: false };
    this.unsaved = item; await this.saveUnsent(item, this.epoch);
  }
  private async saveUnsent(item: VoiceRecording, epoch: number): Promise<void> {
    try {
      await this.storage(this.store.add(item), 'Save recording');
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
    for (const id of this.confirmedResults) if (!ids.has(id)) this.confirmedResults.delete(id);
    // At most ten known owner documents; no collection scan or history query.
    for (const item of received) {
      if (this.watchers.has(item.id) || this.resultFailures.has(item.id)) continue;
      try {
        // AngularFire compat document wrappers inject EnvironmentInjector when
        // constructed, including after this asynchronous IndexedDB refresh.
        const watcher = runInInjectionContext(this.injector, () =>
          this.firestore.doc<Receipt & { userId: string; processingUntil?: number }>('VoiceInputEvents/' + item.eventId).snapshotChanges().subscribe({
            next: snapshot => {
              if (epoch !== this.epoch || snapshot.payload.metadata.hasPendingWrites) return;
              const event = snapshot.payload.data();
              this.resultCached = snapshot.payload.metadata.fromCache;
              this.resultDeadline = Number.isFinite(event?.processingUntil) ? event!.processingUntil! : 0;
              this.resultStatus = ['receiving', 'queued', 'processing', 'completed', 'failed'].includes(event?.status || '') ? event!.status : 'Unknown';
              this.resultCode = !event ? 'missing-result' : event.userId !== item.owner ? 'owner-mismatch' : '';
              if (!this.resultCached && !this.resultCode) this.confirmedResults.add(item.id);
              else this.confirmedResults.delete(item.id);
              // Metadata-only reconnects may not emit another snapshot.
              if (event?.userId !== item.owner) return;
              if (event.status === 'completed' && typeof event.transcript === 'string') void this.finish(item, event.transcript, false, epoch);
              else if (event.status === 'failed') void this.finish(item, 'Could not transcribe this recording.', true, epoch);
            },
            error: error => {
              if (epoch !== this.epoch) return;
              this.resultCode = voiceDiagnosticCode(error); this.confirmedResults.delete(item.id);
              this.watchers.delete(item.id); this.resultFailures.add(item.id); this.recoverResults(epoch);
            }
          })
        );
        if (!watcher.closed) this.watchers.set(item.id, watcher);
      } catch (error) { this.resultCode = voiceDiagnosticCode(error); this.confirmedResults.delete(item.id); this.resultFailures.add(item.id); this.recoverResults(epoch); }
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

  private retryAt(item: VoiceRecording): number {
    if (!item.retryWindow) return item.nextAt;
    // Old rolling-budget records can carry a day-long wait. Retire that
    // schedule on their next claim, preserving real UTC quota deferrals.
    const now = new Date();
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return item.nextAt === midnight ? item.nextAt : 0;
  }
  private async drain(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running || !this.owner || !this.ready || this.offline || document.hidden) return;
    const pending = this.items.filter(row => !row.received);
    const item = pending.find(row => Math.max(this.retryAt(row), row.leaseUntil || 0) <= Date.now())
      || pending.reduce<VoiceRecording | undefined>((first, row) => !first || Math.max(this.retryAt(row), row.leaseUntil || 0) < Math.max(this.retryAt(first), first.leaseUntil || 0) ? row : first, undefined);
    if (!item) return;
    const delay = Math.max(this.retryAt(item), item.leaseUntil || 0) - Date.now();
    if (delay > 0) { this.timer = setTimeout(() => { void this.refresh(); }, Math.min(delay, 60000)); return; }
    const epoch = this.epoch;
    const attempt: Attempt = { startedAt: Date.now(), stage: 'Claiming', deadline: Date.now() + 75000, stopped: new Subject(), expired: false };
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
      this.uploadCode = voiceDiagnosticCode(error);
      this.uploadFaultStage = error instanceof QueueAudioError ? 'Read audio' : attempt.stage;
      if (error instanceof QueueStorageError) {
        // A single row that cannot be rewritten must not lock the recorder.
        // Deletion does not serialize its audio again; finish locks storage only
        // if even that independent transaction fails.
        await this.finish(attempt.record || item, 'Recording could not be saved. Removed from this device.', true, epoch);
      }
      else try { await this.failed(attempt.record || item, error, epoch); }
      catch { if (current()) await this.finish(attempt.record || item, 'Recording could not be saved. Removed from this device.', true, epoch); }
    } finally {
      attempt.expired = true; attempt.stopped.next(); attempt.stopped.complete();
      if (current()) {
        this.attempt = undefined; this.running = false;
        if (!this.storageError) await this.refresh();
      }
    }
  }
  private async send(item: VoiceRecording, attempt: Attempt, live: () => boolean): Promise<void> {
    const claimed = await this.changeRecording(item, row => {
      if (!live() || row.received || this.active(row) || this.retryAt(row) > Date.now()) return undefined;
      return { ...row, attempts: row.attempts + 1, retryWindow: undefined, nextAt: 0,
        // Cover the 75s send, 30s final check and bounded local cleanup.
        leaseId: crypto.randomUUID(), leaseUntil: Date.now() + 150000, check: true };
    }, 'Claim recording', live);
    if (!claimed || !live() || !this.active(claimed)) return;
    attempt.record = claimed; attempt.stage = 'Account';
    const user = await this.auth.currentUser;
    if (!live()) return;
    if (user?.uid !== this.owner) {
      try { await this.settle(claimed, { attempts: claimed.attempts - 1 }, live); }
      finally { this.start(''); }
      return;
    }
    this.items = this.items.map(row => row.id === claimed.id ? claimed : row); this.changed.next();
    if (claimed.attempts > VOICE_REQUEST_LIMIT) {
      await this.exhausted(claimed, this.epoch, live); return;
    }
    attempt.stage = 'Reading audio';
    let audio: string;
    try {
      const buffer = claimed.audio instanceof ArrayBuffer ? claimed.audio : await claimed.audio.arrayBuffer();
      audio = voiceBase64(new Uint8Array(buffer));
    }
    catch (error) {
      if (!live()) return;
      attempt.stage = 'Checking saved result';
      // A lost upload response may have left a complete server transcript even
      // when the browser can no longer read its local Blob backing file.
      if (await this.savedResult(claimed, this.epoch, live, attempt.stopped)) return;
      if (live()) throw new QueueAudioError(voiceDiagnosticCode(error));
      return;
    }
    if (!live()) return;
    if (this.offline || document.hidden) {
      await this.settle(claimed, { attempts: claimed.attempts - 1 }, live); return;
    }
    // Rx timeout includes AngularFire lazy loading and token preparation, which
    // are outside Firebase's own HTTP timeout. The outer deadline covers auth,
    // IndexedDB and Blob preparation as well.
    attempt.stage = 'Uploading';
    const receipt = await firstValueFrom(this.functions.httpsCallable<{ requestId: string; sourcePage: string; audio: string; owner: string; conversationId?: string }, Receipt>('voiceInputEnqueue', { timeout: 65000 })({
      requestId: claimed.id, sourcePage: '/prototypes/voice-input', audio, owner: claimed.owner, ...(claimed.conversationId ? { conversationId: claimed.conversationId } : {})
    }).pipe(timeout({ first: 65000 }), takeUntil(merge(this.cancelled, attempt.stopped))));
    if (!live()) return;
    if (!receipt?.eventId || !/^[a-f0-9]{64}$/.test(receipt.eventId) || !['queued', 'completed', 'failed'].includes(receipt.status)) throw new Error('Invalid receipt');
    this.uploadCode = ''; this.uploadFaultStage = ''; attempt.stage = 'Saving receipt';
    if (receipt.status === 'completed' && typeof receipt.transcript === 'string') {
      await this.finish(claimed, receipt.transcript, false, this.epoch, live); return;
    }
    // Release local audio only after a durable inbox/task acknowledgement. Keep
    // the receipt across reloads so a server result is observed on reopening.
    await this.settle(claimed, { received: true, eventId: receipt.eventId, audio: new ArrayBuffer(0), error: undefined }, live);
  }
  private async failed(item: VoiceRecording, error: unknown, epoch: number): Promise<void> {
    const rawCode = (error as { code?: unknown }).code;
    const code = typeof rawCode === 'string' ? rawCode.replace('functions/', '') : undefined;
    const details = (error as { details?: { reason?: string } }).details;
    if (code === 'invalid-argument') {
      await this.finish(item, 'Could not use this recording.', true, epoch); return;
    }
    const dailyLimit = code === 'resource-exhausted' && details?.reason === 'daily-limit';
    if (!this.offline && !document.hidden && !dailyLimit && item.attempts >= VOICE_REQUEST_LIMIT) {
      await this.exhausted(item, epoch); return;
    }
    const now = Date.now();
    const delay = item.attempts <= 1 ? 2000 : 5000;
    const nextAt = dailyLimit
      ? Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1)
      : now + delay;
    await this.settle(item, { nextAt, attempts: dailyLimit || this.offline || document.hidden ? Math.max(0, item.attempts - 1) : item.attempts, error: error instanceof QueueAudioError
      ? `Audio unavailable on this device (${error.code}). Checking for a saved transcript.` : undefined });
  }
  private async savedResult(item: VoiceRecording, epoch: number, live: () => boolean, stopped = this.cancelled): Promise<boolean> {
    try {
      const saved = await firstValueFrom(this.functions.httpsCallable<{ requestId: string }, Receipt>('voiceInputStatus', { timeout: 20000 })({ requestId: item.id })
        .pipe(timeout({ first: 20000 }), takeUntil(merge(this.cancelled, stopped))));
      if (epoch !== this.epoch || !live()) return true;
      if (saved?.status === 'completed' && typeof saved.transcript === 'string' && /^[a-f0-9]{64}$/.test(saved.eventId || '')) {
        await this.finish(item, saved.transcript, false, epoch, live); return true;
      }
      if (saved?.status === 'processing') {
        // Status also calls an unfinished "receiving" reservation processing.
        // Verify that a worker actually started before treating it as a receipt.
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(item.owner + ':' + item.id));
        if (epoch !== this.epoch || !live()) return true;
        const eventId = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
        const snapshot = await firstValueFrom(runInInjectionContext(this.injector, () =>
          this.firestore.doc<Receipt & { userId: string; inboxVersion?: number }>('VoiceInputEvents/' + eventId).get({ source: 'server' }))
          .pipe(timeout({ first: 10000 }), takeUntil(merge(this.cancelled, stopped))));
        if (epoch !== this.epoch || !live()) return true;
        const event = snapshot.data();
        if (event?.userId !== item.owner) return false;
        if (event.status === 'completed' && typeof event.transcript === 'string') {
          await this.finish(item, event.transcript, false, epoch, live); return true;
        }
        if (event.inboxVersion !== 1 || event.status !== 'processing') return false;
        await this.settle(item, { received: true, eventId, audio: new ArrayBuffer(0), error: undefined }, live);
        return true;
      }
    } catch (error) { if (error instanceof QueueStorageError) throw error; }
    return epoch !== this.epoch || !live();
  }
  private async exhausted(item: VoiceRecording, epoch: number, live = () => epoch === this.epoch): Promise<void> {
    if (!this.offline && !document.hidden && await this.savedResult(item, epoch, live)) return;
    if (epoch !== this.epoch || !live()) return;
    if (this.offline || document.hidden) {
      await this.settle(item, { attempts: Math.max(0, item.attempts - 1), nextAt: Date.now() + 5000 }, live); return;
    }
    await this.finish(item, 'Upload could not be confirmed. Recording removed from this device.', true, epoch, live);
  }
  private async changeRecording(item: VoiceRecording, update: (row: VoiceRecording) => VoiceRecording | undefined,
    step: string, live = () => true): Promise<VoiceRecording | undefined> {
    const epoch = this.epoch;
    // At most three local transactions per update, then one guarded deletion.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (epoch !== this.epoch || !live()) return undefined;
      try {
        return await this.storage(this.store.change(item.id, item.owner,
          row => epoch === this.epoch && live() ? update(row) : undefined), step);
      } catch (error) { if (attempt === 2) throw error; }
    }
    return undefined;
  }
  private async settle(item: VoiceRecording, changes: Partial<VoiceRecording>, live = () => true): Promise<void> {
    const epoch = this.epoch;
    const updated = await this.changeRecording(item, row => row.leaseId !== item.leaseId ? undefined
      : { ...row, ...changes, leaseId: undefined, leaseUntil: 0 }, 'Update recording', live);
    if (updated && epoch === this.epoch) { this.items = this.items.map(row => row.id === item.id ? updated : row); this.changed.next(); }
  }
  private async finish(item: VoiceRecording, transcript: string, failed: boolean, epoch: number, live = () => true): Promise<void> {
    if (this.finishing.has(item.id)) return;
    this.finishing.add(item.id);
    try {
      const removed = await this.storage(this.store.change(item.id, item.owner, row => epoch === this.epoch && live()
        && (item.received && row.received || !row.received && row.leaseId === item.leaseId) ? null : undefined), 'Remove completed recording');
      if (removed && epoch === this.epoch && live()) {
        this.completed.next({ id: item.id, transcript, failed, conversationId: item.conversationId }); this.storageRetries = 0;
        await this.refresh();
      }
    } catch { if (epoch === this.epoch) this.storageFailure(); }
    finally { this.finishing.delete(item.id); }
  }
  private async storage<T>(operation: Promise<T>, step: string): Promise<T> {
    if (!this.storageWork) this.storageSince = Date.now();
    this.storageWork++;
    try {
      const result = await firstValueFrom(from(operation).pipe(timeout({ first: 5000 })));
      this.storageCode = ''; this.storageFaultStep = ''; return result;
    } catch (error) { this.storageCode = voiceDiagnosticCode(error); this.storageFaultStep = step; throw new QueueStorageError(this.storageCode); }
    finally { this.storageWork--; }
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
