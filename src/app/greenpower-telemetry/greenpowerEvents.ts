export const EVENT_ROOT = 'GreenpowerTelemetry/424';
export const EVENT_PAGE_SIZE = 30;
export const EVENT_TYPES = [
  { id: 'race', label: 'Race' }, { id: 'track_test', label: 'Track test' },
  { id: 'full_dyno', label: 'Full dyno' }, { id: 'battery_dyno', label: 'Battery dyno' },
  { id: 'workshop_test', label: 'Workshop test' }, { id: 'other', label: 'Other' }
];
export const METADATA_STATUSES = [
  { id: 'review_needed', label: 'Needs review' }, { id: 'matched', label: 'Matched' }, { id: 'unmatched', label: 'Unmatched' }
];
export interface Measurement { value: number; unit: string; }
export interface Engineering {
  batteryIds?: string[]; motorId?: string; generatorId?: string; gear?: string; wheel?: string; purpose?: string; outcome?: string;
  gearingRatio?: Measurement; carMass?: Measurement; driverMass?: Measurement;
  ambientTemperature?: Measurement; batteryTemperature?: Measurement; energy?: Measurement;
}
export interface Metadata {
  name: string; metadataStatus: 'matched' | 'review_needed' | 'unmatched';
  description?: string; notes?: string; driver?: string; operator?: string; result?: string; tags?: string[];
  engineering?: Engineering; provenance?: { kind: string; sourceKey: string; documentId?: string; sheetName?: string; sheetId?: number; row?: number; sourceSha256?: string }[];
}
export interface EventData extends Metadata {
  type: string; date: string; timeZone: 'Europe/London'; state: 'active' | 'superseded';
  localTime?: string; location?: string; supersededBy?: string[];
}
export interface RecordingSegment {
  day: string; source: 'echook-history' | '424-phone'; importId?: string;
  firstChunk: string; lastChunk: string; firstIndex: number; lastIndex: number;
  firstSampleId: string; lastSampleId: string; firstAt: number; lastAt: number;
}
export interface SessionData extends Metadata { eventId: string; runNumber?: number; firstAt: number; lastAt: number; segments: RecordingSegment[]; }
export interface SavedMetadata { id: string; revision: number; updatedBy: string; }
export interface TelemetryEvent extends EventData, SavedMetadata { sessionCount: number; locationKey?: string; }
export interface TelemetrySession extends SessionData, SavedMetadata {}
export type DayEventSummary = Pick<TelemetryEvent, 'id' | 'name' | 'date' | 'state' | 'revision'>;
export interface RecordedDayContext { events: DayEventSummary[]; complete: boolean; loading: boolean; failed: boolean; }
export interface EventFilters { type: string; location: string; from: string; to: string; }
export interface MetadataChange<T> { id: string; expectedRevision: number; data?: T; }
export interface EventEditRequest { requestId: string; action: 'edit' | 'reassign' | 'split' | 'merge'; events: MetadataChange<EventData>[]; sessions: MetadataChange<SessionData>[]; }
export interface EventEditResult { changeId: string; events: { id: string; revision: number }[]; sessions: { id: string; revision: number }[]; }
export type MetadataDraft = Partial<EventData & SessionData>;

const common = ['name', 'description', 'notes', 'driver', 'operator', 'result', 'tags', 'engineering', 'metadataStatus', 'provenance'];
export function editable<T extends EventData | SessionData>(record: T): T {
  const fields = 'eventId' in record ? [...common, 'eventId', 'runNumber', 'firstAt', 'lastAt', 'segments']
    : [...common, 'type', 'date', 'timeZone', 'localTime', 'location', 'state', 'supersededBy'];
  return JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(record).filter(([key]) => fields.includes(key)))));
}
export function eventType(type: string) { return EVENT_TYPES.find(item => item.id === type)?.label || type; }
export function locationKey(location: string) { return location.trim().normalize('NFKC').toLowerCase().replace(/\s+/g, ' '); }
export function validId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !/^__.*__$/.test(value); }
export function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
    && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
const position = (segment: RecordingSegment, end: 'first' | 'last') => `${segment.day}/${segment[end + 'Chunk']}/${String(segment[end + 'Index']).padStart(2, '0')}`;
export function validSegments(values: unknown): values is RecordingSegment[] {
  return Array.isArray(values) && values.length > 0 && values.length <= 20 && values.every((s, index) => {
    if (!s || !validDate(s.day) || !['echook-history', '424-phone'].includes(s.source)
      || ![s.firstChunk, s.lastChunk].every(v => typeof v === 'string' && /^\d{10}$/.test(v)) || s.firstChunk > s.lastChunk
      || ![s.firstIndex, s.lastIndex].every(v => Number.isInteger(v) && v >= 0 && v < 32)
      || s.firstChunk === s.lastChunk && s.firstIndex > s.lastIndex
      || ![s.firstSampleId, s.lastSampleId].every(v => typeof v === 'string' && v.length > 0 && v.length <= 200)
      || ![s.firstAt, s.lastAt].every(v => Number.isSafeInteger(v) && v >= 0 && v <= 8640000000000000) || s.firstAt > s.lastAt
      || s.source === 'echook-history' && !validId(s.importId) || s.source === '424-phone' && s.importId !== undefined) return false;
    return !index || position(values[index - 1], 'last') < position(s, 'first') && values[index - 1].lastAt <= s.firstAt;
  });
}
export function metadataError(data: MetadataDraft, session = false): string {
  const size = (value: unknown) => typeof value === 'string' ? new TextEncoder().encode(value).length : Infinity;
  if (typeof data.name !== 'string' || !data.name.trim()) return 'Enter a name.';
  if (size(data.name) > 120) return 'Name is too long.';
  if (!METADATA_STATUSES.some(item => item.id === data.metadataStatus)) return 'Choose a review status.';
  for (const [key, max] of Object.entries({ location: 120, driver: 120, operator: 120, result: 120, description: 2000, notes: 4000 })) {
    if (data[key] !== undefined && size(data[key]) > max) return `${key[0].toUpperCase() + key.slice(1)} is too long.`;
  }
  if (session) {
    if (!validId(data.eventId) || !validSegments(data.segments) || data.firstAt !== data.segments[0].firstAt || data.lastAt !== data.segments.at(-1)?.lastAt) return 'Choose a valid recorded range.';
    if (data.runNumber !== undefined && (!Number.isSafeInteger(data.runNumber) || data.runNumber < 1)) return 'Enter a positive run number.';
  } else if (!EVENT_TYPES.some(item => item.id === data.type) || !validDate(data.date) || data.timeZone !== 'Europe/London') return 'Choose an event type and valid UK date.';
  if (data.tags && (data.tags.length > 16 || new Set(data.tags).size !== data.tags.length)) return 'Use up to 16 distinct tags.';
  if (data.tags?.some(tag => !tag || size(tag) > 40)) return 'A tag is too long or empty.';
  if (data.provenance !== undefined && (!Array.isArray(data.provenance) || data.provenance.length > 16 || data.provenance.some(source => !source || typeof source.kind !== 'string' || typeof source.sourceKey !== 'string'))) return 'Source metadata is invalid.';
  if (data.engineering !== undefined) {
    if (!data.engineering || typeof data.engineering !== 'object' || Array.isArray(data.engineering)) return 'Engineering metadata is invalid.';
    const units = { gearingRatio: '1', carMass: 'kg', driverMass: 'kg', ambientTemperature: '°C', batteryTemperature: '°C', energy: 'Wh' };
    for (const [key, unit] of Object.entries(units)) if (data.engineering[key] !== undefined) {
      const reading = data.engineering[key];
      if (!reading || typeof reading.value !== 'number' || !Number.isFinite(reading.value) || reading.unit !== unit
        || key.endsWith('Temperature') && reading.value < -273.15 || !key.endsWith('Temperature') && (key === 'energy' ? reading.value < 0 : reading.value <= 0)) return 'Enter finite engineering values with the displayed units.';
    }
    if (data.engineering.batteryIds !== undefined && (!Array.isArray(data.engineering.batteryIds) || data.engineering.batteryIds.length > 8 || data.engineering.batteryIds.some(value => !value || size(value) > 80))) return 'Use up to eight battery identifiers.';
  }
  if (new TextEncoder().encode(JSON.stringify(data)).length > 8192) return 'Metadata is too large.';
  return '';
}
function saved(value: unknown): value is SavedMetadata & Metadata {
  const record = value as SavedMetadata & Metadata;
  return !!record && validId(record.id) && Number.isSafeInteger(record.revision) && record.revision > 0 && typeof record.updatedBy === 'string'
    && typeof record.name === 'string' && record.name.length > 0 && METADATA_STATUSES.some(item => item.id === record.metadataStatus);
}
export function validEvent(value: unknown): value is TelemetryEvent {
  const event = value as TelemetryEvent;
  try { return saved(value) && !metadataError(editable(event)) && Number.isSafeInteger(event.sessionCount) && event.sessionCount >= 0 && ['active', 'superseded'].includes(event.state); }
  catch { return false; }
}
export function validSession(value: unknown): value is TelemetrySession { try { return saved(value) && !metadataError(editable(value as TelemetrySession), true); } catch { return false; } }
