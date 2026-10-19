export interface GreenpowerSample { id: string; receivedAt: number; source: string; raw: string; }
export interface GreenpowerChunk { samples: GreenpowerSample[]; bytes: number; }
export interface GreenpowerDay { date: string; activeChunk: number; count: number; latest: GreenpowerSample; }
export interface GreenpowerChannel { id: string; label: string; unit: string; value: string; points: { time: number; value: number }[]; }
export const PAGE_SIZE = 100;
export const MAX_PAGES = 50;
export const MAX_LOAD_BYTES = 64 * 1024 * 1024;
// A chunk has <=128 KiB of serialized sample content plus JSON framing.
export const MAX_CHUNK_WIRE_BYTES = 132 * 1024;
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const valueFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 6, useGrouping: false });
export function londonDay(time = Date.now()) {
  const parts = Object.fromEntries(dayFormat.formatToParts(time).map(p => [p.type, p.value]));
  return `${parts['year']}-${parts['month']}-${parts['day']}`;
}
export function londonTime(time: number) { return timeFormat.format(time); }
function displayValue(value: unknown): string {
  if (value === null) return '—';
  if (typeof value === 'number') return value && (Math.abs(value) >= 1e9 || Math.abs(value) < 1e-6)
    ? value.toExponential(5) : valueFormat.format(value);
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

// Units are eChook's documented native units. Unknown channels are never inferred
// from their value or discarded; explicit {value, unit} envelopes are supported.
const known: Record<string, [string, string]> = {
  Vt: ['Total voltage', 'V'], V1: ['Lower battery voltage', 'V'], A: ['Current', 'A'],
  RPM: ['Motor speed', 'rpm'], Spd: ['Vehicle speed', 'm/s'], Thrtl: ['Throttle', '%'],
  Tmp1: ['Temperature 1', '°C'], Tmp2: ['Temperature 2', '°C'], AH: ['Amp hours used', 'Ah'],
  Lap: ['Lap', ''], Gear: ['Gear', ''], Brk: ['Brake', ''], Lon: ['Longitude', '°'], Lat: ['Latitude', '°']
};
export function fields(raw: string) {
  const result: { id: string; label: string; unit: string; value: unknown }[] = [];
  function visit(value: unknown, path: string[], depth: number) {
    if (depth > 8 || result.length >= 512) return;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const object = value as Record<string, unknown>;
      if ('value' in object && typeof object['unit'] === 'string') {
        add(object['value'], path, object['unit']);
        for (const [key, child] of Object.entries(object)) if (!['value', 'unit'].includes(key)) visit(child, [...path, key], depth + 1);
      } else for (const [key, child] of Object.entries(object)) visit(child, [...path, key], depth + 1);
    } else if (Array.isArray(value) && value.length) {
      value.forEach((child, index) => visit(child, [...path, String(index)], depth + 1));
    } else add(value, path);
  }
  function add(value: unknown, path: string[], unit?: string) {
    const native = path.length === 1 ? known[path[0]] : undefined;
    result.push({ id: JSON.stringify(path), label: native?.[0] || path.join(' / '), unit: unit ?? native?.[1] ?? '', value });
  }
  visit(JSON.parse(raw), [], 0);
  return result;
}
export function channelsFor(samples: GreenpowerSample[], latest?: GreenpowerSample): GreenpowerChannel[] {
  const channels = new Map<string, GreenpowerChannel>();
  const readings = new Map<string, unknown>();
  const append = (sample: GreenpowerSample, plot: boolean) => {
    for (const field of fields(sample.raw)) {
      const key = `${field.id}:${field.unit}`;
      let channel = channels.get(key);
      if (!channel) { channel = { id: key, label: field.label, unit: field.unit, value: '—', points: [] }; channels.set(key, channel); }
      readings.set(key, field.value);
      if (plot && typeof field.value === 'number' && Number.isFinite(field.value)) channel.points.push({ time: sample.receivedAt, value: field.value });
    }
  };
  samples.forEach(sample => append(sample, true));
  // Current values come from the latest payload, even while history is loading.
  if (latest) { readings.clear(); append(latest, false); }
  readings.forEach((value, key) => channels.get(key)!.value = displayValue(value));
  return Array.from(channels.values());
}

export function mergeChannels(chunks: GreenpowerChannel[][], latest?: GreenpowerSample): GreenpowerChannel[] {
  const merged = new Map<string, GreenpowerChannel>();
  for (const chunk of chunks) for (const channel of chunk) {
    let target = merged.get(channel.id);
    if (!target) { target = { ...channel, points: [] }; merged.set(channel.id, target); }
    target.points.push(...channel.points);
    target.value = channel.value;
  }
  for (const channel of merged.values()) channel.points.sort((a, b) => a.time - b.time);
  const result = Array.from(merged.values());
  updateValues(result, latest);
  return result;
}
export function updateValues(channels: GreenpowerChannel[], latest?: GreenpowerSample) {
  channels.forEach(channel => channel.value = '—');
  if (!latest) return;
  for (const value of channelsFor([], latest)) {
    const channel = channels.find(channel => channel.id === value.id);
    if (channel) channel.value = value.value;
    else channels.push(value);
  }
}

// Preserve extrema in each time bin; retain all original samples independently.
export function chartTrace(points: { time: number; value: number }[], start: number, end: number, bins = 600, axis?: { min: number; max: number }) {
  points = points.slice(pointIndex(points, start), pointIndex(points, end, true));
  if (!points.length) return { path: '', min: 0, max: 0 };
  let min = Infinity, max = -Infinity;
  for (const point of points) { min = Math.min(min, point.value); max = Math.max(max, point.value); }
  const low = axis?.min ?? min, high = axis?.max ?? max;
  const span = Math.max(1, end - start), scale = Math.max(1, Math.abs(low), Math.abs(high));
  const range = high / scale - low / scale || 1;
  const buckets = new Map<number, { time: number; value: number }[]>();
  for (const point of points) {
    const key = Math.min(bins - 1, Math.floor((point.time - start) / span * bins));
    const bucket = buckets.get(key);
    if (!bucket) buckets.set(key, [point, point]);
    else { if (point.value < bucket[0].value) bucket[0] = point; if (point.value > bucket[1].value) bucket[1] = point; }
  }
  const selected = Array.from(buckets.values()).flatMap(bucket => bucket.sort((a, b) => a.time - b.time));
  const path = selected.map((point, index) => `${index ? 'L' : 'M'}${(8 + (point.time - start) / span * 784).toFixed(2)},${(high === low ? 60 : 110 - (point.value / scale - low / scale) / range * 100).toFixed(2)}`).join(' ');
  return { path, min, max };
}

/** Binary search on receipt-time ordered channel samples. */
export function pointIndex(points: { time: number }[], time: number, after = false) {
  let low = 0, high = points.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (points[mid].time < time || after && points[mid].time === time) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Recover a saved selection's label even when this day has no matching samples. */
export function channelDetails(id: string): { label: string; unit: string } {
  for (let at = id.indexOf(']:'); at >= 0; at = id.indexOf(']:', at + 2)) {
    try {
      const path: unknown = JSON.parse(id.slice(0, at + 1));
      if (Array.isArray(path) && path.every(part => typeof part === 'string')) {
        return { label: (path.length === 1 && known[path[0]]?.[0]) || path.join(' / ') || 'Value', unit: id.slice(at + 2) };
      }
    } catch { /* A channel key can itself contain ]:. Continue to the JSON boundary. */ }
  }
  return { label: id, unit: '' };
}
