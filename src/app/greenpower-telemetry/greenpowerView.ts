import { channelDetails, GreenpowerChannel } from './greenpowerData';
export type ViewKind = 'scalars' | 'charts';
export interface ViewSelection {
  scalars: Record<string, true>; charts: Record<string, true>;
  scalarOrder?: string[]; chartOrder?: string[];
}
export const orderField = (kind: ViewKind) => kind === 'scalars' ? 'scalarOrder' : 'chartOrder';
export function orderFor(selection: ViewSelection, kind: ViewKind) {
  return selection[orderField(kind)]?.slice() ?? Object.keys(selection[kind]).sort();
}
export function copySelection(selection: ViewSelection): ViewSelection {
  return { scalars: { ...selection.scalars }, charts: { ...selection.charts }, scalarOrder: orderFor(selection, 'scalars'), chartOrder: orderFor(selection, 'charts') };
}
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
    Object.keys(map).length <= MAX_VIEW_CHANNELS && Object.entries(map).every(([key, flag]) => !!key && new TextEncoder().encode(key).length <= 1500 && flag === true)) &&
    (['scalars', 'charts'] as ViewKind[]).every(kind => {
      const order = selection[orderField(kind)], keys = Object.keys(selection[kind]);
      return order === undefined || Array.isArray(order) && order.length === keys.length &&
        new Set(order).size === order.length && order.every(id => typeof id === 'string' && Object.hasOwn(selection[kind], id));
    });
}
export function validView(value: unknown): value is GreenpowerView {
  const view = value as GreenpowerView;
  return validSelection(value) && Number.isSafeInteger(view.revision) && view.revision > 0 && typeof view.updatedBy === 'string';
}
export function selectedChannels(channels: GreenpowerChannel[], selection?: Record<string, true>, order?: string[]) {
  if (!selection) return channels;
  const available = new Map(channels.map(c => [c.id, c]));
  return (order ?? Object.keys(selection).sort()).map(id => available.get(id) || { id, ...channelDetails(id), value: '—', points: [] });
}
export function editorChannels(channels: GreenpowerChannel[], selection: ViewSelection) {
  const existing = new Set(channels.map(c => c.id));
  const absent = Object.keys({ ...selection.scalars, ...selection.charts }).filter(id => !existing.has(id));
  return [...channels, ...absent.map(id => ({ id, ...channelDetails(id), value: '—', points: [] }))].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}
