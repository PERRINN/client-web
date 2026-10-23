import { Injectable, OnDestroy } from '@angular/core';
import type { VoiceDiagnosticRow } from './voiceDiagnostics';

type AudioMode = 'playback' | 'play-and-record';
export type VoicePageEvent = 'Page hidden' | 'Page visible' | 'Page hide' | 'Page show' | 'Window blur' | 'Window focus';

/** Capture and replay share one page-owned output context; mic tracks stay in capture. */
@Injectable()
export class VoiceAudioSessionService implements OnDestroy {
  private context?: AudioContext;
  private captureModule?: Promise<void>;
  private destroyed = false;
  private session?: { type: string };
  private previousType?: string;
  private selectedType?: string;
  private contextId = 0;
  private pendingResumes = 0;
  private lastResume = 'Not requested';
  private sessionFault = false;
  private trace: string[] = [];
  private contextChanged?: () => void;
  private captureActive = false;
  private releasePending = false;

  get current(): AudioContext | undefined { return this.context; }
  acquire(mode: AudioMode = 'playback'): AudioContext {
    if (this.destroyed) throw new Error('Voice page closed.');
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext({ sampleRate: 16000 }); this.captureModule = undefined;
      this.contextId++;
      this.contextChanged = () => this.note('Context changed');
      this.context.addEventListener?.('statechange', this.contextChanged);
      this.note('Context created');
    }
    this.selectMode(mode);
    this.captureActive = mode === 'play-and-record';
    return this.context;
  }
  resume(context: AudioContext, reason: 'Playback' | 'Capture gesture' | 'Microphone acquired'): Promise<void> {
    if (this.destroyed || context !== this.context) return Promise.reject(new Error('Voice page closed.'));
    this.pendingResumes++; this.lastResume = `${reason} pending`; this.note(this.lastResume);
    return context.resume().then(() => {
      if (context !== this.context) return;
      this.pendingResumes--; this.lastResume = `${reason} resolved`; this.note(this.lastResume);
    }, error => {
      if (context === this.context) {
        this.pendingResumes--; this.lastResume = `${reason} rejected`; this.note(this.lastResume);
      }
      throw error;
    });
  }
  releaseCapture(context: AudioContext): void {
    if (this.destroyed || context !== this.context) return;
    this.captureActive = false;
    if (this.releasePending) this.release(); else this.selectMode('playback');
  }
  private selectMode(mode: AudioMode): void {
    // Safari's default Web Audio session obeys the iPhone silent switch.
    // Feature-detect the optional API; unsupported browsers keep their behavior.
    try {
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (!session) return;
      const previous = session.type;
      if (previous !== mode) session.type = mode;
      if (!this.session) { this.session = session; this.previousType = previous; }
      this.selectedType = mode;
      this.sessionFault = false;
      if (previous !== mode) this.note(`Mode ${mode}`);
    } catch { this.sessionFault = true; this.note('Mode rejected'); }
  }
  private get systemSession(): string {
    try {
      const session = (navigator as Navigator & { audioSession?: { type: string; state?: string } }).audioSession;
      if (!session) return 'Unsupported';
      const type = ['auto', 'ambient', 'playback', 'play-and-record', 'transient', 'transient-solo'].includes(session.type) ? session.type : 'Unknown';
      const state = ['inactive', 'active', 'interrupted'].includes(session.state || '') ? session.state : 'Unknown';
      return `${type} · ${state}`;
    } catch { return 'Unavailable'; }
  }
  note(event: string): void {
    const now = new Date(), time = `${now.toTimeString().slice(0, 8)}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    this.trace.push(`${time} ${event} · c${this.contextId} ${this.context?.state || 'released'} · ${this.systemSession} · resume ${this.pendingResumes}`);
    if (this.trace.length > 24) this.trace.shift();
  }
  get diagnosticRows(): VoiceDiagnosticRow[] {
    const state = this.context?.state || 'Released', session = this.systemSession;
    return [
      { label: 'Shared context', value: `c${this.contextId} · ${state}`, ok: state !== 'interrupted' },
      { label: 'Audio session', value: session, ok: !this.sessionFault && !session.includes('interrupted') && session !== 'Unavailable' },
      { label: 'Resume', value: `${this.lastResume} · ${this.pendingResumes} pending`, ok: state === 'running' || !this.pendingResumes && !this.lastResume.endsWith('rejected') },
      { label: 'Session trace', value: this.trace.join('\n') || 'No audio events', ok: true }
    ];
  }
  prepareCapture(context: AudioContext): Promise<void> {
    if (this.destroyed || context !== this.context) return Promise.reject(new Error('Voice page closed.'));
    return this.captureModule ??= context.audioWorklet.addModule('/assets/voice-input/capture.worklet.js?v=2');
  }
  reset(context = this.context): void {
    if (this.context === context) {
      this.note('Context release');
      if (this.contextChanged) context?.removeEventListener?.('statechange', this.contextChanged);
      this.contextChanged = undefined; this.context = undefined; this.captureModule = undefined;
      this.captureActive = false; this.releasePending = false;
      this.pendingResumes = 0; this.lastResume = 'Released';
    }
    if (context) {
      context.onstatechange = null;
      void context.close().catch(() => this.note('Context close rejected'));
    }
  }
  release(): void {
    // A submitted recording may still be draining its last worklet block.
    // Its normal releaseCapture call completes this release without losing audio.
    if (this.captureActive) { this.releasePending = true; this.note('Release after capture drain'); return; }
    this.reset();
    try {
      if (this.session && this.session.type === this.selectedType && this.previousType !== undefined) {
        this.session.type = this.previousType;
        this.note('Mode restored');
      }
    } catch { this.sessionFault = true; this.note('Mode restoration rejected'); }
    this.session = undefined;
  }
  ngOnDestroy(): void { this.destroyed = true; this.captureActive = false; this.release(); }
}
