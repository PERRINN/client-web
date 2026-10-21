import { ENERGY, POWER, VOLTAGE_LEFT, VOLTAGE_RIGHT } from './greenpowerData';

export interface ChartMarker { enabled: boolean; value: number | null; }
export type ChartMarkers = Record<string, ChartMarker>;
const defaults: Record<string, number> = {
  '["Vt"]:V': 21, [VOLTAGE_LEFT]: 10, [VOLTAGE_RIGHT]: 10,
  '["A"]:A': 24, '["AH"]:Ah': 24, 'computed:lap-average-amps': 24,
  [POWER]: 550, [ENERGY]: 550, 'computed:lap-average-power': 550
};
const disabledMarker: ChartMarker = Object.freeze({ enabled: false, value: 0 });
const defaultMarkers: ChartMarkers = Object.fromEntries(Object.entries(defaults)
  .map(([id, value]) => [id, Object.freeze({ enabled: true, value })]));
// Stable references keep the page clock from triggering unnecessary chart renders.
export function defaultMarker(id: string): ChartMarker {
  return Object.hasOwn(defaultMarkers, id) ? defaultMarkers[id] : disabledMarker;
}
export function markerFor(id: string, markers?: ChartMarkers): ChartMarker {
  return markers && Object.hasOwn(markers, id) ? markers[id] : defaultMarker(id);
}
export function copyMarkers(markers: ChartMarkers): ChartMarkers {
  return Object.fromEntries(Object.entries(markers).map(([id, marker]) => [id, { ...marker }]));
}
export function validMarkers(value: unknown): value is ChartMarkers {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 512) return false;
  return Object.entries(value).every(([id, setting]) => {
    if (!id || new TextEncoder().encode(id).length > 1500 || !setting || typeof setting !== 'object' || Array.isArray(setting)) return false;
    const marker = setting as ChartMarker;
    return Object.keys(marker).length === 2 && typeof marker.enabled === 'boolean'
      && (typeof marker.value === 'number' && Number.isFinite(marker.value) || !marker.enabled && marker.value === null);
  });
}
