import { Injectable, OnDestroy } from '@angular/core';
import { MAX_VOICE_SAMPLES, voiceWav } from './voiceAudio';

@Injectable()
export class VoiceCaptureService implements OnDestroy {
  private context?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private mute?: GainNode;
  private samples?: Float32Array;
  private length = 0;
  private generation = 0;
  private stopped?: () => void;

  async start(onLimit: () => void, onError: () => void): Promise<boolean> {
    this.cancel();
    const generation = this.generation;
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined'
      || typeof AudioWorkletNode === 'undefined') throw new Error('Voice recording requires a supported browser on HTTPS.');
    const context = new AudioContext({ sampleRate: 16000 });
    this.context = context;
    // Both operations begin in the trusted pointer/key gesture.
    const resumed = context.resume();
    const requested = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    try {
      // Each promise has a rejection handler while the permission prompt is open.
      await Promise.all([requested.then(stream => {
        if (generation !== this.generation) stream.getTracks().forEach(track => track.stop());
        else this.stream = stream;
      }), resumed, context.audioWorklet.addModule('/assets/voice-input/capture.worklet.js')]);
      if (generation !== this.generation) return false;
      if (context.sampleRate !== 16000 || context.state !== 'running') throw new Error('Could not start audio. Press and hold again.');
      this.samples = new Float32Array(MAX_VOICE_SAMPLES); this.length = 0;
      const interrupted = () => { if (generation === this.generation) onError(); };
      this.node = new AudioWorkletNode(context, 'voice-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.node.port.onmessage = ({ data }) => {
        if (generation !== this.generation) return;
        if (data.type === 'samples' && data.samples instanceof Float32Array) {
          const samples = data.samples.subarray(0, MAX_VOICE_SAMPLES - this.length);
          this.samples?.set(samples, this.length); this.length += samples.length;
        } else if (data.type === 'limit') onLimit();
        else if (data.type === 'stopped') this.stopped?.();
      };
      this.node.onprocessorerror = interrupted;
      context.onstatechange = () => { if (generation === this.generation && context.state !== 'running') onError(); };
      this.stream!.getAudioTracks().forEach(track => { track.onended = interrupted; });
      this.mute = context.createGain(); this.mute.gain.value = 0;
      this.source = context.createMediaStreamSource(this.stream!);
      this.source.connect(this.node); this.node.connect(this.mute); this.mute.connect(context.destination);
      return true;
    } catch (error) {
      // Stop a late permission grant even if worklet setup failed first.
      void requested.then(stream => stream.getTracks().forEach(track => track.stop()), () => undefined);
      if (generation !== this.generation) return false;
      this.cancel();
      throw error;
    }
  }

  async finish(): Promise<Uint8Array> {
    if (!this.node) throw new Error('No recording available.');
    const generation = this.generation;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Recording interrupted. Try again.')), 1000);
        this.stopped = () => { clearTimeout(timer); resolve(); };
        this.node!.port.postMessage('stop');
      });
      if (generation !== this.generation || !this.samples) throw new Error('Recording cancelled.');
      return voiceWav(this.samples.subarray(0, this.length));
    } finally { if (generation === this.generation) this.cancel(); }
  }

  cancel(): void {
    this.generation++;
    this.stopped?.(); this.stopped = undefined;
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); this.stream = undefined;
    if (this.node) { this.node.onprocessorerror = null; this.node.port.onmessage = null; this.node.port.close(); this.node.disconnect(); }
    this.node = undefined; this.source?.disconnect(); this.source = undefined;
    this.mute?.disconnect(); this.mute = undefined;
    if (this.context) { this.context.onstatechange = null; void this.context.close().catch(() => undefined); }
    this.context = undefined; this.samples = undefined; this.length = 0;
  }
  ngOnDestroy(): void { this.cancel(); }
}
