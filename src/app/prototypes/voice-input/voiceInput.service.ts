import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Subject, Subscription } from 'rxjs';
import { VoiceCaptureService } from './voiceCapture.service';
import { VoiceQueueService } from './voiceQueue.service';
import { VoiceRecording } from './voiceQueueStore.service';
import { voiceDiagnosticCode } from './voiceDiagnostics';
import { defaultVoiceEchoCancellation } from './voiceCaptureSettings';

export interface VoiceReply { id: number; kind: 'transcript' | 'error' | 'pending'; text: string; createdAt?: number; private?: boolean; recording?: VoiceRecording }
type Phase = 'idle' | 'requesting' | 'recording' | 'sending' | 'saved' | 'error';

@Injectable()
export class VoiceInputService implements OnDestroy {
  readonly changed = new Subject<void>();
  levels = Array<number>(9).fill(0);
  ready = false;
  uid = '';
  private accessUid = '';
  private accessGranted = false;
  get allowed(): boolean { return this.accessGranted && !!this.uid && this.uid === this.accessUid; }
  private currentPhase: Phase = 'idle';
  phaseSince = Date.now();
  captureFailure = '';
  testingCue = false;
  private requestedEchoCancellation = defaultVoiceEchoCancellation();
  get phase(): Phase { return this.currentPhase; }
  set phase(value: Phase) { if (value !== this.currentPhase) this.phaseSince = Date.now(); this.currentPhase = value; }
  get captureDiagnostics() { return this.capture.diagnostics; }
  readonly replies: VoiceReply[] = [];
  private replyId = 0;
  private generation = 0;
  private captureGeneration = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private subscription: Subscription;

  constructor(private auth: AngularFireAuth, public queue: VoiceQueueService,
    private capture: VoiceCaptureService, private zone: NgZone) {
    this.subscription = new Subscription();
    this.subscription.add(queue.changed.subscribe(() => {
      const ids = new Set(queue.items.map(item => item.id));
      for (let i = this.replies.length - 1; i >= 0; i--) {
        const reply = this.replies[i];
        if (reply.kind === 'pending' && reply.recording && !ids.has(reply.recording.id)) this.replies.splice(i, 1);
      }
      for (const item of queue.items) {
        let reply = this.replies.find(row => row.recording?.id === item.id);
        if (!reply) { reply = { id: ++this.replyId, kind: 'pending', text: '', createdAt: item.createdAt, recording: item }; this.replies.push(reply); }
        reply.recording = item; reply.text = item.error || '';
      }
      this.changed.next();
    }));
    this.subscription.add(queue.completed.subscribe(result => {
      const reply = this.replies.find(row => row.recording?.id === result.id);
      if (result.conversationId && !result.failed) {
        if (reply) this.replies.splice(this.replies.indexOf(reply), 1);
      } else if (reply) { reply.kind = result.failed ? 'error' : 'transcript'; reply.text = result.transcript; reply.private = !result.conversationId; reply.recording = undefined; }
      else this.reply(result.transcript, result.failed ? 'error' : 'transcript', !result.conversationId);
      if (!this.busy) this.phase = 'saved';
      this.changed.next();
    }));
    this.subscription.add(auth.authState.subscribe({
      next: user => {
        if (this.uid !== (user?.uid || '')) { this.generation++; this.reset(); }
        const uid = user?.uid || '';
        if (this.uid !== uid) { this.uid = uid; queue.start(this.allowed ? uid : ''); }
        this.ready = true; this.changed.next();
      },
      error: () => { this.generation++; this.reset(); this.uid = ''; queue.start(''); this.ready = true; this.changed.next(); }
    }));
  }
  setAccess(allowed: boolean, uid = this.uid): void {
    if (allowed === this.accessGranted && uid === this.accessUid) return;
    this.accessGranted = allowed; this.accessUid = uid; this.generation++; this.reset();
    this.queue.start(this.allowed ? this.uid : ''); this.changed.next();
  }
  get pendingCount(): number { return this.queue.items.length; }
  get busy(): boolean { return this.phase === 'requesting' || this.phase === 'recording' || this.phase === 'sending'; }
  get canRecord(): boolean { return this.ready && this.allowed && !!this.uid && !this.busy && this.queue.canRecord; }
  get canToggle(): boolean { return this.canRecord || this.phase === 'recording' || this.phase === 'requesting'; }
  get waiting(): boolean { return this.phase === 'sending' || (!this.canToggle && !!this.uid && !this.queue.canRecord); }
  get label(): string {
    if (this.phase === 'sending') return 'Preparing recording';
    if (this.waiting) return 'Recording queue unavailable or full';
    return ({ idle: 'Start recording', requesting: 'Cancel microphone', recording: 'Stop recording', sending: 'Preparing recording', saved: 'Start recording', error: 'Start recording' })[this.phase];
  }

  get echoCancellation(): boolean { return this.requestedEchoCancellation; }
  get canConfigureCapture(): boolean { return this.allowed && !this.busy; }
  setEchoCancellation(enabled: boolean): void {
    if (!this.canConfigureCapture) return;
    this.requestedEchoCancellation = enabled; this.changed.next();
  }
  get canTestCue(): boolean { return this.allowed && this.phase === 'recording' && !this.testingCue; }
  async testCue(opening: boolean): Promise<void> {
    if (!this.canTestCue) return;
    const generation = this.captureGeneration;
    this.testingCue = true; this.changed.next();
    try { await this.capture.testCue(opening); }
    finally {
      if (generation === this.captureGeneration) { this.testingCue = false; this.changed.next(); }
    }
  }

  async press(): Promise<void> {
    if (!this.canRecord) return;
    const generation = ++this.captureGeneration;
    this.captureFailure = ''; this.testingCue = false; this.clearLevels();
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
        }, this.requestedEchoCancellation
      );
      if (!started || generation !== this.captureGeneration) return;
      this.phase = 'recording';
      this.timer = setTimeout(() => { void this.release(); }, 30000);
    } catch (error) {
      if (generation !== this.captureGeneration) return;
      this.captureFailure = voiceDiagnosticCode(error);
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
      await this.queue.enqueue(audio, 'pilot');
      if (generation === this.generation) this.phase = this.replies.at(-1)?.kind === 'transcript' ? 'saved' : 'idle';
    } catch (error) {
      if (generation !== this.generation || captureGeneration !== this.captureGeneration) return;
      this.captureFailure = voiceDiagnosticCode(error);
      this.phase = 'idle'; this.reply(error instanceof Error ? error.message : 'Could not capture audio. Try again.', 'error');
    } finally { if (generation === this.generation) this.changed.next(); }
  }

  cancel(message = ''): void {
    if (this.phase === 'sending') { this.capture.silenceClosingCue(); return; }
    if (this.phase !== 'recording' && this.phase !== 'requesting') return;
    this.captureGeneration++; this.testingCue = false; this.capture.cancel(); clearTimeout(this.timer);
    this.clearLevels();
    this.phase = 'idle';
    if (message) { this.captureFailure = 'Interrupted'; this.reply(message, 'error'); }
    this.changed.next();
  }
  private reply(text: string, kind: VoiceReply['kind'], privateReply = false): void {
    this.replies.push({ id: ++this.replyId, kind, text, createdAt: Date.now(), private: privateReply });
    if (!this.busy) this.phase = kind === 'transcript' ? 'saved' : 'error';
  }
  private clearLevels(): void { this.levels = Array<number>(9).fill(0); }
  private reset(): void {
    this.captureFailure = ''; this.captureGeneration++; this.testingCue = false;
    this.requestedEchoCancellation = defaultVoiceEchoCancellation();
    this.clearLevels();
    this.capture.cancel(); clearTimeout(this.timer);
    this.phase = 'idle'; this.replies.length = 0; this.changed.next();
  }
  ngOnDestroy(): void { this.generation++; this.reset(); this.queue.start(''); this.subscription.unsubscribe(); this.changed.complete(); }
}
