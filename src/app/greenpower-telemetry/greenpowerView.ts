import { ChartMarkers, copyMarkers, validMarkers } from './greenpowerMarkers';
import { isRaceTime, isVehicleSpeed, MOTOR_DERIVED_SPEED, COMPUTED_CHANNEL_IDS, VEHICLE_SPEED, VOLTAGE_LEFT, VOLTAGE_RIGHT, channelDetails, GreenpowerChannel } from './greenpowerData';
export type ViewKind = 'scalars' | 'charts';
export interface ViewSelection {
  scalars: Record<string, true>; charts: Record<string, true>;
  markers?: ChartMarkers;
  scalarOrder?: string[]; chartOrder?: string[];
}
export const orderField = (kind: ViewKind) => kind === 'scalars' ? 'scalarOrder' : 'chartOrder';
export function orderFor(selection: ViewSelection, kind: ViewKind) {
  return selection[orderField(kind)]?.slice() ?? Object.keys(selection[kind]).sort();
}
export function copySelection(selection: ViewSelection): ViewSelection {
  return { ...(selection.markers ? { markers: copyMarkers(selection.markers) } : {}), scalars: { ...selection.scalars }, charts: { ...selection.charts }, scalarOrder: orderFor(selection, 'scalars'), chartOrder: orderFor(selection, 'charts') };
}
export interface GreenpowerView extends ViewSelection { revision: number; updatedBy: string; }
export const VIEW_PATH = 'GreenpowerTelemetry/424/config/view';
export const MAX_VIEW_CHANNELS = 512;
export function selectionFor(channels: GreenpowerChannel[]): ViewSelection {
  return { scalars: Object.fromEntries(channels.map(c => [c.id, true])), charts: Object.fromEntries(configurableCharts(channels).filter(c => chartHasData(c, channels)).map(c => [c.id, true])) };
}
export function validSelection(value: unknown): value is ViewSelection {
  if (!value || typeof value !== 'object') return false;
  const selection = value as ViewSelection;
  return (selection.markers === undefined || validMarkers(selection.markers)) && [selection.scalars, selection.charts].every(map => map && typeof map === 'object' && !Array.isArray(map) &&
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
  return (order ?? Object.keys(selection).sort()).map(id => {
    const channel = available.get(id);
    if (channel) return channel;
    const missing: GreenpowerChannel = { id, ...channelDetails(id), value: '—', points: [] };
    // Source casing and seconds-unit envelopes vary between recordings. Keep the
    // saved selection identity while displaying the available race-time projection.
    const raceTime = isRaceTime(missing) ? channels.find(isRaceTime) : undefined;
    return raceTime ? { ...raceTime, id } : missing;
  });
}
export function editorChannels(channels: GreenpowerChannel[], selection: ViewSelection) {
  const existing = new Set(channels.map(c => c.id));
  const ids = new Set([...COMPUTED_CHANNEL_IDS, ...Object.keys(selection.markers ?? {}), ...Object.keys({ ...selection.scalars, ...selection.charts })]);
  // Motor-derived speed shares the Vehicle speed chart even on recordings without Spd.
  if (!channels.some(c => isVehicleSpeed(c.id))) ids.add(VEHICLE_SPEED);
  const absent = [...ids].filter(id => !existing.has(id));
  return [...channels, ...absent.map(id => ({ id, ...channelDetails(id), value: '—', points: [] }))].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

// These comparison traces belong to the Vehicle speed and Voltage left chart controls.
export function configurableCharts(channels: GreenpowerChannel[]) { return channels.filter(c => c.id !== VOLTAGE_RIGHT && c.id !== MOTOR_DERIVED_SPEED); }
export function chartOption(channel: GreenpowerChannel) {
  const label = channel.id === VOLTAGE_LEFT ? 'Voltage left / right'
    : isVehicleSpeed(channel.id) ? 'Vehicle speed / Motor-derived speed' : channel.label;
  return label === channel.label ? channel : { ...channel, label };
}
export function telemetryCharts(channels: GreenpowerChannel[], selected: GreenpowerChannel[]) {
  return configurableCharts(selected).filter(c => chartHasData(c, channels));
}

export function chartHasData(channel: GreenpowerChannel, channels: GreenpowerChannel[]) {
  return !!channel.points.length || isVehicleSpeed(channel.id) && channels.some(item => item.id === MOTOR_DERIVED_SPEED && item.points.length);
}
