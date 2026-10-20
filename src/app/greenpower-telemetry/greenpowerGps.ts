import { displayValue, GreenpowerChannel, pointIndex } from './greenpowerData';
import { LapInterval } from './greenpowerLaps';

export interface GpsPoint { lat: number; lon: number; }
export interface GpsFix extends GpsPoint { time: number; }
export interface FinishLine { a: GpsPoint; b: GpsPoint; direction: 1 | -1; }
export interface GpsLap extends LapInterval { complete: boolean; current?: number; speed?: number; }
export const GPS_LAP_ID = 'computed:gps-lap';
export const MAX_GPS_GAP = 15000;
const METRES = Math.PI * 6371000 / 180;
const REARM_METRES = 20;
const HYSTERESIS_METRES = 5;
export function validPoint(value: unknown): value is GpsPoint {
  const p = value as GpsPoint;
  return !!p && Number.isFinite(p.lat) && Math.abs(p.lat) <= 85 && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180;
}
export function localPoint(p: GpsPoint, origin: GpsPoint) {
  return { x: (p.lon - origin.lon) * METRES * Math.cos(origin.lat * Math.PI / 180), y: (p.lat - origin.lat) * METRES };
}
export function validLine(value: unknown): value is FinishLine {
  const line = value as FinishLine;
  if (!line || !validPoint(line.a) || !validPoint(line.b) || ![1, -1].includes(line.direction)) return false;
  const delta = localPoint(line.b, line.a), length = Math.hypot(delta.x, delta.y);
  return length >= 2 && length <= 500;
}
/** Only pair coordinates recorded at the same timestamp; never combine stale axes. */
export function gpsFixes(channels: GreenpowerChannel[]) {
  const lat = channels.find(c => c.id === '["Lat"]:°')?.points ?? [];
  const lon = channels.find(c => c.id === '["Lon"]:°')?.points ?? [];
  const fixes: GpsFix[] = [];
  let j = 0;
  for (let i = 0; i < lat.length; i++) {
    if (lat[i + 1]?.time === lat[i].time) continue;
    while (j + 1 < lon.length && lon[j + 1].time <= lat[i].time) j++;
    const fix = { time: lat[i].time, lat: lat[i].value, lon: lon[j]?.value };
    if (lon[j]?.time === fix.time && validPoint(fix) && (fix.lat !== 0 || fix.lon !== 0)) fixes.push(fix);
  }
  return fixes;
}
export function validSegment(a: GpsFix, b: GpsFix) {
  const elapsed = b.time - a.time, delta = localPoint(b, a);
  return elapsed > 0 && elapsed <= MAX_GPS_GAP && Math.hypot(delta.x, delta.y) / (elapsed / 1000) <= 60;
}
/** Trapezoidal time average with interpolated endpoints, without bridging outages. */
export function timeAverage(points: { time: number; value: number }[], start: number, end: number) {
  if (end <= start) return undefined;
  let area = 0, covered = 0;
  const first = Math.max(0, pointIndex(points, start, true) - 1);
  for (let i = first; i + 1 < points.length && points[i].time < end; i++) {
    const a = points[i], b = points[i + 1], span = b.time - a.time;
    const left = Math.max(start, a.time), right = Math.min(end, b.time);
    if (right <= left) continue;
    if (span > MAX_GPS_GAP || span <= 0) return undefined;
    const value = (time: number) => a.value + (b.value - a.value) * (time - a.time) / span;
    area += (value(left) + value(right)) / 2 * (right - left); covered += right - left;
  }
  return Math.abs(covered - (end - start)) < .01 ? area / covered : undefined;
}
export function gpsAnalysis(fixes: GpsFix[], line: FinishLine | null | undefined, channels: GreenpowerChannel[], end: number) {
  const laps: GpsLap[] = [], points: { time: number; value: number }[] = [];
  const channel: GreenpowerChannel = { id: GPS_LAP_ID, label: 'GPS lap', unit: '', value: '—', points };
  if (!validLine(line) || !fixes.length) return { laps, channel };
  const finish = localPoint(line.b, line.a), length = Math.hypot(finish.x, finish.y);
  const side = (p: GpsPoint) => {
    const v = localPoint(p, line.a);
    return (finish.x * v.y - finish.y * v.x) / length * line.direction;
  };
  let armed = false, departure = true, active: GpsLap | undefined, count = 0;
  let candidate: number | undefined;
  const current = channels.find(c => c.id === '["A"]:A')?.points ?? [];
  for (let i = 0; i < fixes.length; i++) {
    const b = fixes[i], a = fixes[i - 1];
    if (a && !validSegment(a, b)) {
      if (active) { active.end = a.time; active = undefined; }
      armed = false; departure = true; candidate = undefined;
    }
    const sb = side(b);
    if (Math.abs(sb) >= REARM_METRES) departure = true;
    if (departure && sb <= -HYSTERESIS_METRES) armed = true;
    if (a && validSegment(a, b) && armed && side(a) < 0 && sb >= 0) {
      const sa = side(a), fraction = -sa / (sb - sa), p = localPoint(a, line.a), q = localPoint(b, line.a);
      const along = ((p.x + (q.x - p.x) * fraction) * finish.x + (p.y + (q.y - p.y) * fraction) * finish.y) / (length * length);
      if (along >= 0 && along <= 1) candidate = a.time + (b.time - a.time) * fraction;
    }
    if (candidate !== undefined && sb < -HYSTERESIS_METRES) candidate = undefined;
    if (candidate === undefined || sb < HYSTERESIS_METRES) continue;
    const time = candidate;
    if (active) {
      active.end = time; active.complete = true;
      active.current = timeAverage(current, active.time, time);
    }
    active = { time, end, lap: ++count, alternate: !!((count - 1) % 2), complete: false };
    laps.push(active);
    candidate = undefined; armed = departure = false;
  }
  // Extend only the last uninterrupted, observed interval; stale GPS is not a live lap.
  if (active) active.end = Math.min(end, fixes.at(-1)!.time);
  // Keep the counter level throughout each observed lap, including exact crossing boundaries.
  for (const lap of laps) {
    points.push({ time: lap.time, value: lap.lap });
    const first = pointIndex(fixes, lap.time, true);
    for (let i = first; i < fixes.length && fixes[i].time < lap.end; i++) points.push({ time: fixes[i].time, value: lap.lap });
    if (lap.end > lap.time) points.push({ time: lap.end - .001, value: lap.lap });
  }
  const last = fixes.at(-1)!;
  if (active && end - last.time <= MAX_GPS_GAP) channel.value = displayValue(active.lap);
  return { laps, channel };
}

/** Equal-scale geographic projection; output paths have at most 4,000 vertices. */
export function trackProjection(fixes: GpsFix[], line?: FinishLine | null) {
  const all = [...fixes, ...(line ? [line.a, line.b] : [])];
  const origin = all[0] ?? { lat: 0, lon: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of all) {
    const v = localPoint(p, origin); minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  if (!all.length) { minX = minY = -50; maxX = maxY = 50; }
  const span = Math.max(100, maxX - minX, maxY - minY) * 1.15;
  const cx = (maxX + minX) / 2, cy = (maxY + minY) / 2;
  const project = (p: GpsPoint) => { const v = localPoint(p, origin); return { x: 250 + (v.x - cx) / span * 500, y: 250 - (v.y - cy) / span * 500 }; };
  const unproject = (x: number, y: number): GpsPoint => ({ lat: origin.lat + (cy + (250 - y) / 500 * span) / METRES,
    lon: origin.lon + (cx + (x - 250) / 500 * span) / (METRES * Math.cos(origin.lat * Math.PI / 180)) });
  let path = '';
  const stride = Math.max(1, Math.ceil(fixes.length / 4000));
  let disconnected = true;
  for (let i = 0; i < fixes.length; i++) {
    if (i && !validSegment(fixes[i - 1], fixes[i])) disconnected = true;
    if (i % stride && i !== fixes.length - 1) continue;
    const v = project(fixes[i]); path += `${disconnected ? 'M' : 'L'}${v.x.toFixed(2)},${v.y.toFixed(2)} `; disconnected = false;
  }
  return { project, unproject, path };
}
export function fixAt(fixes: GpsFix[], time: number) {
  const index = pointIndex(fixes, time, true), a = fixes[index - 1], b = fixes[index];
  if (a?.time === time) return a;
  if (a && b && validSegment(a, b)) {
    const part = (time - a.time) / (b.time - a.time);
    return { time, lat: a.lat + (b.lat - a.lat) * part, lon: a.lon + (b.lon - a.lon) * part };
  }
  return a && time - a.time <= MAX_GPS_GAP ? a : undefined;
}
