import { channelDetails, GreenpowerChannel } from './greenpowerData';
export interface ViewSelection { scalars: Record<string, true>; charts: Record<string, true>; }
export interface GreenpowerView extends ViewSelection { revision: number; updatedBy: string; }
export const VIEW_PATH = 'GreenpowerTelemetry/424/config/view';
export const MAX_VIEW_CHANNELS = 512;
export function selectionFor(channels: GreenpowerChannel[]): ViewSelection {
  return { scalars: Object.fromEntries(channels.map(c => [c.id, true])), charts: Object.fromEntries(channels.filter(c => c.points.length).map(c => [c.id, true])) };
}
export function validSelection(value: unknown): value is ViewSelection {
  if (!value || typeof value !== 'object') return false;
  const selection = value as ViewSelection;
  return [selection.scalars, selection.charts].every(map => map && typeof map === 'object' && !Array.isArray(map) &&
    Object.keys(map).length <= MAX_VIEW_CHANNELS && Object.entries(map).every(([key, flag]) => !!key && new TextEncoder().encode(key).length <= 1500 && flag === true));
}
export function validView(value: unknown): value is GreenpowerView {
  const view = value as GreenpowerView;
  return validSelection(value) && Number.isSafeInteger(view.revision) && view.revision > 0 && typeof view.updatedBy === 'string';
}
export function selectedChannels(channels: GreenpowerChannel[], selection?: Record<string, true>) {
  if (!selection) return channels;
  const available = new Map(channels.map(c => [c.id, c]));
  return Object.keys(selection).sort().map(id => available.get(id) || { id, ...channelDetails(id), value: '—', points: [] });
}
export function editorChannels(channels: GreenpowerChannel[], selection: ViewSelection) {
  const existing = new Set(channels.map(c => c.id));
  const absent = Object.keys({ ...selection.scalars, ...selection.charts }).filter(id => !existing.has(id));
  return [...channels, ...absent.map(id => ({ id, ...channelDetails(id), value: '—', points: [] }))].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}
