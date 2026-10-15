import { SessionHistory } from './sessionHistory';
import { axisY, VerticalAxis } from './verticalAxis';

export interface GapBand { points: string; label: string }
export function recordingGapBands(history: SessionHistory, channel: number, axis: VerticalAxis, start: number, end: number, coordinate: (time: number) => number, horizontalRange?: {start: number; end: number}): GapBand[] {
  const origin = horizontalRange?.start ?? coordinate(start), span = Math.max(0.02, (horizontalRange?.end ?? coordinate(end)) - origin);
  const x = (time: number) => Math.max(0, Math.min(300, (coordinate(time) - origin) / span * 300));
  const clamp = (y: number) => Math.max(3, Math.min(57, y));
  return history.gaps.filter(g => g.end >= start && g.start <= end).map(g => {
    const before = history.nearest(g.start)?.values[channel], after = history.nearest(g.end)?.values[channel];
    const a = before ?? after, b = after ?? before;
    const left = a === null || a === undefined ? 30 : axisY(a, axis), right = b === null || b === undefined ? left : axisY(b, axis);
    const y = (time: number) => clamp(left + (right - left) * Math.max(0, Math.min(1, (coordinate(time) - coordinate(g.start)) / Math.max(0.02, coordinate(g.end) - coordinate(g.start)))));
    const from = Math.max(start, g.start), to = Math.min(end, g.end), x1 = x(from), x2 = Math.min(300, Math.max(x1 + 1, x(to)));
    const y1 = y(from), y2 = y(to);
    return { points: `${x1},${clamp(y1 - 3)} ${x2},${clamp(y2 - 3)} ${x2},${clamp(y2 + 3)} ${x1},${clamp(y1 + 3)}`,
      label: `No recorded samples · ${g.start.toFixed(2)}–${g.end.toFixed(2)} s` };
  });
}
