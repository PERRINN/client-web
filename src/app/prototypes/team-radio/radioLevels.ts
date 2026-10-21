export const SILENT_LEVELS = [0, 0, 0, 0, 0];

/** A read-only tap: never connect microphone monitoring to the speakers. */
export class RadioLevels {
  private analyser: AnalyserNode;
  private samples = new Float32Array(1024);

  constructor(context: AudioContext, private source: AudioNode) {
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = this.samples.length;
    source.connect(this.analyser);
  }

  read() {
    this.analyser.getFloatTimeDomainData(this.samples);
    return SILENT_LEVELS.map((_, bar) => {
      const start = Math.floor(bar * this.samples.length / 5);
      const end = Math.floor((bar + 1) * this.samples.length / 5);
      let energy = 0;
      for (let index = start; index < end; index++) energy += this.samples[index] ** 2;
      const rms = Math.sqrt(energy / (end - start));
      // A fixed -60dB to 0dB range; no automatic gain or invented animation.
      return Math.max(0, Math.min(1, (20 * Math.log10(rms || 1e-10) + 60) / 60));
    });
  }

  close() {
    this.source.disconnect(this.analyser);
    this.analyser.disconnect();
  }
}
