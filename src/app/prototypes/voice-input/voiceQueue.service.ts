import { Injectable, OnDestroy } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { firstValueFrom, Subject, takeUntil } from 'rxjs';
import { voiceBase64 } from './voiceAudio';
import { VoiceQueueStore, VoiceRecording, VOICE_QUEUE_LIMIT, VOICE_REQUEST_LIMIT } from './voiceQueueStore.service';

interface VoiceResult { eventId: string; transcript: string }
interface VoiceStatus extends Partial<VoiceResult> { status: 'missing' | 'processing' | 'completed' | 'failed' | 'stalled' }

@Injectable()
export class VoiceQueueService implements OnDestroy {
  readonly changed = new Subject<void>();
  readonly completed = new Subject<{ id: string; transcript: string }>();
  items: VoiceRecording[] = [];
  ready = false;
  storageError = '';
  total = 0;
  private owner = '';
  private epoch = 0;
  private running = false;
  private checkingId = '';
  private timer?: ReturnType<typeof setTimeout>;
  private cancelled = new Subject<void>();
  private unsaved?: VoiceRecording;
  private readonly wake = () => { void this.refresh(); };

  constructor(private store: VoiceQueueStore, private auth: AngularFireAuth, private functions: AngularFireFunctions) {
    window.addEventListener('online', this.wake);
    window.addEventListener('offline', this.wake);
    document.addEventListener('visibilitychange', this.wake);
  }
  get canRecord(): boolean { return this.ready && !this.storageError && !this.unsaved && this.total < VOICE_QUEUE_LIMIT; }
  get offline(): boolean { return navigator.onLine === false; }
  attention(item: VoiceRecording): boolean { return !!item.error || item.attempts >= VOICE_REQUEST_LIMIT; }
  active(item: VoiceRecording): boolean { return (item.leaseUntil || 0) > Date.now(); }
  label(item: VoiceRecording): string {
    if (this.unsaved?.id === item.id) return 'Not saved on this device';
    if (this.active(item)) return item.id === this.checkingId ? 'Checking' : 'Sending';
    if (this.attention(item)) return 'Needs attention';
    return this.offline ? 'Queued · Offline' : 'Queued';
  }

  start(owner: string): void {
    this.epoch++; this.cancelled.next(); clearTimeout(this.timer);
    this.owner = owner; this.items = []; this.total = 0; this.ready = false;
    this.unsaved = undefined; this.storageError = ''; this.running = false;
    if (owner) void this.refresh();
  }

  async refresh(): Promise<void> {
    const owner = this.owner, epoch = this.epoch;
    if (!owner) return;
    try {
      const loaded = await this.store.list(owner);
      if (epoch !== this.epoch) return;
      this.items = loaded.items;
      if (this.unsaved) this.items.push(this.unsaved);
      this.total = loaded.total; this.ready = true; this.storageError = '';
      this.changed.next(); void this.drain();
    } catch {
      if (epoch !== this.epoch) return;
      this.storageError = 'Recording storage unavailable. Retry to continue.';
      this.ready = false; this.changed.next();
    }
  }

  async enqueue(audio: Uint8Array): Promise<void> {
    const epoch = this.epoch;
    const item: VoiceRecording = { id: crypto.randomUUID(), owner: this.owner, createdAt: Date.now(),
      audio: new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), attempts: 0, nextAt: 0, check: false };
    // Retain the buffer in memory if storage fails; never pretend it is durable.
    this.unsaved = item;
    await this.saveUnsent(item, epoch);
  }
  private async saveUnsent(item: VoiceRecording, epoch: number): Promise<void> {
    try {
      await this.store.add({ ...item, error: undefined });
      if (epoch !== this.epoch) return;
      this.unsaved = undefined;
      // Best effort only; a refused persistence request must not prevent capture.
      void navigator.storage?.persist?.().catch(() => false);
      await this.refresh();
    } catch (error) {
      if (epoch !== this.epoch) return;
      item.error = error instanceof Error ? error.message : 'Could not save on this device. Keep this page open and retry.';
      this.items = [...this.items.filter(row => row.id !== item.id), item]; this.changed.next();
    }
  }

  async retry(id: string): Promise<void> {
    const item = this.items.find(row => row.id === id);
    if (!item || this.active(item)) return;
    if (this.unsaved?.id === id) { await this.saveUnsent(item, this.epoch); return; }
    try {
      await this.store.change(id, this.owner, row => this.active(row) ? undefined : { ...row, attempts: 0, error: undefined, nextAt: 0 });
      await this.refresh();
    } catch { this.storageFailure(); }
  }
  async discard(id: string): Promise<void> {
    const item = this.items.find(row => row.id === id);
    if (!item || this.active(item)) return;
    try {
      if (this.unsaved?.id === id) this.unsaved = undefined;
      else await this.store.change(id, this.owner, row => this.active(row) ? undefined : null);
      await this.refresh();
    } catch { this.storageFailure(); }
  }

  private async drain(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running || !this.owner || !this.ready || this.offline || document.hidden) return;
    const item = this.items.find(row => row.id !== this.unsaved?.id && (!this.attention(row) || this.active(row)));
    if (!item) return;
    const delay = Math.max(item.nextAt, item.leaseUntil || 0) - Date.now();
    if (delay > 0) {
      this.timer = setTimeout(this.wake, Math.min(delay, 60000)); return;
    }
    const owner = this.owner, epoch = this.epoch;
    this.running = true;
    try {
      const user = await this.auth.currentUser;
      if (epoch !== this.epoch) return;
      if (user?.uid !== owner) { this.start(''); return; }
      let checking = false;
      const claimed = await this.store.change(item.id, owner, row => {
        if (this.active(row) || this.attention(row) || row.nextAt > Date.now()) return undefined;
        checking = row.check;
        return { ...row, attempts: row.attempts + 1, leaseId: crypto.randomUUID(), leaseUntil: Date.now() + 90000,
          // Mark uncertainty BEFORE sending, including a crash between claim and fetch.
          check: true };
      });
      if (!claimed || epoch !== this.epoch) return;
      this.checkingId = checking ? claimed.id : '';
      this.items = this.items.map(row => row.id === claimed.id ? claimed : row); this.changed.next();
      try {
        if (this.offline || document.hidden) {
          await this.settle(claimed, { attempts: claimed.attempts - 1, check: checking }); return;
        }
        if (checking) {
          const status = await firstValueFrom(this.functions.httpsCallable<{ requestId: string }, VoiceStatus>('voiceInputStatus', { timeout: 20000 })({ requestId: claimed.id }).pipe(takeUntil(this.cancelled)));
          if (epoch !== this.epoch) return;
          if (status.status === 'completed' && status.eventId && typeof status.transcript === 'string') {
            await this.saved(claimed, status.transcript, epoch);
          } else if (status.status === 'missing') await this.settle(claimed, { check: false, nextAt: 0 });
          else if (status.status === 'processing') await this.settle(claimed, { nextAt: Date.now() + 30000 });
          else if (status.status === 'failed' || status.status === 'stalled') {
            await this.settle(claimed, { error: 'Transcription could not be confirmed. Audio is kept on this device. Retry checks its status.' });
          } else throw new Error('Invalid status response');
        } else {
          const audio = voiceBase64(new Uint8Array(await claimed.audio.arrayBuffer()));
          if (epoch !== this.epoch) return;
          if (this.offline || document.hidden) {
            await this.settle(claimed, { attempts: claimed.attempts - 1, check: checking }); return;
          }
          const result = await firstValueFrom(this.functions.httpsCallable<{ requestId: string; sourcePage: string; audio: string }, VoiceResult>('voiceInput', { timeout: 65000 })({
            requestId: claimed.id, sourcePage: '/prototypes/voice-input', audio
          }).pipe(takeUntil(this.cancelled)));
          if (epoch !== this.epoch) return;
          if (!result?.eventId || typeof result.transcript !== 'string') throw new Error('Invalid submission response');
          await this.saved(claimed, result.transcript, epoch);
        }
      } catch (error) {
        if (epoch !== this.epoch) return;
        const code = (error as { code?: string }).code?.replace('functions/', '');
        const details = (error as { details?: { reason?: string; dailyLimit?: number } }).details;
        const blocked = ['unauthenticated', 'permission-denied', 'invalid-argument', 'failed-precondition', 'not-found', 'unimplemented'].includes(code || '');
        const quota = code === 'resource-exhausted' && details?.reason === 'daily-limit';
        const message = quota && [20, 1000].includes(details?.dailyLimit || 0)
          ? `You’ve reached your daily limit of ${details!.dailyLimit!.toLocaleString('en-GB')} recordings. Your allowance resets at midnight UTC.`
          : blocked ? 'Recording needs attention. Audio is kept on this device. Retry checks its status.' : undefined;
        await this.settle(claimed, { error: message, nextAt: Date.now() + [2000, 5000, 15000, 30000, 60000][Math.min(claimed.attempts - 1, 4)] });
      }
    } catch { if (epoch === this.epoch) this.storageFailure(); }
    finally {
      if (epoch === this.epoch) {
        this.running = false;
        this.checkingId = '';
        if (!this.storageError) await this.refresh();
      }
    }
  }
  private async settle(item: VoiceRecording, changes: Partial<VoiceRecording>): Promise<void> {
    const epoch = this.epoch;
    const updated = await this.store.change(item.id, item.owner, row => row.leaseId !== item.leaseId ? undefined
      : { ...row, ...changes, leaseId: undefined, leaseUntil: 0 });
    if (updated && epoch === this.epoch) {
      this.items = this.items.map(row => row.id === item.id ? updated : row);
      this.changed.next();
    }
  }
  private async saved(item: VoiceRecording, transcript: string, epoch: number): Promise<void> {
    // If navigation/auth changes during deletion, keep late private results out of UI.
    const removed = await this.store.change(item.id, item.owner, row => row.leaseId === item.leaseId ? null : undefined);
    if (removed && epoch === this.epoch) this.completed.next({ id: item.id, transcript });
  }
  private storageFailure(): void {
    this.storageError = 'Could not update recording storage. Retry to continue.';
    this.ready = false; this.changed.next();
  }
  ngOnDestroy(): void {
    this.start(''); this.cancelled.complete();
    window.removeEventListener('online', this.wake);
    window.removeEventListener('offline', this.wake);
    document.removeEventListener('visibilitychange', this.wake);
    this.changed.complete(); this.completed.complete();
  }
}
