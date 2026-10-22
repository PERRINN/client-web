import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { firstValueFrom, Subject, Subscription } from 'rxjs';
import { VoiceCaptureService } from './voiceCapture.service';
import { voiceBase64 } from './voiceAudio';

interface VoiceRequest { requestId: string; audio: string; sourcePage: string }
interface VoiceResult { eventId: string; transcript: string }
export interface VoiceReply { id: number; kind: 'transcript' | 'error'; text: string }
type Phase = 'idle' | 'requesting' | 'recording' | 'sending' | 'saved' | 'error';

@Injectable()
export class VoiceInputService implements OnDestroy {
  readonly changed = new Subject<void>();
  levels = Array<number>(9).fill(0);
  ready = false;
  uid = '';
  phase: Phase = 'idle';
  pendingCount = 0;
  readonly replies: VoiceReply[] = [];
  private replyId = 0;
  private generation = 0;
  private captureGeneration = 0;
  private submissions = Promise.resolve();
  private queued?: { request?: VoiceRequest };
  private timer?: ReturnType<typeof setTimeout>;
  private subscription: Subscription;

  constructor(private auth: AngularFireAuth, private functions: AngularFireFunctions,
    private capture: VoiceCaptureService, private zone: NgZone) {
    this.subscription = auth.authState.subscribe({
      next: user => {
        if (this.uid !== (user?.uid || '')) { this.generation++; this.reset(); }
        this.uid = user?.uid || ''; this.ready = true; this.changed.next();
      },
      error: () => { this.generation++; this.reset(); this.uid = ''; this.ready = true; this.changed.next(); }
    });
  }
  get busy(): boolean { return this.phase === 'requesting' || this.phase === 'recording' || this.phase === 'sending'; }
  get canRecord(): boolean { return this.ready && !!this.uid && !this.busy && this.pendingCount < 2; }
  get canToggle(): boolean { return this.canRecord || this.phase === 'recording' || this.phase === 'requesting'; }
  get waiting(): boolean { return this.phase === 'sending' || (!this.canToggle && this.pendingCount > 0); }
  get label(): string {
    if (this.waiting) return 'Waiting for previous recordings';
    return ({ idle: 'Start recording', requesting: 'Cancel microphone', recording: 'Stop recording', sending: 'Preparing recording', saved: 'Start recording', error: 'Start recording' })[this.phase];
  }

  async press(): Promise<void> {
    if (!this.canRecord) return;
    const generation = ++this.captureGeneration;
    this.clearLevels();
    this.phase = 'requesting'; this.changed.next();
    try {
      const started = await this.capture.start(
        () => this.zone.run(() => { void this.release(); }),
        () => this.zone.run(() => this.cancel('Recording interrupted. Try again.')),
        level => {
          if (generation !== this.captureGeneration || this.phase !== 'recording') return;
          this.zone.run(() => {
            this.levels = [...this.levels.slice(1), level]; this.changed.next();
          });
        }
      );
      if (!started || generation !== this.captureGeneration) return;
      this.phase = 'recording';
      this.timer = setTimeout(() => { void this.release(); }, 30000);
    } catch (error) {
      if (generation !== this.captureGeneration) return;
      const name = (error as { name?: string }).name;
      const message = name === 'NotAllowedError' ? 'Microphone access denied. Allow it in your browser to record.'
        : name === 'NotFoundError' ? 'No microphone found.'
        : error instanceof Error && error.message.startsWith('Voice recording requires') ? error.message : 'Could not start the microphone. Try again.';
      this.phase = 'idle'; this.reply(message, 'error');
    } finally { if (generation === this.captureGeneration) this.changed.next(); }
  }

  async release(): Promise<void> {
    if (this.phase === 'requesting') { this.cancel(); return; }
    if (this.phase !== 'recording') return;
    clearTimeout(this.timer);
    const generation = this.generation;
    const captureGeneration = this.captureGeneration;
    this.clearLevels(); this.phase = 'sending'; this.changed.next();
    try {
      const audio = await this.capture.finish();
      if (generation !== this.generation || captureGeneration !== this.captureGeneration) return;
      const entry: { request?: VoiceRequest } = {
        request: { requestId: crypto.randomUUID(), audio: voiceBase64(audio), sourcePage: '/prototypes/voice-input' }
      };
      this.queued = entry;
      this.phase = 'idle';
      this.pendingCount++;
      // One in flight plus one waiting recording; submit serially without retries.
      const pending = this.submissions.then(async () => {
        const request = entry.request;
        entry.request = undefined;
        if (this.queued === entry) this.queued = undefined;
        if (request && generation === this.generation) await this.submit(request);
      }).finally(() => {
        if (generation === this.generation) { this.pendingCount--; this.changed.next(); }
      });
      this.submissions = pending;
      this.changed.next();
      await pending;
    } catch (error) {
      if (generation !== this.generation || captureGeneration !== this.captureGeneration) return;
      this.phase = 'idle'; this.reply(error instanceof Error ? error.message : 'Could not capture audio. Try again.', 'error');
    } finally { if (generation === this.generation) this.changed.next(); }
  }

  private async submit(request: VoiceRequest): Promise<void> {
    if (!this.uid) return;
    const generation = this.generation, uid = this.uid;
    try {
      const user = await this.auth.currentUser;
      if (generation !== this.generation) return;
      if (!user || user.uid !== uid) { this.generation++; this.reset(); return; }
      const response = await firstValueFrom(this.functions.httpsCallable<VoiceRequest, VoiceResult>('voiceInput', { timeout: 65000 })(request));
      if (generation !== this.generation || uid !== this.uid) return;
      if (!response?.eventId || typeof response.transcript !== 'string') throw new Error('Invalid response');
      this.reply(response.transcript, 'transcript');
    } catch (error) {
      if (generation !== this.generation) return;
      const code = (error as { code?: string }).code?.replace('functions/', '');
      const details = (error as { details?: { reason?: string; dailyLimit?: number } }).details;
      const messages: Record<string, string> = {
        unauthenticated: 'Sign in again to record.', 'invalid-argument': 'No usable speech recorded. Try again.',
        'resource-exhausted': details?.reason === 'daily-limit' && [20, 1000].includes(details.dailyLimit)
          ? `You’ve reached your daily limit of ${details.dailyLimit.toLocaleString('en-GB')} recordings. Your allowance resets at midnight UTC.`
          : details?.reason === 'recording-processing'
            ? 'Your previous recording is still processing. Try again shortly.'
            : 'Recording is temporarily unavailable. Try again later.',
        unavailable: 'Could not confirm whether the recording was saved.',
        aborted: 'The previous recording is still processing.',
        'failed-precondition': 'Recording failed or voice input is unavailable. Record again later.'
      };
      this.reply(messages[code || ''] || 'Could not confirm whether the recording was saved.', 'error');
    } finally { if (generation === this.generation) this.changed.next(); }
  }

  cancel(message = ''): void {
    if (this.phase === 'sending') { this.capture.silenceClosingCue(); return; }
    if (this.phase !== 'recording' && this.phase !== 'requesting') return;
    this.captureGeneration++; this.capture.cancel(); clearTimeout(this.timer);
    this.clearLevels();
    this.phase = 'idle';
    if (message) this.reply(message, 'error');
    this.changed.next();
  }
  private reply(text: string, kind: VoiceReply['kind']): void {
    this.replies.push({ id: ++this.replyId, kind, text });
    if (!this.busy) this.phase = kind === 'transcript' ? 'saved' : 'error';
  }
  private clearLevels(): void { this.levels = Array<number>(9).fill(0); }
  private reset(): void {
    if (this.queued) this.queued.request = undefined;
    this.queued = undefined;
    this.captureGeneration++; this.pendingCount = 0; this.submissions = Promise.resolve();
    this.clearLevels();
    this.capture.cancel(); clearTimeout(this.timer);
    this.phase = 'idle'; this.replies.length = 0; this.changed.next();
  }
  ngOnDestroy(): void { this.generation++; this.reset(); this.subscription.unsubscribe(); this.changed.complete(); }
}
