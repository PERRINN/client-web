import { LiveSample, SessionHistory } from './sessionHistory';
import { SessionLap } from './sessionAnalysis';
import { axisY, VerticalAxis } from './verticalAxis';
import { GapBand, recordingGapBands } from './recordingGaps';

interface LapTrack { lap: SessionLap; rows: number[]; distances: number[]; color: string }
export interface LapReading { lap: number; color: string; sample?: LiveSample }
export interface LapTrace { lap: number; color: string; path: string; above: string; below: string; gaps: GapBand[] }
export class LapOverlay {
  tracks: LapTrack[] = [];
  readings: LapReading[] = [];
  activeLap?: number;
  cursorDistance?: number;
  max = 0;
  private history?: SessionHistory;
  private version = -1;
  private channel = -1;
  update(history: SessionHistory, channels: {id: string}[], laps: SessionLap[]) {
    if (this.history === history && this.version === history.version) return;
    if (this.history !== history) { this.activeLap = undefined; this.cursorDistance = undefined; this.readings = []; }
    this.history = history; this.version = history.version; this.channel = channels.findIndex(c => c.id === 'LapDistance');
    this.max = 0;
    this.tracks = this.channel < 0 ? [] : laps.map(lap => {
      const first = (history.nearest(lap.start)?.sequence ?? 1) - 1, last = (history.nearest(lap.end)?.sequence ?? history.length) - 1;
      let rows: number[] = [], distances: number[] = [];
      for (let i = first; i <= last; i++) {
        const distance = history.value(i, this.channel);
        if (!Number.isFinite(distance)) continue;
        // A start trigger can precede the provider's next distance reset by one dynamics row.
        if (i - first < 10 && distances.length && distance < distances[distances.length - 1] - 10) { rows = []; distances = []; }
        if (distances.length && distance < distances[distances.length - 1]) continue;
        rows.push(i); distances.push(Math.max(0, distance));
      }
      this.max = Math.max(this.max, distances[distances.length - 1] || 0);
      return { lap, rows, distances, color: lap.number === 1 ? 'var(--color-text-secondary)' : lap.number === 2 ? 'var(--color-data-comparison)' : 'var(--color-accent)' };
    });
    if (!this.tracks.some(t => t.lap.number === this.activeLap)) this.activeLap = this.tracks.find(t => t.lap.complete)?.lap.number ?? this.tracks[0]?.lap.number;
    if (this.cursorDistance !== undefined) this.inspect(this.cursorDistance);
  }
  distance(sample?: LiveSample) { const value = sample?.values[this.channel]; return value === null || value === undefined ? NaN : Math.max(0, value); }
  private lower(values: number[], distance: number) {
    let lo = 0, hi = values.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (values[mid] < distance) lo = mid + 1; else hi = mid; }
    return lo;
  }
  inspect(distance: number) {
    this.cursorDistance = distance;
    this.readings = this.tracks.map(track => {
      const { rows, distances } = track, i = this.lower(distances, distance);
      let sample: LiveSample | undefined;
      if (rows.length && distance >= distances[0] && distance <= distances[distances.length - 1]) {
        const left = Math.max(0, i - 1), right = Math.min(i, rows.length - 1);
        const gap = distance > distances[left] && distance < distances[right] && this.history!.time(rows[right]) - this.history!.time(rows[left]) > .1;
        if (!gap) sample = this.history!.sampleAt(rows[Math.abs(distances[left] - distance) <= Math.abs(distances[right] - distance) ? left : right]);
      }
      return { lap: track.lap.number, color: track.color, sample };
    });
    return this.readings.find(r => r.lap === this.activeLap)?.sample;
  }
  select(sample: LiveSample) {
    if (!Number.isFinite(this.distance(sample))) return undefined;
    const track = this.tracks.find(t => sample.time >= t.lap.start && sample.time <= t.lap.end);
    if (track) this.activeLap = track.lap.number;
    return this.inspect(this.distance(sample));
  }
  windowRange(channel: number, start: number, end: number) {
    let min = Infinity, max = -Infinity;
    for (const { rows, distances } of this.tracks) {
      for (let i = this.lower(distances, start); i < rows.length && distances[i] <= end; i++) {
        const value = this.history!.value(rows[i], channel);
        if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
      }
    }
    const hasValues = Number.isFinite(min);
    return { min: hasValues ? min : 0, max: hasValues ? max : 0, hasValues };
  }
  trace(channel: number, axis: VerticalAxis, start: number, end: number, resolution: number): LapTrace[] {
    const history = this.history!;
    return this.tracks.map(track => {
      const { rows, distances } = track, first = this.lower(distances, start), after = this.lower(distances, end);
      const last = after < rows.length && distances[after] === end ? after : after - 1;
      if (first >= rows.length || last < first) return { lap: track.lap.number, color: track.color, path: '', above: '', below: '', gaps: [] };
      const a = history.time(rows[first]), b = history.time(rows[last]);
      const coordinate = (time: number, index?: number) => index === undefined ? this.distance(history.nearest(time)) : Math.max(0, history.value(index, this.channel));
      const trace = history.trace(channel, a, b, resolution, axis, coordinate, {start,end});
      return { lap: track.lap.number, color: track.color, path: trace.path, above: trace.above, below: trace.below,
        gaps: recordingGapBands(history, channel, axis, a, b, coordinate, {start,end}) };
    });
  }
  dotY(sample: LiveSample | undefined, channel: number, axis: VerticalAxis) {
    const value = sample?.values[channel]; return value === null || value === undefined ? 30 : Math.max(8, Math.min(52, axisY(value, axis)));
  }
  followWindow() {
    const track = this.tracks[this.tracks.length - 1];
    if (!track?.rows.length) return {start:0,end:this.max};
    this.activeLap = track.lap.number;
    const last = this.history!.sampleAt(track.rows[track.rows.length - 1])!, earlier = this.history!.nearest(Math.max(track.lap.start, last.time - 30));
    return {start:Math.max(0,this.distance(earlier) || 0),end:Math.max(.2,this.distance(last))};
  }
}
