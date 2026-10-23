import { Injectable, OnDestroy } from '@angular/core';
import { MAX_VOICE_SAMPLES, voiceWav } from './voiceAudio';
import { voiceCue } from './voiceCue';
import type { VoiceCueEvent } from './voiceCue';

@Injectable()
export class VoiceCaptureService implements OnDestroy {
  private context?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private mute?: GainNode;
  private samples?: Float32Array;
  private length = 0;
  private closingCue = false;
  private connectedAt = 0;
  private lastSampleAt = 0;
  private generation = 0;
  private stopped?: () => void;
  private startupCancelled?: () => void;
  private audioTrace: string[] = [];
  private audioTraceSince = 0;
  private openingCue = 'idle';
  private closingCueState = 'idle';

  get diagnostics() {
    const tracks = this.stream?.getAudioTracks() || [];
    return {
      supported: !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined',
      context: this.context?.state || 'Idle', liveTracks: tracks.filter(track => track.readyState === 'live').length,
      muted: tracks.some(track => track.muted), permissionPending: !!this.startupCancelled && !this.stream,
      worklet: !!this.node, durationMs: this.length / 16, connectedAt: this.connectedAt, lastSampleAt: this.lastSampleAt,
      openingCue: this.openingCue, closingCue: this.closingCueState, audioTrace: this.audioTrace.join('\n')
    };
  }

  async start(onLimit: () => void, onError: () => void, onLevel?: (level: number) => void): Promise<boolean> {
    this.cancel();
    const generation = this.generation;
    this.audioTrace = []; this.audioTraceSince = performance.now();
    this.openingCue = this.closingCueState = 'idle';
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined'
      || typeof AudioWorkletNode === 'undefined') throw new Error('Voice recording requires a supported browser on HTTPS.');
    const context = new AudioContext({ sampleRate: 16000 });
    this.context = context;
    const note = (event: string) => { if (generation === this.generation) this.noteAudio(event, context); };
    note(`Context created · ${context.sampleRate}Hz`);
    context.onstatechange = () => note('Context changed');
    // Begin in the gesture, but do not wait on this promise: Safari can leave it
    // pending until microphone activation changes the system audio session.
    void context.resume().then(() => note('Gesture resume resolved'), () => note('Gesture resume rejected'));
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    let armTimeout: () => void;
    const deadline = new Promise<never>((_, reject) => {
      armTimeout = () => {
        startupTimer = setTimeout(() => reject(new Error('Microphone startup timed out.')), 5000);
      };
    });
    const cancelled = new Promise<boolean>(resolve => { this.startupCancelled = () => resolve(false); });
    const requested = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    try {
      // Each promise has a rejection handler while the permission prompt is open.
      const prepared = Promise.all([requested.then(stream => {
        if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
        this.stream = stream;
        note('Mic acquired');
        // Only time out after permission is granted. One resume after acquisition
        // handles the audio-session change; no polling or automatic capture retry.
        armTimeout();
        if (context.state === 'running') return;
        note('Mic resume requested');
        return context.resume().then(() => note('Mic resume resolved'));
      }), context.audioWorklet.addModule('/assets/voice-input/capture.worklet.js?v=2')]).then(() => true);
      if (!await Promise.race([prepared, cancelled, deadline]) || generation !== this.generation) return false;
      if (context.sampleRate !== 16000 || context.state !== 'running') throw new Error('Could not start audio. Start recording again.');
      note('Capture prepared');
      this.samples = new Float32Array(MAX_VOICE_SAMPLES); this.length = 0;
      const interrupted = () => { if (generation === this.generation) onError(); };
      let inputReady: () => void;
      const ready = new Promise<boolean>(resolve => { inputReady = () => resolve(true); });
      let capturing = false;
      this.node = new AudioWorkletNode(context, 'voice-capture', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { deferCapture: true }
      });
      this.node.port.onmessage = ({ data }) => {
        if (generation !== this.generation) return;
        if (data.type === 'ready') { note('Input ready'); inputReady(); }
        else if (data.type === 'samples' && data.samples instanceof Float32Array) {
          if (!capturing) return;
          this.lastSampleAt = Date.now();
          const samples = data.samples.subarray(0, MAX_VOICE_SAMPLES - this.length);
          this.samples?.set(samples, this.length); this.length += samples.length;
          // Reuse captured batches (about eight per second); no extra stream or polling.
          if (samples.length && onLevel) {
            let energy = 0;
            for (const sample of samples) energy += sample * sample;
            onLevel(Math.min(1, Math.sqrt(energy / samples.length) * 8));
          }
        } else if (data.type === 'limit') onLimit();
        else if (data.type === 'stopped') this.stopped?.();
      };
      this.node.onprocessorerror = interrupted;
      context.onstatechange = () => { note('Context changed'); if (generation === this.generation && context.state !== 'running') onError(); };
      this.stream!.getAudioTracks().forEach(track => { track.onended = interrupted; });
      this.mute = context.createGain(); this.mute.gain.value = 0;
      this.source = context.createMediaStreamSource(this.stream!);
      this.node.connect(this.mute); this.mute.connect(context.destination);
      // Establish the mic graph before scheduling feedback. A running context
      // alone can still be catching up after mobile audio-session changes.
      // The worklet discards input until explicitly armed, including cue audio.
      this.source.connect(this.node); this.connectedAt = Date.now();
      note('Mic connected');
      if (!await Promise.race([ready, cancelled, deadline]) || generation !== this.generation) return false;
      if (!await Promise.race([voiceCue(context, true, this.observeCue(context, true)).then(() => true), cancelled, deadline])
        || generation !== this.generation) return false;
      capturing = true;
      this.node!.port.postMessage('start');
      note('Capture armed');
      return true;
    } catch (error) {
      // Stop a late permission grant even if worklet setup failed first.
      void requested.then(stream => stream.getTracks().forEach(track => track.stop()), () => undefined);
      if (generation !== this.generation) return false;
      this.cancel();
      throw error;
    } finally {
      clearTimeout(startupTimer);
      if (generation === this.generation) this.startupCancelled = undefined;
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
    } finally {
      if (generation === this.generation) {
        const context = this.context;
        if (context) context.onstatechange = null;
        // Keep the device audio route stable while playing the closing cue.
        // The worklet is stopped and disconnected; no further samples are kept.
        this.disconnectCapture();
        if (context) this.noteAudio('Capture drained', context);
        this.closingCue = true;
        if (context) await voiceCue(context, false, this.observeCue(context, false));
        if (generation === this.generation) this.cancel();
      }
    }
  }

  silenceClosingCue(): void { if (this.closingCue) this.cancel(); }

  cancel(): void {
    if (this.context) this.noteAudio('Releasing audio', this.context);
    if (this.openingCue === 'scheduled') this.openingCue = 'cancelled';
    if (this.closingCueState === 'scheduled') this.closingCueState = 'cancelled';
    this.generation++;
    this.startupCancelled?.(); this.startupCancelled = undefined;
    this.stopped?.(); this.stopped = undefined;
    this.closingCue = false; this.connectedAt = 0; this.lastSampleAt = 0;
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); this.stream = undefined;
    this.disconnectCapture();
    if (this.context) { this.context.onstatechange = null; void this.context.close().catch(() => undefined); }
    this.context = undefined;
  }
  private observeCue(context: AudioContext, opening: boolean): (event: VoiceCueEvent) => void {
    const generation = this.generation;
    return event => {
      if (generation !== this.generation) return;
      if (opening) this.openingCue = event; else this.closingCueState = event;
      this.noteAudio(`${opening ? 'Opening' : 'Closing'} ${event}`, context);
    };
  }
  private noteAudio(event: string, context: AudioContext): void {
    // Local machine state only. Preserve opening evidence within a fixed budget;
    // repeated state changes cannot displace it or create unbounded session work.
    if (this.audioTrace.length >= 16) return;
    const ms = (value?: number) => Number.isFinite(value) ? Math.round(value! * 1000) + 'ms' : '?';
    let output: number | undefined;
    try { output = context.getOutputTimestamp?.().contextTime; } catch { /* Optional browser diagnostic. */ }
    this.audioTrace.push(`+${Math.round(performance.now() - this.audioTraceSince)}ms ${event} · ${context.state} · audio ${ms(context.currentTime)} · output ${ms(output)}`);
  }
  private disconnectCapture(): void {
    if (this.node) { this.node.onprocessorerror = null; this.node.port.onmessage = null; this.node.port.close(); this.node.disconnect(); }
    this.node = undefined; this.source?.disconnect(); this.source = undefined;
    this.mute?.disconnect(); this.mute = undefined;
    this.samples = undefined; this.length = 0;
  }
  ngOnDestroy(): void { this.cancel(); }
}
