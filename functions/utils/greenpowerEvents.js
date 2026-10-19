const { createHash } = require('node:crypto');

const ROOT = 'GreenpowerTelemetry/424';
const LIMITS = Object.freeze({ requestBytes: 128 * 1024, recordBytes: 8 * 1024, auditBytes: 512 * 1024,
  events: 4, sessions: 20, segments: 20, attempts: 3, readsPerAttempt: 105, writes: 26 });
const TYPES = ['race', 'track_test', 'full_dyno', 'battery_dyno', 'workshop_test', 'other'];
const SESSION_TYPES = ['race', 'practice', 'qualifying', 'track_test', 'full_dyno', 'battery_dyno', 'workshop_test', 'other'];
const STATUSES = ['matched', 'review_needed', 'unmatched'];
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });

class MetadataError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function check(condition, message, code = 'invalid-argument') {
  if (!condition) throw new MetadataError(code, message);
}
function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function keys(value, allowed, required = []) {
  check(object(value) && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key)), 'Invalid metadata fields.');
}
function text(value, max) { return typeof value === 'string' && value.length > 0 && value === value.trim() && Buffer.byteLength(value) <= max; }
function id(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !/^__.*__$/.test(value); }
function integer(value, min = 0) { return Number.isSafeInteger(value) && value >= min; }
function date(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
function londonDay(value) {
  if (!integer(value) || value > 8640000000000000) return '';
  const parts = Object.fromEntries(dayFormat.formatToParts(value).map(part => [part.type, part.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const digest = value => createHash('sha256').update(value).digest('hex');
const bytes = value => Buffer.byteLength(JSON.stringify(value));
function strings(values, maxCount, maxBytes) {
  return Array.isArray(values) && values.length <= maxCount && values.every(v => text(v, maxBytes)) && new Set(values).size === values.length;
}
function provenance(values) {
  check(Array.isArray(values) && values.length <= 16, 'Invalid provenance.');
  for (const value of values) {
    keys(value, ['kind', 'sourceKey', 'documentId', 'sheetId', 'sheetName', 'row', 'sourceSha256'], ['kind', 'sourceKey']);
    check(['manual', 'spreadsheet', 'import'].includes(value.kind) && text(value.sourceKey, 200), 'Invalid provenance source.');
    if (value.kind === 'spreadsheet') check(text(value.documentId, 128) && integer(value.sheetId) && text(value.sheetName, 100) && integer(value.row, 1), 'Spreadsheet provenance requires a document, sheet and row.');
    for (const field of ['documentId', 'sheetName']) if (field in value) check(text(value[field], field === 'documentId' ? 128 : 100), 'Invalid provenance field.');
    for (const field of ['sheetId', 'row']) if (field in value) check(integer(value[field], field === 'row' ? 1 : 0), 'Invalid provenance position.');
    if ('sourceSha256' in value) check(typeof value.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sourceSha256), 'Invalid provenance checksum.');
  }
}
function engineering(value) {
  const measures = { gearingRatio: '1', carMass: 'kg', driverMass: 'kg', ambientTemperature: '°C', batteryTemperature: '°C', energy: 'Wh' };
  keys(value, [...Object.keys(measures), 'batteryIds', 'motorId', 'generatorId', 'gear', 'wheel', 'purpose', 'outcome']);
  for (const [field, unit] of Object.entries(measures)) if (field in value) {
    const reading = value[field]; keys(reading, ['value', 'unit'], ['value', 'unit']);
    check(typeof reading.value === 'number' && Number.isFinite(reading.value) && reading.unit === unit, 'Engineering measurements require a finite value and the documented unit.');
    if (field.endsWith('Temperature')) check(reading.value >= -273.15, 'Temperature is below absolute zero.');
    else check(reading.value >= 0 && (field === 'energy' || reading.value > 0), 'Invalid engineering measurement.');
  }
  if ('batteryIds' in value) check(strings(value.batteryIds, 8, 80), 'Invalid battery identifiers.');
  for (const field of ['motorId', 'generatorId', 'gear', 'wheel', 'purpose', 'outcome']) if (field in value) check(text(value[field], ['purpose', 'outcome'].includes(field) ? 500 : 80), 'Invalid engineering field.');
}
const COMMON = ['name', 'description', 'notes', 'driver', 'operator', 'result', 'tags', 'engineering', 'metadataStatus', 'provenance'];
const SERVER = ['revision', 'updatedAt', 'updatedBy'];
function common(value) {
  check(text(value.name, 120) && STATUSES.includes(value.metadataStatus), 'A name and valid metadata status are required.');
  for (const [field, max] of Object.entries({ description: 2000, notes: 4000, driver: 120, operator: 120, result: 120 })) {
    if (field in value) check(text(value[field], max), 'Invalid ' + field + '. Omit unknown or empty fields.');
  }
  if ('tags' in value) check(strings(value.tags, 16, 40), 'Invalid tags.');
  if ('engineering' in value) engineering(value.engineering);
  if ('provenance' in value) provenance(value.provenance);
  check(bytes(value) <= LIMITS.recordBytes, 'Metadata record exceeds 8 KiB.');
}
function eventData(value) {
  keys(value, [...COMMON, 'type', 'date', 'localTime', 'timeZone', 'location', 'state', 'supersededBy'], ['name', 'type', 'date', 'timeZone', 'metadataStatus', 'state']);
  common(value);
  check(TYPES.includes(value.type) && date(value.date) && value.timeZone === 'Europe/London', 'Invalid event type, UK date or timezone.');
  if ('localTime' in value) check(typeof value.localTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.localTime), 'Invalid local event time.');
  if ('location' in value) check(text(value.location, 120), 'Invalid location.');
  check(['active', 'superseded'].includes(value.state), 'Invalid event state.');
  if (value.state === 'superseded') check(Array.isArray(value.supersededBy) && value.supersededBy.length > 0 && value.supersededBy.length <= 3 && value.supersededBy.every(id) && new Set(value.supersededBy).size === value.supersededBy.length, 'Superseded events require distinct successor IDs.');
  else check(!('supersededBy' in value), 'An active event cannot have successors.');
}
function segmentData(value) {
  keys(value, ['day', 'source', 'importId', 'firstChunk', 'lastChunk', 'firstIndex', 'lastIndex', 'firstSampleId', 'lastSampleId', 'firstAt', 'lastAt'],
    ['day', 'source', 'firstChunk', 'lastChunk', 'firstIndex', 'lastIndex', 'firstSampleId', 'lastSampleId', 'firstAt', 'lastAt']);
  check(date(value.day) && ['echook-history', '424-phone'].includes(value.source), 'Invalid recording day or source.');
  check([value.firstChunk, value.lastChunk].every(v => typeof v === 'string' && /^\d{10}$/.test(v)) && value.firstChunk <= value.lastChunk, 'Invalid chunk range.');
  check([value.firstIndex, value.lastIndex].every(v => integer(v) && v < 32) && (value.firstChunk !== value.lastChunk || value.firstIndex <= value.lastIndex), 'Invalid sample positions.');
  check(text(value.firstSampleId, 200) && text(value.lastSampleId, 200), 'Boundary sample IDs are required.');
  check(integer(value.firstAt) && integer(value.lastAt) && value.firstAt <= value.lastAt && londonDay(value.firstAt) === value.day && londonDay(value.lastAt) === value.day, 'Invalid recording timestamps.');
  if (value.source === 'echook-history') check(id(value.importId), 'Historical segments require an import reference.');
  else check(!('importId' in value), 'Live-source segments cannot claim an import.');
}
const segmentPosition = (segment, side) => segment.day + '/' + segment[side + 'Chunk'] + '/' + String(segment[side + 'Index']).padStart(2, '0');
function sessionData(value, requireType = true) {
  keys(value, [...COMMON, 'type', 'eventId', 'runNumber', 'firstAt', 'lastAt', 'segments'], ['name', 'eventId', 'metadataStatus', 'firstAt', 'lastAt', 'segments']);
  common(value); check(id(value.eventId), 'Invalid session event ID.');
  check((!requireType && value.type === undefined) || SESSION_TYPES.includes(value.type), 'Choose a session type.');
  if ('runNumber' in value) check(integer(value.runNumber, 1), 'Invalid run number.');
  check(Array.isArray(value.segments) && value.segments.length > 0 && value.segments.length <= LIMITS.segments, 'A session requires bounded recording segments.');
  value.segments.forEach((segment, index) => {
    segmentData(segment);
    if (index) check(segmentPosition(value.segments[index - 1], 'last') < segmentPosition(segment, 'first') && value.segments[index - 1].lastAt <= segment.firstAt, 'Segments must be ordered and cannot overlap.');
  });
  check(value.firstAt === value.segments[0].firstAt && value.lastAt === value.segments.at(-1).lastAt, 'Session timestamps must match verified recording boundaries.');
}
function validateRequest(input) {
  keys(input, ['requestId', 'action', 'events', 'sessions'], ['requestId', 'action', 'events', 'sessions']);
  check(bytes(input) <= LIMITS.requestBytes, 'Edit request exceeds 128 KiB.');
  check(id(input.requestId) && ['edit', 'reassign', 'split', 'merge'].includes(input.action), 'Invalid request ID or action.');
  check(Array.isArray(input.events) && input.events.length > 0 && input.events.length <= LIMITS.events, 'Include one to four affected events.');
  check(Array.isArray(input.sessions) && input.sessions.length <= LIMITS.sessions, 'Edit at most twenty sessions per action.');
  let segments = 0;
  for (const [kind, changes] of [['events', input.events], ['sessions', input.sessions]]) {
    check(new Set(changes.map(c => c?.id)).size === changes.length, 'Duplicate record IDs.');
    for (const change of changes) {
      keys(change, ['id', 'expectedRevision', 'data'], ['id', 'expectedRevision']);
      check(id(change.id) && integer(change.expectedRevision) && change.expectedRevision < Number.MAX_SAFE_INTEGER, 'Invalid record ID or expected revision.');
      if (kind === 'sessions') { sessionData(change.data); segments += change.data.segments.length; }
      else if ('data' in change) eventData(change.data);
      else check(change.expectedRevision > 0, 'New events require metadata.');
    }
  }
  check(segments <= LIMITS.segments, 'Edit at most twenty recording segments total per action.');
  // Copy only after validation: no reference to a caller-mutated draft survives an await.
  const request = JSON.parse(JSON.stringify(input));
  const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  request.events.sort(byId); request.sessions.sort(byId);
  return request;
}
function storedData(value, kind) {
  const data = Object.fromEntries(Object.entries(value).filter(([key]) => !SERVER.includes(key) && !(kind === 'events' && ['sessionCount', 'locationKey'].includes(key))));
  if (kind === 'events') eventData(data); else sessionData(data, false);
  check(integer(value.revision, 1) && text(value.updatedBy, 128) && value.updatedAt != null, 'Stored metadata is invalid.', 'failed-precondition');
  if (kind === 'events') check(integer(value.sessionCount), 'Stored session count is invalid.', 'failed-precondition');
  return data;
}
function authorize(auth) {
  check(auth && text(auth.uid, 128), 'Sign in to edit telemetry metadata.', 'unauthenticated');
  check(auth.token?.perrinnAdmin === true, 'PERRINN admin access is required.', 'permission-denied');
}

/** Only exact metadata paths are writable. Raw/day/import documents are read-only. */
async function editMetadata(db, auth, input, { timestamp, dryRun = false, migrationSources = [] } = {}) {
  authorize(auth);
  const request = validateRequest(input), uid = auth.uid;
  check(request.action === 'edit', 'Events are recorded UK days; sessions cannot move between events.');
  for (const change of request.events) if (change.data) {
    check(change.id === change.data.date && change.data.state === 'active', 'An event ID must be its recorded UK date and remain active.');
  }
  check(Array.isArray(migrationSources) && migrationSources.length <= 4 && migrationSources.every(source =>
    source && id(source.id) && date(source.date) && source.id !== source.date && integer(source.revision, 1)), 'Invalid migration sources.');
  check(typeof timestamp === 'function', 'Server timestamp provider is required.', 'internal');
  const hash = digest(canonical(request)), changeId = digest(canonical([uid, request.requestId]));
  const requestRef = db.doc(ROOT + '/metadataRequests/' + changeId);
  let attempts = 0, totalReads = 0;
  return db.runTransaction(async transaction => {
    check(++attempts <= LIMITS.attempts, 'Metadata transaction retry budget exceeded.', 'resource-exhausted');
    let reads = 0;
    const cache = new Map();
    async function get(ref) {
      if (!cache.has(ref.path)) {
        check(++reads <= LIMITS.readsPerAttempt, 'Metadata read budget exceeded.', 'resource-exhausted');
        totalReads++;
        cache.set(ref.path, await transaction.get(ref));
      }
      return cache.get(ref.path);
    }
    async function preload(refs) {
      const missing = Array.from(new Map(refs.filter(ref => !cache.has(ref.path)).map(ref => [ref.path, ref])).values());
      if (!missing.length) return;
      reads += missing.length;
      check(reads <= LIMITS.readsPerAttempt, 'Metadata read budget exceeded.', 'resource-exhausted');
      totalReads += missing.length;
      const snapshots = await transaction.getAll(...missing);
      snapshots.forEach(snapshot => cache.set(snapshot.ref.path, snapshot));
      check(missing.every(ref => cache.has(ref.path)), 'Incomplete metadata read.', 'internal');
    }
    const previousRequest = (await get(requestRef)).data();
    if (previousRequest) {
      check(previousRequest.actor === uid && previousRequest.requestSha256 === hash, 'Request ID was already used for different metadata.', 'already-exists');
      return { ...previousRequest.result, replayed: true, dryRun, reads: totalReads, attemptReads: reads, attempts, writes: 0 };
    }
    const records = { events: new Map(), sessions: new Map() };
    await preload(['events', 'sessions'].flatMap(kind => request[kind].map(change => db.doc(ROOT + '/' + kind + '/' + change.id))));
    for (const kind of ['events', 'sessions']) for (const change of request[kind]) {
      const ref = db.doc(ROOT + '/' + kind + '/' + change.id), before = (await get(ref)).data();
      check((before?.revision ?? 0) === change.expectedRevision && (!!before || change.expectedRevision === 0), 'Metadata changed. Reload before saving.', 'failed-precondition');
      const oldData = before ? storedData(before, kind) : undefined;
      records[kind].set(change.id, { ref, before, data: change.data ?? oldData, revision: change.expectedRevision + 1 });
    }
    const event = eventId => {
      const record = records.events.get(eventId);
      check(record, 'Include the session’s event with its expected revision.', 'failed-precondition');
      return record;
    };
    const counts = new Map(Array.from(records.events, ([eventId, record]) => [eventId, record.before?.sessionCount ?? 0]));
    await preload([
      ...Array.from(records.events.values(), record => db.doc(ROOT + '/days/' + record.data.date)),
      ...migrationSources.map(source => db.doc(ROOT + '/events/' + source.id)),
      ...request.sessions.flatMap(change => change.data.segments.flatMap(segment => [
      db.doc(ROOT + '/days/' + segment.day),
      db.doc(ROOT + '/days/' + segment.day + '/chunks/' + segment.firstChunk),
      db.doc(ROOT + '/days/' + segment.day + '/chunks/' + segment.lastChunk),
      ...(segment.importId ? [db.doc(ROOT + '/imports/' + segment.importId)] : []),
    ]))]);
    for (const [eventId, record] of records.events) {
      check(eventId === record.data.date && record.data.state === 'active', 'Migrate legacy event metadata before editing.', 'failed-precondition');
      const day = (await get(db.doc(ROOT + '/days/' + eventId))).data();
      check(day?.date === eventId && integer(day.count, 1), 'An event requires a recorded UK day.', 'failed-precondition');
    }
    const sourceSnapshots = {};
    for (const source of migrationSources) {
      check(id(source.id) && date(source.date) && source.id !== source.date && integer(source.revision, 1), 'Invalid migration source.');
      const before = (await get(db.doc(ROOT + '/events/' + source.id))).data();
      check(before && before.revision === source.revision && before.date === source.date && before.sessionCount === 0, 'Migration source changed or has sessions.', 'failed-precondition');
      const target = records.events.get(source.date);
      check(target && !target.before && canonical(storedData(before, 'events')) === canonical(target.data), 'Migration must preserve source metadata exactly.', 'failed-precondition');
      sourceSnapshots[source.id] = before;
    }
    for (const record of records.sessions.values()) {
      const target = event(record.data.eventId);
      check(record.data.segments.every(segment => segment.day === target.data.date), 'Sessions must stay within their event’s UK recorded day.');
      const sourceId = record.before?.eventId;
      check(!sourceId || sourceId === record.data.eventId, 'Sessions cannot move between recorded days.');
      if (sourceId !== record.data.eventId) {
        counts.set(record.data.eventId, counts.get(record.data.eventId) + 1);
      }
      for (const segment of record.data.segments) await verifySegment(db, get, segment);
    }
    const auditRecords = [];
    const result = { changeId, events: [], sessions: [] };
    for (const kind of ['events', 'sessions']) for (const [recordId, record] of records[kind]) {
      if (kind === 'events') check(integer(counts.get(recordId)), 'Session counts would become invalid.', 'failed-precondition');
      const after = { ...record.data, ...(kind === 'events' ? { sessionCount: counts.get(recordId),
        ...(record.data.location ? { locationKey: record.data.location.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ') } : {}) } : {}),
      revision: record.revision, updatedBy: uid, updatedAt: timestamp() };
      check(bytes({ ...after, updatedAt: null }) <= LIMITS.recordBytes, 'Stored metadata exceeds 8 KiB.');
      record.after = after;
      auditRecords.push({ kind, id: recordId, before: record.before ?? null, after });
      result[kind].push({ id: recordId, revision: record.revision });
    }
    // Server timestamps are supported inside maps, not inside array elements.
    const audit = { actor: uid, action: request.action, requestId: request.requestId, requestSha256: hash, createdAt: timestamp(),
      ...(migrationSources.length ? { migrationSources: sourceSnapshots } : {}),
      records: Object.fromEntries(['events', 'sessions'].map(kind => [kind, Object.fromEntries(auditRecords.filter(record => record.kind === kind)
        .map(record => [record.id, { before: record.before, after: record.after }]))])) };
    check(bytes(audit) <= LIMITS.auditBytes, 'Audit exceeds 512 KiB. Split this edit into smaller actions.');
    const writes = auditRecords.length + 2;
    check(writes <= LIMITS.writes, 'Metadata write budget exceeded.', 'resource-exhausted');
    if (!dryRun) {
      for (const kind of ['events', 'sessions']) for (const record of records[kind].values()) transaction.set(record.ref, record.after);
      transaction.create(db.doc(ROOT + '/metadataChanges/' + changeId), audit);
      transaction.create(requestRef, { actor: uid, requestId: request.requestId, requestSha256: hash, createdAt: timestamp(), result });
    }
    return { ...result, replayed: false, dryRun, reads: totalReads, attemptReads: reads, attempts, writes: dryRun ? 0 : writes, plannedWrites: writes };
  }, { maxAttempts: LIMITS.attempts });
}

async function verifySegment(db, get, segment) {
  const dayPath = ROOT + '/days/' + segment.day;
  const day = (await get(db.doc(dayPath))).data();
  check(day?.date === segment.day && integer(day.count, 1) && integer(day.activeChunk) && Number(segment.lastChunk) <= day.activeChunk, 'Recording day is missing or changed.', 'failed-precondition');
  for (const side of ['first', 'last']) {
    const chunk = (await get(db.doc(dayPath + '/chunks/' + segment[side + 'Chunk']))).data();
    check(chunk && Array.isArray(chunk.samples) && chunk.samples.length > 0 && chunk.samples.length <= 32 && integer(chunk.bytes, 1) && chunk.bytes <= 128 * 1024 && bytes(chunk) <= 132 * 1024, 'Recording chunk is missing or invalid.', 'failed-precondition');
    const sample = chunk.samples[segment[side + 'Index']];
    check(sample && sample.id === segment[side + 'SampleId'] && sample.source === segment.source && integer(sample.receivedAt)
      && (sample.eventAt ?? sample.receivedAt) === segment[side + 'At'], 'Recording boundary no longer matches the selected sample.', 'failed-precondition');
    if (segment.source === 'echook-history') check(integer(sample.eventAt), 'Historical boundary has no source timestamp.', 'failed-precondition');
  }
  if (segment.source === 'echook-history') {
    const imported = (await get(db.doc(ROOT + '/imports/' + segment.importId))).data();
    check(imported && imported.day === segment.day && imported.source === segment.source && imported.status === 'complete'
      && id(imported.carId) && segment.importId === 'echook-' + imported.carId + '-' + segment.day
      && typeof imported.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(imported.sourceSha256) && integer(imported.count, 1) && imported.count === imported.expectedCount
      && imported.count === day.count && imported.chunkCount === day.activeChunk + 1 && imported.nextChunk === imported.chunkCount
      && integer(imported.firstAt) && integer(imported.lastAt) && imported.firstAt <= segment.firstAt && imported.lastAt >= segment.lastAt,
    'Historical import provenance is missing, incomplete or changed.', 'failed-precondition');
  }
}

module.exports = { ROOT, LIMITS, TYPES, SESSION_TYPES, STATUSES, MetadataError, validateRequest, editMetadata };
