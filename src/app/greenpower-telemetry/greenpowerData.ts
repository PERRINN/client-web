export interface GreenpowerSample { id: string; receivedAt: number; eventAt?: number; source: string; raw: string; }
export interface GreenpowerChunk { samples: GreenpowerSample[]; bytes: number; }
export interface GreenpowerDay { date: string; activeChunk: number; count: number; latest: GreenpowerSample; }
export interface GreenpowerChannel { id: string; label: string; unit: string; value: string; points: { time: number; value: number }[]; valueAt?: (time: number) => number | undefined; }
// Display speeds in mph; retain source units in channel IDs for saved selections.
const speedFactors: Record<string, number> = { 'm/s': 1 / 0.44704, 'km/h': 1 / 1.609344, kph: 1 / 1.609344, mph: 1 };
function speedFactor(unit: string) { return Object.hasOwn(speedFactors, unit) ? speedFactors[unit] : undefined; }
function displayUnit(unit: string) { return speedFactor(unit) === undefined ? unit : 'mph'; }
function isRaceSeconds(id: string, unit: string) {
  return /^\["raceseconds"\]$/i.test(id) && ['', 's', 'seconds'].includes(unit);
}
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
export function sampleTime(sample: GreenpowerSample) { return sample.eventAt ?? sample.receivedAt; }
export function displayValue(value: unknown): string {
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
  Tmp1: ['Ambient temp', '°C'], Tmp2: ['Motor temp', '°C'], AH: ['Amp hours used', 'Ah'],
  Lap: ['Telemetry lap', ''], Gear: ['Gear ratio', ''], Brk: ['Brake', ''], Lon: ['Longitude', '°'], Lat: ['Latitude', '°']
};
const historicalAliases: Record<string, string> = {
  voltage: 'Vt', voltageLower: 'V1', current: 'A', rpm: 'RPM', speed: 'Spd',
  throttle: 'Thrtl', temp1: 'Tmp1', temp2: 'Tmp2', ampH: 'AH', currLap: 'Lap',
  gear: 'Gear', lon: 'Lon', lat: 'Lat'
};
export function fields(raw: string, historical = false) {
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
    // Identity and source time remain intact in raw, rather than becoming sensor plots.
    if (historical && path.length === 1) {
      if (['id', 'carId', 'updated'].includes(path[0])) return;
      path = [Object.hasOwn(historicalAliases, path[0]) ? historicalAliases[path[0]] : path[0]];
    }
    const native = path.length === 1 ? known[path[0]] : undefined;
    result.push({ id: JSON.stringify(path), label: native?.[0] || path.join(' / '), unit: unit ?? native?.[1] ?? '', value });
  }
  visit(JSON.parse(raw), [], 0);
  return result;
}
export const MOTOR_DERIVED_SPEED = 'computed:motor-derived-speed';
export const VEHICLE_SPEED = '["Spd"]:m/s';
export const isVehicleSpeed = (id: string) => id.startsWith('["Spd"]:') && speedFactor(id.slice(8)) !== undefined;
export const LAP_METRICS: Record<string, { label: string; unit: string }> = {
  'computed:lap-time': { label: 'Lap time', unit: 's' },
  'computed:lap-average-speed': { label: 'Lap average speed · from motor', unit: 'mph' },
  'computed:lap-average-amps': { label: 'Lap average amps', unit: 'A' }
};
export const isLapMetric = (id: string) => Object.hasOwn(LAP_METRICS, id);
export const POWER = 'computed:power';
export const ENERGY = 'computed:energy';
export const DISTANCE = 'computed:distance-travelled';
export const isElectricalMetric = (id: string) => id === POWER || id === ENERGY;
export const VOLTAGE_LEFT = 'computed:voltage-left';
export const VOLTAGE_RIGHT = 'computed:voltage-right';
export const VOLTAGE_DIFF = 'computed:voltage-diff';
export function isVoltageChannel(id: string) { return [VOLTAGE_LEFT, VOLTAGE_RIGHT, VOLTAGE_DIFF].includes(id); }
const voltageLabels: Record<string, string> = {
  [VOLTAGE_LEFT]: 'Voltage left', [VOLTAGE_RIGHT]: 'Voltage right', [VOLTAGE_DIFF]: 'Voltage diff'
};
// Calculate within one payload: never combine readings from different samples.
function electricalFields(source: { id: string; unit: string; value: unknown }[]) {
  const finiteReading = (id: string, unit: string) => source.find(field => field.id === id && field.unit === unit && typeof field.value === 'number' && Number.isFinite(field.value))?.value as number | undefined;
  const left = finiteReading('["V1"]', 'V'), total = finiteReading('["Vt"]', 'V');
  const result: { id: string; label: string; unit: string; value: number }[] = [];
  const add = (id: string, value: number) => {
    if (Number.isFinite(value)) result.push({ id, label: voltageLabels[id], unit: 'V', value });
  };
  if (left !== undefined) {
    add(VOLTAGE_LEFT, left);
    if (total !== undefined) { const right = total - left; add(VOLTAGE_RIGHT, right); add(VOLTAGE_DIFF, right - left); }
  }
  const current = finiteReading('["A"]', 'A');
  if (total !== undefined && current !== undefined && Number.isFinite(total * current)) {
    result.push({ id: POWER, label: 'Power', unit: 'W', value: total * current });
  }
  return result;
}
export function channelsFor(samples: GreenpowerSample[], latest?: GreenpowerSample): GreenpowerChannel[] {
  const channels = new Map<string, GreenpowerChannel>();
  const readings = new Map<string, unknown>();
  const append = (sample: GreenpowerSample, plot: boolean) => {
    const source = fields(sample.raw, sample.source === 'echook-history');
    for (const field of [...source, ...electricalFields(source)]) {
      const key = field.id.startsWith('computed:') ? field.id : `${field.id}:${field.unit}`;
      const raceTime = isRaceSeconds(field.id, field.unit);
      const factor = raceTime ? 1 / 60 : speedFactor(field.unit);
      const value = factor !== undefined && typeof field.value === 'number' ? field.value * factor : field.value;
      let channel = channels.get(key);
      if (!channel) { channel = { id: key, label: raceTime ? 'Race time' : field.label, unit: raceTime ? 'min' : displayUnit(field.unit), value: '—', points: [] }; channels.set(key, channel); }
      readings.set(key, value);
      if (plot && typeof value === 'number' && Number.isFinite(value)) channel.points.push({ time: sampleTime(sample), value });
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

/** Binary search on time-ordered channel samples. */
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
  if (id === POWER) return { label: 'Power', unit: 'W' };
  if (id === ENERGY) return { label: 'Energy', unit: 'Wh' };
  if (id === DISTANCE) return { label: 'Distance travelled', unit: 'mi' };
  if (id === MOTOR_DERIVED_SPEED) return { label: 'Motor-derived speed', unit: 'mph' };
  if (isLapMetric(id)) return LAP_METRICS[id];
  if (Object.hasOwn(voltageLabels, id)) return { label: voltageLabels[id], unit: 'V' };
  if (id === 'computed:gps-lap') return { label: 'GPS lap', unit: '' };
  for (let at = id.indexOf(']:'); at >= 0; at = id.indexOf(']:', at + 2)) {
    try {
      const path: unknown = JSON.parse(id.slice(0, at + 1));
      if (Array.isArray(path) && path.every(part => typeof part === 'string')) {
        if (isRaceSeconds(id.slice(0, at + 1), id.slice(at + 2))) return { label: 'Race time', unit: 'min' };
        return { label: (path.length === 1 && known[path[0]]?.[0]) || path.join(' / ') || 'Value', unit: displayUnit(id.slice(at + 2)) };
      }
    } catch { /* A channel key can itself contain ]:. Continue to the JSON boundary. */ }
  }
  return { label: id, unit: '' };
}
