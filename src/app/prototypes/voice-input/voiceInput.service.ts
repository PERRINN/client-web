import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { firstValueFrom, Subject, Subscription } from 'rxjs';
import { VoiceCaptureService } from './voiceCapture.service';
import { voiceBase64 } from './voiceAudio';

interface VoiceRequest { requestId: string; audio: string; sourcePage: string }
interface VoiceResult { eventId: string; transcript: string }
type Phase = 'idle' | 'requesting' | 'recording' | 'sending' | 'saved' | 'error';

@Injectable()
export class VoiceInputService implements OnDestroy {
  readonly changed = new Subject<void>();
  ready = false;
  uid = '';
  phase: Phase = 'idle';
  error = '';
  transcript = '';
  eventId = '';
  pending?: VoiceRequest;
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
  get canRecord(): boolean { return this.ready && !!this.uid && !this.busy && !this.pending; }
  get label(): string {
    return ({ idle: 'Hold to talk', requesting: 'Allow microphone', recording: 'Recording', sending: 'Transcribing', saved: 'Hold to talk', error: 'Hold to talk' })[this.phase];
  }

  async press(): Promise<void> {
    if (!this.canRecord) return;
    const generation = ++this.generation;
    this.phase = 'requesting'; this.error = ''; this.transcript = ''; this.eventId = '';
    try {
      const started = await this.capture.start(
        () => this.zone.run(() => { void this.release(); }),
        () => this.zone.run(() => this.cancel('Recording interrupted. Try again.'))
      );
      if (!started || generation !== this.generation) return;
      this.phase = 'recording';
      this.timer = setTimeout(() => { void this.release(); }, 30000);
    } catch (error) {
      if (generation !== this.generation) return;
      const name = (error as { name?: string }).name;
      this.error = name === 'NotAllowedError' ? 'Microphone access denied. Allow it in your browser to record.'
        : name === 'NotFoundError' ? 'No microphone found.'
        : error instanceof Error && error.message.startsWith('Voice recording requires') ? error.message : 'Could not start the microphone. Try again.';
      this.phase = 'error';
    } finally { if (generation === this.generation) this.changed.next(); }
  }

  async release(): Promise<void> {
    if (this.phase === 'requesting') { this.cancel(); return; }
    if (this.phase !== 'recording') return;
    clearTimeout(this.timer);
    const generation = this.generation;
    this.phase = 'sending';
    try {
      const audio = await this.capture.finish();
      if (generation !== this.generation) return;
      this.pending = { requestId: crypto.randomUUID(), audio: voiceBase64(audio), sourcePage: '/prototypes/voice-input' };
      await this.submit();
    } catch (error) {
      if (generation !== this.generation) return;
      this.error = error instanceof Error ? error.message : 'Could not capture audio. Try again.';
      this.phase = 'error';
    } finally { if (generation === this.generation) this.changed.next(); }
  }

  async check(): Promise<void> { if (this.pending && !this.busy) await this.submit(); }
  recordAgain(): void { if (!this.busy) { this.generation++; this.reset(); } }

  private async submit(): Promise<void> {
    if (!this.pending || !this.uid) return;
    const generation = this.generation, uid = this.uid;
    this.phase = 'sending'; this.error = ''; this.changed.next();
    try {
      const user = await this.auth.currentUser;
      if (generation !== this.generation) return;
      if (!user || user.uid !== uid) { this.reset(); return; }
      const response = await firstValueFrom(this.functions.httpsCallable<VoiceRequest, VoiceResult>('voiceInput', { timeout: 65000 })(this.pending));
      if (generation !== this.generation || uid !== this.uid) return;
      if (!response?.eventId || typeof response.transcript !== 'string') throw new Error('Invalid response');
      this.transcript = response.transcript; this.eventId = response.eventId;
      this.pending = undefined; this.phase = 'saved';
    } catch (error) {
      if (generation !== this.generation) return;
      const code = (error as { code?: string }).code?.replace('functions/', '');
      const messages: Record<string, string> = {
        unauthenticated: 'Sign in again to record.', 'invalid-argument': 'No usable speech recorded. Try again.',
        'resource-exhausted': 'Recording limit reached or another recording is processing. Try later.',
        unavailable: 'Transcription failed or connection lost. Check this recording before recording again.',
        aborted: 'Recording is still processing. Check again shortly.',
        'failed-precondition': 'Recording failed or voice input is unavailable. Record again later.'
      };
      this.error = messages[code || ''] || 'Result unknown. Check this recording before recording again.';
      // Keep identical bytes/ID for explicit checks; the backend never repeats a provider call for that ID.
      if (['unauthenticated', 'invalid-argument', 'resource-exhausted'].includes(code || '')) this.pending = undefined;
      this.phase = 'error';
    } finally { if (generation === this.generation) this.changed.next(); }
  }

  cancel(message = ''): void {
    if (this.phase !== 'recording' && this.phase !== 'requesting') return;
    this.generation++; this.capture.cancel(); clearTimeout(this.timer);
    this.error = message; this.phase = message ? 'error' : 'idle'; this.changed.next();
  }
  private reset(): void {
    this.capture.cancel(); clearTimeout(this.timer); this.pending = undefined;
    this.phase = 'idle'; this.error = this.transcript = this.eventId = ''; this.changed.next();
  }
  ngOnDestroy(): void { this.generation++; this.reset(); this.subscription.unsubscribe(); this.changed.complete(); }
}
