import type { LiveParameter } from './telemetry.service';
import type { SessionLap } from './sessionAnalysis';
export interface LapChange { parameter: string; mode: 'offset' | 'gain'; amount: number }
export const emptyPlan = (): LapChange[] => [2, 3].map(() => ({ parameter: '', mode: 'offset', amount: 0 }));
export function delta(value?: number, baseline?: number) {
  if (value === undefined || baseline === undefined || !Number.isFinite(value) || !Number.isFinite(baseline)) return undefined;
  return Math.round((value - baseline) * 1000) / 1000;
}
export function deltaTime(value?: number) { return value === undefined ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toFixed(3)}`; }
export function comparison(lap: SessionLap | undefined, baseline: SessionLap | undefined, sector?: number) {
  if (lap === baseline) return undefined;
  if (sector !== undefined) {
    const a = lap?.sectors.find(s => s.index === sector), b = baseline?.sectors.find(s => s.index === sector);
    return a?.valid && b?.valid ? delta(a.time, b.time) : undefined;
  }
  return lap?.valid && baseline?.valid ? delta(lap.duration, baseline.duration) : undefined;
}
export function target(change: LapChange, parameters: LiveParameter[]) {
  const p = parameters.find(p => p.id === change.parameter);
  return p ? change.mode === 'gain' ? p.value * change.amount : p.value + change.amount : undefined;
}
export function setupError(change: LapChange, parameters: LiveParameter[]) {
  if (!change.parameter) return '';
  const p = parameters.find(p => p.id === change.parameter), value = target(change, parameters);
  return !p?.available ? 'Parameter unavailable' : value === undefined || !Number.isFinite(change.amount) || !Number.isFinite(value) || value < p.min || value > p.max ? `Target must be ${p.min}–${p.max} ${p.unit}` : '';
}
