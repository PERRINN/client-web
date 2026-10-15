import { SessionHistory } from './sessionHistory';
import { LapOverlay } from './lapOverlay';
export interface ScatterPoint { x: number; y: number; row: number }
export interface ScatterLayer { color: string; points: ScatterPoint[] }
// Each dot pairs two original values from the same dynamics row, without interpolation.
export function rideHeightScatter(history: SessionHistory, front: number, rear: number, start: number, end: number, overlay?: LapOverlay): ScatterLayer[] {
  if (front < 0 || rear < 0) return [];
  const point = (row: number) => {
    const x = history.value(row, front), y = history.value(row, rear);
    return Number.isFinite(x) && Number.isFinite(y) ? {x,y,row} : undefined;
  };
  if (overlay) return overlay.tracks.map(track => {
    const points: ScatterPoint[] = [];
    track.rows.forEach((row,i) => { if (track.distances[i] >= start && track.distances[i] <= end) { const p = point(row); if (p) points.push(p); } });
    return {color:track.color,points};
  });
  const points: ScatterPoint[] = [];
  for (let row = 0; row < history.length; row++) {
    const time = history.time(row);
    if (time < start) continue;
    if (time > end) break;
    const p = point(row); if (p) points.push(p);
  }
  return [{color:'var(--color-text-secondary)',points}];
}

// Hit testing uses screen distance, so unequal front/rear axis spans do not bias selection.
export function nearestScatterRow(layers: ScatterLayer[], x: number, y: number, scaleX: number, scaleY: number, radius = 12): number | undefined {
  let nearest: number | undefined, best = radius;
  for (const layer of layers) for (const point of layer.points) {
    const distance = Math.hypot((point.x-x)*scaleX,(point.y-y)*scaleY);
    if (distance <= best && (nearest === undefined || distance < best)) { nearest=point.row; best=distance; }
  }
  return nearest;
}
