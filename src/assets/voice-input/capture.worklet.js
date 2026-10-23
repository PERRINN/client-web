// Batches mono samples; the hard sample cap holds even if main-thread timers stall.
class VoiceCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.buffer = new Float32Array(2048);
    this.offset = this.total = 0;
    // Older clients start immediately. New clients first establish the audio
    // graph, then arm capture after their opening cue has finished.
    this.active = !options?.processorOptions?.deferCapture;
    this.ready = this.stopped = false;
    this.port.onmessage = event => {
      if (event.data === 'start' && !this.stopped) this.active = true;
      else if (event.data === 'stop') {
        this.active = false;
        this.stopped = true;
        this.flush();
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }
  flush() {
    if (!this.offset) return;
    const samples = this.buffer.slice(0, this.offset);
    this.port.postMessage({ type: 'samples', samples }, [samples.buffer]);
    this.offset = 0;
  }
  process(inputs) {
    if (this.stopped) return true;
    const input = inputs[0]?.[0];
    if (!this.ready && input?.length) {
      this.ready = true;
      this.port.postMessage({ type: 'ready' });
    }
    if (!this.active || !input) return true;
    for (const sample of input) {
      this.buffer[this.offset++] = sample;
      this.total++;
      if (this.offset === this.buffer.length) this.flush();
      if (this.total === 480000) {
        this.active = false;
        this.stopped = true;
        this.flush();
        this.port.postMessage({ type: 'limit' });
        break;
      }
    }
    return true;
  }
}
registerProcessor('voice-capture', VoiceCapture);
