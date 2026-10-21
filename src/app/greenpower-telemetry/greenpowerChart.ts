import { ChartMarker, defaultMarker } from './greenpowerMarkers';
import { chartTrace, displayValue, formatChannelNumber, formatRaceTime, GreenpowerChannel, isRaceTime, londonTime, pointIndex } from './greenpowerData';
import { verticalAxis } from '../telemetry/verticalAxis';
import { formatAxisValue, formatTelemetryValue } from '../telemetry/sessionHistory';

export interface ChartWindow { start: number; end: number; }
export type ChartPoint = { time: number; value: number };
export function channelMarker(channel: GreenpowerChannel, setting?: ChartMarker) {
  const marker = setting ?? defaultMarker(channel.id);
  return marker.enabled && marker.value !== null ? marker.value : undefined;
}

export function chartY(value: number, axis: { min: number; max: number }) {
  const scale = Math.max(1, Math.abs(axis.min), Math.abs(axis.max));
  return 110 - (value / scale - axis.min / scale) / (axis.max / scale - axis.min / scale || 1) * 100;
}
export { formatAxisValue, formatTelemetryValue };
export function plotFor(points: ChartPoint[], start: number, end: number, width: number, marker?: number, comparison: ChartPoint[] = [], overlays: ChartPoint[][] = []) {
  const visible = points.slice(pointIndex(points, start), pointIndex(points, end, true));
  let min = Infinity, max = -Infinity;
  const other = comparison.slice(pointIndex(comparison, start), pointIndex(comparison, end, true));
  const extra = overlays.map(series => series.slice(pointIndex(series, start), pointIndex(series, end, true)));
  for (const series of [visible, other, ...extra]) for (const point of series) { min = Math.min(min, point.value); max = Math.max(max, point.value); }
  if (marker !== undefined) { min = Math.min(min, marker); max = Math.max(max, marker); }
  // Normalize only extreme magnitudes so the shared rounding algorithm cannot overflow.
  const scale = Math.max(Math.abs(min), Math.abs(max));
  const factor = Number.isFinite(scale) && scale > 1e100 ? scale : scale > 0 && scale < 1e-100 ? scale : 1;
  const axis = verticalAxis(min / factor, max / factor);
  const finite = (value: number) => Math.max(-Number.MAX_VALUE, Math.min(Number.MAX_VALUE, value));
  axis.min = finite(axis.min * factor); axis.max = finite(axis.max * factor); axis.step *= factor;
  axis.ticks = axis.ticks.map(tick => ({ ...tick, value: tick.value * factor, y: 10 + (tick.y - 8) / 44 * 100 })).filter(tick => Number.isFinite(tick.value));
  const magnitude = Math.max(1, Math.abs(axis.min), Math.abs(axis.max));
  axis.ticks.forEach(tick => tick.y = 110 - (tick.value / magnitude - axis.min / magnitude) / (axis.max / magnitude - axis.min / magnitude || 1) * 100);
  const bins = Math.max(1, Math.ceil(width));
  return { axis, trace: chartTrace(visible, start, end, bins, axis), comparison: chartTrace(other, start, end, bins, axis),
    overlays: extra.map(series => chartTrace(series, start, end, bins, axis)), empty: !visible.length && !other.length && !extra.some(series => series.length) };
}
export function nearestPoint(points: ChartPoint[], time: number, start: number, end: number) {
  const index = pointIndex(points, time);
  const before = points[index - 1], after = points[index];
  const candidates = [before, after].filter((p): p is ChartPoint => !!p && p.time >= start && p.time <= end);
  return candidates.sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))[0];
}
export function scalarValue(channel: GreenpowerChannel, cursor: number | undefined, start: number, end: number) {
  if (cursor === undefined) return channel.value;
  const point = channelReading(channel, cursor, start, end);
  return point ? displayValue(point.value) : '—';
}
export function scalarReadout(channel: GreenpowerChannel, cursor: number | undefined, start: number, end: number) {
  const value = scalarValue(channel, cursor, start, end);
  if (isRaceTime(channel)) return formatRaceTime(Number(value));
  const formatted = value.trim() && Number.isFinite(Number(value)) ? formatChannelNumber(channel, Number(value)) : value;
  return formatted + (channel.unit ? ' ' + channel.unit : '');
}
export function channelReadout(channel: GreenpowerChannel, value: number, _min: number, _max: number, withUnit = true) {
  return isRaceTime(channel) ? formatRaceTime(value)
    : formatChannelNumber(channel, value) + (withUnit && channel.unit ? ' ' + channel.unit : '');
}
export function channelReading(channel: GreenpowerChannel, time: number, start: number, end: number) {
  if (!channel.valueAt) return nearestPoint(channel.points, time, start, end);
  const value = time >= start && time <= end ? channel.valueAt(time) : undefined;
  return value === undefined ? undefined : { time, value };
}
const intervals = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000, 3600000, 7200000, 10800000, 21600000, 43200000, 86400000];
export function clockTicks(start: number, end: number, width: number) {
  if (end <= start) return [];
  const count = Math.max(1, Math.min(8, Math.floor(width / (end - start < 1000 ? 110 : 80))));
  const step = intervals.find(value => value >= (end - start) / count) ?? 86400000;
  const ticks: { position: number; label: string }[] = [];
  for (let time = Math.ceil(start / step) * step; time <= end && ticks.length < 10; time += step) {
    ticks.push({ position: (time - start) / (end - start) * 100, label: londonTime(time) + (step < 1000 ? '.' + String(time % 1000).padStart(3, '0') : '') });
  }
  return ticks;
}

export function elapsedTime(time: number) {
  const seconds = Math.max(0, Math.floor(Math.round(time) / 1000));
  return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

// Transient legend emphasis, shared by the charts in the current view.
export interface LegendHighlight { channelId?: string; sessionId?: string; }
