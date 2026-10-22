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
  readonly replies: VoiceReply[] = [];
  private replyId = 0;
  private generation = 0;
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
  get canRecord(): boolean { return this.ready && !!this.uid && !this.busy; }
  get label(): string {
    return ({ idle: 'Hold to talk', requesting: 'Allow microphone', recording: 'Recording', sending: 'Transcribing', saved: 'Hold to talk', error: 'Hold to talk' })[this.phase];
  }

  async press(): Promise<void> {
    if (!this.canRecord) return;
    const generation = ++this.generation;
    this.clearLevels();
    this.phase = 'requesting'; this.changed.next();
    try {
      const started = await this.capture.start(
        () => this.zone.run(() => { void this.release(); }),
        () => this.zone.run(() => this.cancel('Recording interrupted. Try again.')),
        level => {
          if (generation !== this.generation || this.phase !== 'recording') return;
          this.zone.run(() => {
            this.levels = [...this.levels.slice(1), level]; this.changed.next();
          });
        }
      );
      if (!started || generation !== this.generation) return;
      this.phase = 'recording';
      this.timer = setTimeout(() => { void this.release(); }, 30000);
    } catch (error) {
      if (generation !== this.generation) return;
      const name = (error as { name?: string }).name;
      const message = name === 'NotAllowedError' ? 'Microphone access denied. Allow it in your browser to record.'
        : name === 'NotFoundError' ? 'No microphone found.'
        : error instanceof Error && error.message.startsWith('Voice recording requires') ? error.message : 'Could not start the microphone. Try again.';
      this.reply(message, 'error');
    } finally { if (generation === this.generation) this.changed.next(); }
  }

  async release(): Promise<void> {
    if (this.phase === 'requesting') { this.cancel(); return; }
    if (this.phase !== 'recording') return;
    clearTimeout(this.timer);
    const generation = this.generation;
    this.clearLevels(); this.phase = 'sending'; this.changed.next();
    try {
      const audio = await this.capture.finish();
      if (generation !== this.generation) return;
      const request: VoiceRequest = { requestId: crypto.randomUUID(), audio: voiceBase64(audio), sourcePage: '/prototypes/voice-input' };
      await this.submit(request);
    } catch (error) {
      if (generation !== this.generation) return;
      this.reply(error instanceof Error ? error.message : 'Could not capture audio. Try again.', 'error');
    } finally { if (generation === this.generation) this.changed.next(); }
  }

  private async submit(request: VoiceRequest): Promise<void> {
    if (!this.uid) return;
    const generation = this.generation, uid = this.uid;
    this.phase = 'sending'; this.changed.next();
    try {
      const user = await this.auth.currentUser;
      if (generation !== this.generation) return;
      if (!user || user.uid !== uid) { this.reset(); return; }
      const response = await firstValueFrom(this.functions.httpsCallable<VoiceRequest, VoiceResult>('voiceInput', { timeout: 65000 })(request));
      if (generation !== this.generation || uid !== this.uid) return;
      if (!response?.eventId || typeof response.transcript !== 'string') throw new Error('Invalid response');
      this.reply(response.transcript, 'transcript');
    } catch (error) {
      if (generation !== this.generation) return;
      const code = (error as { code?: string }).code?.replace('functions/', '');
      const messages: Record<string, string> = {
        unauthenticated: 'Sign in again to record.', 'invalid-argument': 'No usable speech recorded. Try again.',
        'resource-exhausted': 'Recording limit reached or another recording is processing. Try later.',
        unavailable: 'Could not confirm whether the recording was saved.',
        aborted: 'The previous recording is still processing.',
        'failed-precondition': 'Recording failed or voice input is unavailable. Record again later.'
      };
      this.reply(messages[code || ''] || 'Could not confirm whether the recording was saved.', 'error');
    } finally { if (generation === this.generation) this.changed.next(); }
  }

  cancel(message = ''): void {
    if (this.phase !== 'recording' && this.phase !== 'requesting') return;
    this.generation++; this.capture.cancel(); clearTimeout(this.timer);
    this.clearLevels();
    if (message) this.reply(message, 'error');
    else this.phase = 'idle';
    this.changed.next();
  }
  private reply(text: string, kind: VoiceReply['kind']): void {
    this.replies.push({ id: ++this.replyId, kind, text });
    this.phase = kind === 'transcript' ? 'saved' : 'error';
  }
  private clearLevels(): void { this.levels = Array<number>(9).fill(0); }
  private reset(): void {
    this.clearLevels();
    this.capture.cancel(); clearTimeout(this.timer);
    this.phase = 'idle'; this.replies.length = 0; this.changed.next();
  }
  ngOnDestroy(): void { this.generation++; this.reset(); this.subscription.unsubscribe(); this.changed.complete(); }
}
