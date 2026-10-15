import type { LiveSample } from './sessionHistory';

// Use Unity's monotonic wall clock, so browser latency and dropped snapshots do not skew speed.
export class SimulationPace {
  private samples: Pick<LiveSample, 'time' | 'simulationTime' | 'paused'>[] = [];
  reset() { this.samples = []; }
  update(sample: LiveSample) {
    const last = this.samples[this.samples.length - 1];
    if (last && (sample.time < last.time || sample.simulationTime < last.simulationTime)) this.reset();
    if (last && sample.time === last.time) this.samples.pop();
    this.samples.push(sample);
    while (this.samples.length > 2 && this.samples[1].time <= sample.time - 5) this.samples.shift();
  }
  get ratio() {
    const first = this.samples[0], last = this.samples[this.samples.length - 1];
    if (!last) return undefined;
    if (last.paused) return 0;
    const elapsed = last.time - first.time;
    return elapsed >= 1 ? (last.simulationTime - first.simulationTime) / elapsed : undefined;
  }
}
export function simulationDuration(seconds: number) {
  const total = Math.max(0, Math.floor(seconds)), hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60, rest = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}
