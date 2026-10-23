import { Injectable, OnDestroy } from '@angular/core';

/** Capture and replay share one page-owned output context; mic tracks stay in capture. */
@Injectable()
export class VoiceAudioSessionService implements OnDestroy {
  private context?: AudioContext;
  private captureModule?: Promise<void>;
  private destroyed = false;
  private session?: { type: string };
  private previousType?: string;
  private selectedType?: string;

  get current(): AudioContext | undefined { return this.context; }
  acquire(mode: 'playback' | 'play-and-record' = 'playback'): AudioContext {
    if (this.destroyed) throw new Error('Voice page closed.');
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext({ sampleRate: 16000 }); this.captureModule = undefined;
    }
    this.selectMode(mode);
    return this.context;
  }
  releaseCapture(context: AudioContext): void {
    if (!this.destroyed && context === this.context) this.selectMode('playback');
  }
  private selectMode(mode: 'playback' | 'play-and-record'): void {
    // Safari's default Web Audio session obeys the iPhone silent switch.
    // Feature-detect the optional API; unsupported browsers keep their behavior.
    try {
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (!session) return;
      const previous = session.type;
      if (previous !== mode) session.type = mode;
      if (!this.session) { this.session = session; this.previousType = previous; }
      this.selectedType = mode;
    } catch { /* Optional audio-session support must not prevent capture or replay. */ }
  }
  prepareCapture(context: AudioContext): Promise<void> {
    if (this.destroyed || context !== this.context) return Promise.reject(new Error('Voice page closed.'));
    return this.captureModule ??= context.audioWorklet.addModule('/assets/voice-input/capture.worklet.js?v=2');
  }
  reset(context = this.context): void {
    if (this.context === context) { this.context = undefined; this.captureModule = undefined; }
    if (context) {
      context.onstatechange = null;
      void context.close().catch(() => {});
    }
  }
  ngOnDestroy(): void {
    this.destroyed = true; this.reset();
    try {
      if (this.session && this.session.type === this.selectedType && this.previousType !== undefined) {
        this.session.type = this.previousType;
      }
    } catch { /* The browser may reject restoration during navigation. */ }
    this.session = undefined;
  }
}
