import { LiveSample, SessionHistory } from './sessionHistory';

// The map is a projection of recorded world X/Z positions, with equal scale on both axes.
export class TrackTrajectory {
  path = '';
  private history?: SessionHistory;
  private x = -1;
  private z = -1;
  private scale = 1;
  private centerX = 0;
  private centerZ = 0;
  update(history: SessionHistory, channels: string[]) {
    this.history = history; this.x = channels.indexOf('PositionX'); this.z = channels.indexOf('PositionZ'); this.path = '';
    if (this.x < 0 || this.z < 0 || !history.hasRange(this.x) || !history.hasRange(this.z)) return;
    const x = history.range(this.x), z = history.range(this.z);
    this.centerX = (x.min + x.max) / 2; this.centerZ = (z.min + z.max) / 2;
    this.scale = 144 / Math.max(x.max - x.min, z.max - z.min, 1);
    let pen = false, previousX = 0, previousY = 0;
    for (let i = 0; i < history.length; i++) {
      const point = this.project(history.value(i, this.x), history.value(i, this.z));
      if (!point) { pen = false; continue; }
      if (i && history.time(i) - history.time(i - 1) > 0.1) pen = false;
      if (!pen || Math.hypot(point.x - previousX, point.y - previousY) >= 0.5 || i === history.length - 1) {
        this.path += `${pen ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)} `;
        previousX = point.x; previousY = point.y; pen = true;
      }
    }
  }
  private project(x: number | null | undefined, z: number | null | undefined) {
    return typeof x === 'number' && typeof z === 'number' && Number.isFinite(x) && Number.isFinite(z)
      ? { x: 80 + (x - this.centerX) * this.scale, y: 80 - (z - this.centerZ) * this.scale } : undefined;
  }
  position(sample?: LiveSample) {
    return this.path && sample ? this.project(sample.values[this.x], sample.values[this.z]) : undefined;
  }
  nearest(x: number, y: number, preferredTime: number) {
    if (!this.history || !this.path) return undefined;
    let selected = -1, distance = Infinity, selectedDistance = Infinity, timeDistance = Infinity;
    for (let i = 0; i < this.history.length; i++) {
      const point = this.project(this.history.value(i, this.x), this.history.value(i, this.z));
      if (!point) continue;
      const d = Math.hypot(point.x - x, point.y - y), t = Math.abs(this.history.time(i) - preferredTime);
      // At repeated laps/crossings, equally close spatial matches prefer the current time.
      distance = Math.min(distance, d);
      if (selectedDistance > distance + 1e-4 || d <= distance + 1e-4 && t < timeDistance) { selected = i; selectedDistance = d; timeDistance = t; }
    }
    return this.history.sampleAt(selected);
  }
}
