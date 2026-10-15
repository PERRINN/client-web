import { axisY, verticalAxis, VerticalAxis } from './verticalAxis';

export interface LiveSample { sequence: number; frame: number; time: number; simulationTime: number; paused: boolean; values: (number | null)[] }
export interface ParameterChange { id: number; time: number; sequence: number; result: { parameter: string; value: number; effectiveFromFrame: number } }
export interface DataGap { start: number; end: number }
const displayFormats = new Map<string, Intl.NumberFormat>();
export function precisionForRange(min: number, max: number) {
  const magnitude = max - min || Math.max(Math.abs(min), Math.abs(max));
  // Around 100 distinguishable steps for small ranges; normal ranges use one DP.
  return magnitude > 0 && Number.isFinite(magnitude) ? Math.max(1, 1 - Math.floor(Math.log10(magnitude) + 1e-6)) : 1;
}
export function formatTelemetryValue(value: number | null | undefined, min: number, max: number) {
  return formatWithPrecision(value, precisionForRange(min, max));
}
export function formatAxisValue(value: number, step: number) {
  // Preserve fractional tick steps (including 2.5 multiples) without extra trailing decimals.
  let precision = Number.isFinite(step) && step > 0 ? Math.ceil(-Math.log10(step) - 1e-10) : 1;
  const scaled = step * Math.pow(10, precision);
  if (Number.isFinite(scaled) && Math.abs(scaled - Math.round(scaled)) > 1e-8) precision++;
  return formatWithPrecision(value, Math.max(0, precision));
}
function formatWithPrecision(value: number | null | undefined, precision: number) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const scientific = precision > 9;
  const key = scientific ? 'scientific' : String(precision);
  let format = displayFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat('en', { minimumFractionDigits: scientific ? 1 : precision, maximumFractionDigits: scientific ? 1 : precision, notation: scientific ? 'scientific' : 'standard' });
    displayFormats.set(key, format);
  }
  const displayed = !scientific && Math.abs(value) < 0.5 * Math.pow(10, -precision) ? 0 : value;
  return format.format(displayed);
}
const BLOCK = 256;
class Block {
  times = new Float64Array(BLOCK);
  simulations = new Float64Array(BLOCK);
  frames = new Int32Array(BLOCK);
  paused = new Uint8Array(BLOCK);
  values: Float32Array;
  constructor(channels: number) { this.values = new Float32Array(BLOCK * channels); }
}
// Append-only typed buffers with channel ranges learned over the whole session.
export class SessionHistory {
  private blocks: Block[] = [];
  private minima: Float32Array;
  private maxima: Float32Array;
  constructor(readonly channelCount = 10) {
    if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 64) throw new Error('Invalid channel count');
    this.minima = new Float32Array(channelCount).fill(Infinity); this.maxima = new Float32Array(channelCount).fill(-Infinity);
  }
  length = 0;
  version = 0;
  events: ParameterChange[] = [];
  gaps: DataGap[] = [];
  get bytes() { return this.blocks.length * BLOCK * (8 + 8 + 4 + 1 + 4 * this.channelCount) + 8 * this.channelCount; }
  get end() { return this.length ? this.time(this.length - 1) : 0; }
  get start() { return this.length ? this.time(0) : 0; }
  append(s: LiveSample) {
    if (s.values.length !== this.channelCount) throw new Error('Sample channel count differs from session');
    if (s.sequence <= this.length) return;
    if (s.sequence !== this.length + 1) throw new Error('History must arrive in sequence');
    if (this.length && s.time < this.end) throw new Error('Session time moved backwards');
    if (this.length && s.time - this.end > 0.1) this.gaps.push({ start: this.end, end: s.time });
    const index = this.length % BLOCK;
    if (!index) this.blocks.push(new Block(this.channelCount));
    const b = this.blocks[this.blocks.length - 1];
    b.times[index] = s.time; b.simulations[index] = s.simulationTime; b.frames[index] = s.frame; b.paused[index] = +s.paused;
    s.values.forEach((v, c) => {
      b.values[index * this.channelCount + c] = v ?? NaN;
      const stored = b.values[index * this.channelCount + c];
      if (Number.isFinite(stored)) { this.minima[c] = Math.min(this.minima[c], stored); this.maxima[c] = Math.max(this.maxima[c], stored); }
    });
    this.length++; this.version++;
  }
  addEvents(events: ParameterChange[]) {
    for (const event of events) {
      if (event.id <= this.events.length) continue;
      if (event.id !== this.events.length + 1 || !Number.isFinite(event.time) || !Number.isFinite(event.result?.value) || typeof event.result?.parameter !== 'string') throw new Error('Invalid parameter event');
      this.events.push(event); this.version++;
    }
  }
  time(i: number) { return this.blocks[Math.floor(i / BLOCK)].times[i % BLOCK]; }
  value(i: number, c: number) { return this.blocks[Math.floor(i / BLOCK)].values[(i % BLOCK) * this.channelCount + c]; }
  sampleAt(index: number): LiveSample | undefined {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) return undefined;
    const b = this.blocks[Math.floor(index / BLOCK)], row = index % BLOCK;
    return { sequence: index + 1, frame: b.frames[row], time: b.times[row], simulationTime: b.simulations[row], paused: !!b.paused[row],
      values: Array.from({ length: this.channelCount }, (_, c) => { const v = b.values[row * this.channelCount + c]; return Number.isFinite(v) ? v : null; }) };
  }
  nearest(time: number, start = this.start, end = this.end): LiveSample | undefined {
    if (!this.length || !Number.isFinite(time)) return undefined;
    const right = this.lower(time), left = right - 1;
    if (left >= 0 && right < this.length && this.time(right) - this.time(left) > 0.1 && time > this.time(left) && time < this.time(right)) return undefined;
    const candidates = [left, right].filter(i => i >= 0 && i < this.length && this.time(i) >= start && this.time(i) <= end);
    candidates.sort((a, b) => Math.abs(this.time(a) - time) - Math.abs(this.time(b) - time));
    return candidates.length ? this.sampleAt(candidates[0]) : undefined;
  }
  private lower(time: number) {
    let lo = 0, hi = this.length;
    while (lo < hi) { const m = (lo + hi) >>> 1; if (this.time(m) < time) lo = m + 1; else hi = m; }
    return lo;
  }
  hasRange(channel: number) { return Number.isFinite(this.minima[channel]); }
  range(channel: number) {
    return this.hasRange(channel) ? { min: this.minima[channel], max: this.maxima[channel] } : { min: 0, max: 0 };
  }
  windowRange(channel: number, start: number, end: number) {
    let min = Infinity, max = -Infinity;
    for (let i = this.lower(start); i < this.length && this.time(i) <= end; i++) {
      const value = this.value(i, channel);
      if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
    }
    const hasValues = Number.isFinite(min);
    return { min: hasValues ? min : 0, max: hasValues ? max : 0, hasValues };
  }
  displayPrecision(channel: number) { const range = this.range(channel); return precisionForRange(range.min, range.max); }
  formatValue(channel: number, value: number | null | undefined) {
    const range = this.range(channel); return formatTelemetryValue(value, range.min, range.max);
  }
  trace(channel: number, start: number, end: number, resolution = 300, displayRange?: { min: number; max: number } | VerticalAxis, coordinate?: (time: number, index?: number) => number, horizontalRange?: {start: number; end: number}) {
    const a = this.lower(start), endIndex = this.lower(end);
    const z = Math.min(this.length, endIndex + (endIndex < this.length && this.time(endIndex) <= end ? 1 : 0));
    const { min, max } = this.range(channel);
    // A supplied chart axis is already rounded. Reusing it keeps traces, ticks and cursors aligned.
    const axis = displayRange && 'ticks' in displayRange ? displayRange : verticalAxis(displayRange?.min ?? min, displayRange?.max ?? max);
    let above = '', below = '', aboveBucket = -1, belowBucket = -1;
    if (a >= z || !this.hasRange(channel)) return { path: '', min, max, axis, above, below };
    resolution = Math.max(1, Math.floor(resolution));
    const scale = (v: number) => axisY(displayRange ? Math.max(axis.min, Math.min(axis.max, v)) : v, axis).toFixed(3);
    const origin = horizontalRange?.start ?? (coordinate ? coordinate(start) : start);
    const span = Math.max(0.02, (horizontalRange?.end ?? (coordinate ? coordinate(end) : end)) - origin);
    // SVG coordinates stay fixed; reduction density follows the rendered pixel width.
    const position = (i: number) => Math.max(0, Math.min(1, ((coordinate ? coordinate(this.time(i), i) : this.time(i)) - origin) / span));
    // Mark every outlier before decimation, bounded to one tick per pixel bucket per edge.
    const markOverflow = (i: number, value: number) => {
      if (!displayRange || value >= axis.min && value <= axis.max) return;
      const bucket = Math.min(resolution - 1, Math.floor(position(i) * resolution)), x = (position(i) * 300).toFixed(3);
      if (value > axis.max && bucket !== aboveBucket) { above += `M${x},4V8 `; aboveBucket = bucket; }
      if (value < axis.min && bucket !== belowBucket) { below += `M${x},52V56 `; belowBucket = bucket; }
    };
    let path = '', pen = false;
    const point = (i: number) => {
      path += `${pen ? 'L' : 'M'}${(position(i) * 300).toFixed(3)},${scale(this.value(i, channel))} `;
      pen = true;
    };
    if (z - a <= resolution * 2) {
      for (let i = a; i < z; i++) {
        const v = this.value(i, channel);
        if (!Number.isFinite(v) || !Number.isFinite(position(i))) { pen = false; continue; }
        if (i > a && this.time(i) - this.time(i - 1) > 0.1) pen = false;
        markOverflow(i, v); point(i);
      }
    } else {
      // First/min/max/last in sample order preserve peaks AND a continuous trace.
      // Split within buckets too: a null or capture gap must never be bridged.
      let bucket = -1, first = -1, last = -1, low = -1, high = -1;
      const flush = () => {
        if (first < 0) return;
        const indices = [first, low, high, last].sort((left, right) => left - right);
        for (let j = 0; j < indices.length; j++) if (!j || indices[j] !== indices[j - 1]) point(indices[j]);
        first = last = low = high = -1;
      };
      for (let i = a; i < z; i++) {
        const v = this.value(i, channel);
        if (!Number.isFinite(v) || !Number.isFinite(position(i))) { flush(); pen = false; continue; }
        if (i > a && this.time(i) - this.time(i - 1) > 0.1) { flush(); pen = false; }
        markOverflow(i, v);
        const nextBucket = Math.min(resolution - 1, Math.floor(position(i) * resolution));
        if (nextBucket !== bucket) { flush(); bucket = nextBucket; }
        if (first < 0) first = low = high = i;
        if (v < this.value(low, channel)) low = i;
        if (v > this.value(high, channel)) high = i;
        last = i;
      }
      flush();
    }
    return { path, min, max, axis, above, below };
  }
}
