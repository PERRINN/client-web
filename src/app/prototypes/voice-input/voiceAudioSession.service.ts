import { Injectable, OnDestroy } from '@angular/core';

/** Capture and replay share one page-owned output context; mic tracks stay in capture. */
@Injectable()
export class VoiceAudioSessionService implements OnDestroy {
  private context?: AudioContext;
  private captureModule?: Promise<void>;
  private destroyed = false;

  get current(): AudioContext | undefined { return this.context; }
  acquire(): AudioContext {
    if (this.destroyed) throw new Error('Voice page closed.');
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext({ sampleRate: 16000 }); this.captureModule = undefined;
    }
    return this.context;
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
  ngOnDestroy(): void { this.destroyed = true; this.reset(); }
}
