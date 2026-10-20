import { pointIndex } from './greenpowerData';

export interface LapInterval { time: number; end: number; lap: number; alternate: boolean; sessionLabel?: string; }
export function lapAt(laps: LapInterval[], time: number) {
  const lap = laps[pointIndex(laps, time, true) - 1];
  return lap && time <= lap.end ? lap.lap : undefined;
}
export function visibleLaps(laps: LapInterval[], start: number, end: number, width: number) {
  const result: (LapInterval & { x: number; width: number; label: string })[] = [];
  if (end <= start || width <= 0) return result;
  const first = Math.max(0, pointIndex(laps, start, true) - 1);
  for (let index = first; index < laps.length && laps[index].time < end; index++) {
    const lap = laps[index];
    const left = Math.max(start, lap.time), right = Math.min(end, lap.end);
    const pixels = (right - left) / (end - start) * width;
    // Subpixel intervals cannot be distinguished; bound DOM work to plot resolution.
    if (pixels < 1) continue;
    const label = 'Lap ' + lap.lap;
    result.push({ ...lap, x: (left - start) / (end - start) * 100, width: (right - left) / (end - start) * 100,
      label: pixels >= label.length * 8 + 16 ? label : '' });
  }
  return result;
}
