// Batches mono samples; the hard sample cap holds even if main-thread timers stall.
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.offset = this.total = 0;
    this.active = true;
    this.port.onmessage = event => {
      if (event.data === 'stop') {
        this.active = false;
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
    if (!this.active) return true;
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      this.buffer[this.offset++] = sample;
      this.total++;
      if (this.offset === this.buffer.length) this.flush();
      if (this.total === 480000) {
        this.active = false;
        this.flush();
        this.port.postMessage({ type: 'limit' });
        break;
      }
    }
    return true;
  }
}
registerProcessor('voice-capture', VoiceCapture);
