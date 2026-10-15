import { niceStep } from './verticalAxis';
import { formatAxisValue } from './sessionHistory';

export interface TimeTick { value: number; position: number; labelPosition: number; label: string }
export function timeAxis(start: number, end: number, width = 300): TimeTick[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  width = Math.max(1, width);
  const span = end - start;
  let step = niceStep(span / 4);
  // Budget room for the longest label and a gap, using CSS pixels rather than device pixels.
  for (let attempt = 0; attempt < 10; attempt++) {
    const labelWidth = Math.max(formatAxisValue(start, step).length, formatAxisValue(end, step).length) * 8 + 16;
    const intervals = Math.max(1, Math.min(8, Math.floor(width / (labelWidth + 24))));
    const next = niceStep(span / intervals);
    if (next <= step) break;
    step = next;
  }
  const first = Math.ceil(start / step - 1e-10), last = Math.floor(end / step + 1e-10);
  const ticks: TimeTick[] = [];
  for (let n = first; n <= last && ticks.length < 10; n++) {
    const value = n === 0 ? 0 : Number((n * step).toPrecision(12));
    const position = Math.max(0, Math.min(100, (value - start) / span * 100));
    const label = formatAxisValue(value, step) + ' s';
    const halfLabel = Math.min(50, label.length * 4 / width * 100);
    ticks.push({ value, position, labelPosition: Math.max(halfLabel, Math.min(100 - halfLabel, position)), label });
  }
  return ticks;
}
