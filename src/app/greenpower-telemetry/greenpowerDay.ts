import { RecordingSegment, validDate, validId, validSegments } from './greenpowerEvents';

export const DAY_SESSION_TYPES = [
  { id: 'race', label: 'Race' }, { id: 'practice', label: 'Practice' },
  { id: 'battery_dyno', label: 'Battery dyno' }, { id: 'motor_dyno', label: 'Motor dyno' }
];
export const MAX_DAY_BYTES = 8 * 1024;
export const SESSION_SCOPE = 'GreenpowerTelemetry/424';
export interface EventDefaults {
  driver?: string; motorGearTeeth?: number; wheelGearTeeth?: number;
  motorId?: string; generatorId?: string; carMassKg?: number; driverMassKg?: number;
}
export interface DaySession {
  id: string; type: string; startAt: number; endAt: number;
  batteryIds: string[]; overrides: EventDefaults; ranges: RecordingSegment[];
  revision?: number; schemaVersion?: 2; telemetryRoot?: string; updatedBy?: string; updatedAt?: unknown;
}
export interface DayMetadata {
  date: string; eventName: string; trackId: string | null; result: string;
  defaults: EventDefaults;
}
export interface RecordedEvent extends DayMetadata {
  schemaVersion: 2; revision: number; updatedBy: string; updatedAt?: unknown;
}
export type DayEditRequest = { schemaVersion: 2; requestId: string; date: string; expectedRevision: number } & (
  { kind: 'event'; data: DayMetadata } | { kind: 'session'; expectedSessionRevision: number; session: DaySession });
export interface DayEditResult { date: string; revision: number; changeId: string; sessionId?: string; sessionRevision?: number; }
export function emptyDay(date: string): RecordedEvent {
  return { date, eventName: '', trackId: null, result: '', defaults: {},
    schemaVersion: 2, revision: 0, updatedBy: 'ingestion' };
}
export function effectiveDefaults(event: DayMetadata, session?: DaySession): EventDefaults {
  return { ...event.defaults, ...session?.overrides };
}
export function gearingRatio(event: DayMetadata, session?: DaySession): number | undefined {
  const values = effectiveDefaults(event, session);
  return values.motorGearTeeth && values.wheelGearTeeth ? values.wheelGearTeeth / values.motorGearTeeth : undefined;
}
export function sessionLabel(session: DaySession) {
  const time = (at: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(at);
  return (DAY_SESSION_TYPES.find(type => type.id === session.type)?.label || session.type) + ' · ' + time(session.startAt) + '–' + time(session.endAt);
}
export function defaultsError(value: EventDefaults): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Invalid defaults.';
  const fields = ['driver', 'motorGearTeeth', 'wheelGearTeeth', 'motorId', 'generatorId', 'carMassKg', 'driverMassKg'];
  for (const [key, item] of Object.entries(value)) {
    if (!fields.includes(key)) return 'Unsupported default field.';
    if (['driver', 'motorId', 'generatorId'].includes(key)) {
      if (typeof item !== 'string' || !item.trim() || item !== item.trim() || new TextEncoder().encode(item).length > 120) return 'Enter an identifier of up to 120 bytes.';
    } else if (typeof item !== 'number' || !Number.isFinite(item) || item <= 0 || key.endsWith('Teeth') && !Number.isSafeInteger(item)) return 'Enter positive values; gear teeth must be whole numbers.';
  }
  return '';
}
export function dayMetadataError(value: DayMetadata): string {
  if (!value || !validDate(value.date) || typeof value.eventName !== 'string' || typeof value.result !== 'string'
    || new TextEncoder().encode(value.eventName).length > 120 || new TextEncoder().encode(value.result).length > 120
    || value.trackId !== null && (typeof value.trackId !== 'string' || !value.trackId || value.trackId.length > 128 || value.trackId.includes('/'))) return 'Invalid event details.';
  const error = defaultsError(value.defaults); if (error) return error;
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_DAY_BYTES - 512) return 'Event metadata exceeds 8 KiB.';
  return '';
}
export function sessionMetadataError(session: DaySession, date: string): string {
  if (!session || !validId(session.id) || !DAY_SESSION_TYPES.some(type => type.id === session.type)
    || !Number.isSafeInteger(session.startAt) || !Number.isSafeInteger(session.endAt) || session.startAt > session.endAt
    || !Array.isArray(session.batteryIds) || session.batteryIds.length > 8 || new Set(session.batteryIds).size !== session.batteryIds.length
    || session.batteryIds.some(id => typeof id !== 'string' || !id.trim() || new TextEncoder().encode(id).length > 80)) return 'Check the session type, times and battery identifiers.';
  const error = defaultsError(session.overrides); if (error) return error;
  if (!validSegments(session.ranges) || session.ranges.some(range => range.day !== date)
    || session.ranges[0].firstAt !== session.startAt || session.ranges.at(-1)!.lastAt !== session.endAt) return 'Choose valid recorded session boundaries.';
  if (new TextEncoder().encode(JSON.stringify(session)).length > 16 * 1024 - 512) return 'Session metadata exceeds 16 KiB.';
  return '';
}
export function validDaySession(value: unknown, date: string): value is DaySession {
  const session = value as DaySession;
  try { return session?.schemaVersion === 2 && session.telemetryRoot === SESSION_SCOPE && Number.isSafeInteger(session.revision)
    && session.revision! > 0 && typeof session.updatedBy === 'string' && !sessionMetadataError(session, date); }
  catch { return false; }
}
export function editableSession(session: DaySession): DaySession {
  const { id, type, startAt, endAt, batteryIds, overrides, ranges } = session;
  return JSON.parse(JSON.stringify({ id, type, startAt, endAt, batteryIds, overrides, ranges }));
}
export function validRecordedEvent(value: unknown): value is RecordedEvent {
  const event = value as RecordedEvent;
  try { return event?.schemaVersion === 2 && Number.isSafeInteger(event.revision) && event.revision >= 0 && typeof event.updatedBy === 'string' && !dayMetadataError(event); }
  catch { return false; }
}
export function editableDay(event: RecordedEvent): DayMetadata {
  const { date, eventName, trackId, result, defaults } = event;
  return JSON.parse(JSON.stringify({ date, eventName, trackId, result, defaults }));
}
