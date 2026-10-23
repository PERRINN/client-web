const { createHash } = require('node:crypto');
const { MetadataError, verifySegment, londonDay } = require('./greenpowerEvents');
const ROOT = 'GreenpowerTelemetry/424';
const TYPES = ['race', 'practice', 'battery_dyno', 'motor_dyno'];
const MAX_BYTES = 8 * 1024;
function check(ok, message, code = 'invalid-argument') { if (!ok) throw new MetadataError(code, message); }
function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function keys(value, allowed, required = allowed) { check(object(value) && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key)), 'Invalid metadata fields.'); }
function id(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !/^__.*__$/.test(value); }
function date(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
function text(value, max, empty = false) { return typeof value === 'string' && (empty || value.length > 0) && value === value.trim() && Buffer.byteLength(value) <= max; }
function canonical(value) { return JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item))) : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])) : value); }
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
function validateSessionTypeCounts(value) {
  keys(value, TYPES, []);
  check(Object.values(value).every(count => Number.isSafeInteger(count) && count > 0), 'Invalid session counts.', 'failed-precondition');
  return value;
}
function defaults(value) {
  keys(value, ['driver', 'motorGearTeeth', 'wheelGearTeeth', 'motorId', 'generatorId', 'carMassKg', 'driverMassKg'], []);
  for (const [key, item] of Object.entries(value)) {
    if (['driver', 'motorId', 'generatorId'].includes(key)) check(text(item, 120), 'Invalid identifier.');
    else check(typeof item === 'number' && Number.isFinite(item) && item > 0 && (!key.endsWith('Teeth') || Number.isSafeInteger(item)), 'Invalid mass or gear teeth.');
  }
}
function validRange(range, day) {
  keys(range, ['day', 'source', 'importId', 'firstChunk', 'lastChunk', 'firstIndex', 'lastIndex', 'firstSampleId', 'lastSampleId', 'firstAt', 'lastAt'],
    ['day', 'source', 'firstChunk', 'lastChunk', 'firstIndex', 'lastIndex', 'firstSampleId', 'lastSampleId', 'firstAt', 'lastAt']);
  check(range.day === day && ['424-phone', 'echook-history'].includes(range.source), 'Invalid range source or day.');
  check([range.firstChunk, range.lastChunk].every(value => typeof value === 'string' && /^\d{10}$/.test(value)) && range.firstChunk <= range.lastChunk, 'Invalid chunk boundaries.');
  check([range.firstIndex, range.lastIndex].every(value => Number.isInteger(value) && value >= 0 && value < 32)
    && (range.firstChunk !== range.lastChunk || range.firstIndex <= range.lastIndex), 'Invalid sample positions.');
  check([range.firstSampleId, range.lastSampleId].every(value => text(value, 200)) && [range.firstAt, range.lastAt].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000) && range.firstAt <= range.lastAt, 'Invalid sample boundaries.');
  check(londonDay(range.firstAt) === day && londonDay(range.lastAt) === day, 'Session boundaries must stay within the UK day.');
  check(range.source === 'echook-history' ? id(range.importId) : range.importId === undefined, 'Invalid import reference.');
}
function validateDay(data) {
  keys(data, ['date', 'eventName', 'trackId', 'result', 'defaults', 'wheelCircumferenceM'], ['date', 'eventName', 'trackId', 'result', 'defaults']);
  check(data.wheelCircumferenceM === undefined || typeof data.wheelCircumferenceM === 'number'
    && Number.isFinite(data.wheelCircumferenceM) && data.wheelCircumferenceM > 0, 'Invalid wheel circumference.');
  check(date(data.date) && text(data.eventName, 120, true) && text(data.result, 120, true) && (data.trackId === null || typeof data.trackId === 'string' && data.trackId.length > 0 && data.trackId.length <= 128 && !data.trackId.includes('/')), 'Invalid event.');
  defaults(data.defaults);
  check(Buffer.byteLength(JSON.stringify(data)) <= MAX_BYTES - 512, 'Event exceeds 8 KiB.');
  return data;
}
function validateSession(session, day) {
  keys(session, ['id', 'type', 'startAt', 'endAt', 'batteryIds', 'overrides', 'ranges']);
  check(id(session.id) && TYPES.includes(session.type), 'Invalid session ID or type.');
  check([session.startAt, ...(session.endAt === null ? [] : [session.endAt])].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000) && (session.endAt === null || session.startAt <= session.endAt), 'Invalid session times.');
  defaults(session.overrides);
  check(Array.isArray(session.batteryIds) && session.batteryIds.length <= 8 && new Set(session.batteryIds).size === session.batteryIds.length && session.batteryIds.every(value => text(value, 80)), 'Invalid battery IDs.');
  const ranges = session.ranges;
  check(Array.isArray(ranges) && ranges.length > 0 && ranges.length <= 20, 'Invalid recording ranges.');
  ranges.forEach(range => validRange(range, day));
  const position = (range, side) => range[side + 'Chunk'] + '/' + String(range[side + 'Index']).padStart(2, '0');
  check(ranges.every((range, index) => !index || position(ranges[index - 1], 'last') < position(range, 'first') && ranges[index - 1].lastAt <= range.firstAt), 'Ranges must be ordered and non-overlapping.');
  check(ranges[0].firstAt === session.startAt && (session.endAt === null
    ? ranges.length === 1 && ranges[0].firstChunk === ranges[0].lastChunk && ranges[0].firstIndex === ranges[0].lastIndex && ranges[0].lastAt === session.startAt
    : ranges.at(-1).lastAt === session.endAt), 'Session times must match recording boundaries.');
  check(Buffer.byteLength(JSON.stringify(session)) <= 16 * 1024 - 512, 'Session exceeds 16 KiB.');
  return session;
}
function emptyDay(day, timestamp) {
  return { date: day, eventName: '', trackId: null, result: '', defaults: {}, wheelCircumferenceM: 1.29, sessionTypeCounts: {},
    schemaVersion: 2, revision: 0, updatedBy: 'ingestion', updatedAt: timestamp() };
}
async function deleteDaySession(db, auth, input, { timestamp, dryRun }) {
  keys(input, ['schemaVersion', 'requestId', 'date', 'expectedRevision', 'kind', 'expectedSessionRevision', 'sessionId']);
  check(input.schemaVersion === 2 && id(input.requestId) && date(input.date) && id(input.sessionId)
    && Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 0
    && Number.isSafeInteger(input.expectedSessionRevision) && input.expectedSessionRevision > 0, 'Invalid deletion request.');
  const checksum = hash(input), changeId = hash([auth.uid, input.requestId]);
  const dayRef = db.doc(ROOT + '/days/' + input.date), sessionRef = db.doc(dayRef.path + '/sessions/' + input.sessionId);
  const requestRef = db.doc(ROOT + '/metadataRequests/' + changeId);
  return db.runTransaction(async transaction => {
    const replay = (await transaction.get(requestRef)).data();
    if (replay) {
      check(replay.actor === auth.uid && replay.requestSha256 === checksum, 'Request ID already used.', 'already-exists');
      return { ...replay.result, replayed: true, writes: 0, reads: 1 };
    }
    const [daySnapshot, sessionSnapshot] = await transaction.getAll(dayRef, sessionRef);
    const before = daySnapshot.data(), session = sessionSnapshot.data();
    check(before?.schemaVersion === 2 && before.revision === input.expectedRevision, 'Metadata changed. Reload before deleting.', 'failed-precondition');
    check(session, 'Session is unavailable.', 'not-found');
    check(session.schemaVersion === 2 && session.telemetryRoot === ROOT && session.id === input.sessionId
      && session.revision === input.expectedSessionRevision && TYPES.includes(session.type), 'Session changed. Reload before deleting.', 'failed-precondition');
    check(before.sessionTypeCounts !== undefined, 'Session counts need initialisation.', 'failed-precondition');
    const counts = { ...validateSessionTypeCounts(before.sessionTypeCounts) };
    check(counts[session.type] > 0, 'Session counts need repair.', 'failed-precondition');
    if (--counts[session.type] === 0) delete counts[session.type];
    const after = { ...before, sessionTypeCounts: counts };
    const result = { date: input.date, revision: before.revision, deletedSessionId: input.sessionId, sessionTypeCounts: counts, changeId };
    if (!dryRun) {
      transaction.delete(sessionRef);
      transaction.set(dayRef, after);
      transaction.create(db.doc(ROOT + '/metadataChanges/' + changeId), {
        actor: auth.uid, action: 'delete-session', requestId: input.requestId, requestSha256: checksum, createdAt: timestamp(),
        records: { sessions: { [sessionRef.path]: { before: session, after: null } }, days: { [dayRef.path]: { before, after } } }
      });
      transaction.create(requestRef, { actor: auth.uid, requestSha256: checksum, result, createdAt: timestamp() });
    }
    return { ...result, reads: 3, writes: dryRun ? 0 : 4 };
  }, { maxAttempts: 3 });
}
async function editDayMetadata(db, auth, input, { timestamp, dryRun = false } = {}) {
  check(auth && text(auth.uid, 128), 'Sign in.', 'unauthenticated');
  check(auth.token?.perrinnAdmin === true, 'Admin permission required.', 'permission-denied');
  check(object(input), 'Invalid edit request.');
  check(Buffer.byteLength(JSON.stringify(input)) <= 128 * 1024, 'Request exceeds limit.');
  if (input.kind === 'delete-session') return deleteDaySession(db, auth, input, { timestamp, dryRun });
  check(['event', 'session'].includes(input.kind), 'Choose event or session edit.');
  keys(input, input.kind === 'event' ? ['schemaVersion', 'requestId', 'date', 'expectedRevision', 'kind', 'data']
    : ['schemaVersion', 'requestId', 'date', 'expectedRevision', 'kind', 'expectedSessionRevision', 'session']);
  check(input.schemaVersion === 2 && id(input.requestId) && date(input.date) && Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 0 && input.expectedRevision < Number.MAX_SAFE_INTEGER, 'Invalid edit request.');
  if (input.kind === 'event') { validateDay(input.data); check(input.data.date === input.date, 'The recorded day cannot change.'); }
  else {
    check(Number.isSafeInteger(input.expectedSessionRevision) && input.expectedSessionRevision >= 0 && input.expectedSessionRevision < Number.MAX_SAFE_INTEGER, 'Invalid session revision.');
    validateSession(input.session, input.date);
  }
  const checksum = hash(input), changeId = hash([auth.uid, input.requestId]);
  const dayRef = db.doc(ROOT + '/days/' + input.date), requestRef = db.doc(ROOT + '/metadataRequests/' + changeId);
  return db.runTransaction(async transaction => {
    let reads = 0;
    const cache = new Map();
    const get = async ref => {
      if (!cache.has(ref.path)) { check(++reads <= 105, 'Read budget exceeded.', 'resource-exhausted'); cache.set(ref.path, await transaction.get(ref)); }
      return cache.get(ref.path);
    };
    const preload = async refs => {
      const missing = [...new Map(refs.filter(ref => !cache.has(ref.path)).map(ref => [ref.path, ref])).values()];
      if (!missing.length) return;
      check(reads + missing.length <= 105, 'Read budget exceeded.', 'resource-exhausted');
      reads += missing.length;
      const snapshots = await transaction.getAll(...missing);
      snapshots.forEach(snapshot => cache.set(snapshot.ref.path, snapshot));
    };
    const replay = (await get(requestRef)).data();
    if (replay) { check(replay.actor === auth.uid && replay.requestSha256 === checksum, 'Request ID already used.', 'already-exists'); return { ...replay.result, replayed: true, writes: 0, reads }; }
    const trackId = input.kind === 'event' ? input.data.trackId : null;
    const sessionRef = input.kind === 'session' ? db.doc(dayRef.path + '/sessions/' + input.session.id) : undefined;
    await preload([dayRef, db.doc(dayRef.path + '/live/latest'), ...(trackId ? [db.doc(ROOT + '/tracks/' + trackId)] : []), ...(sessionRef ? [sessionRef] : [])]);
    const before = (await get(dayRef)).data();
    check(before?.schemaVersion === 2 && before.revision === input.expectedRevision, 'Metadata changed or requires migration.', 'failed-precondition');
    const live = (await get(db.doc(dayRef.path + '/live/latest'))).data();
    check(live && Number.isSafeInteger(live.count) && live.count > 0, 'Recorded day is unavailable.', 'failed-precondition');
    if (trackId) check((await get(db.doc(ROOT + '/tracks/' + trackId))).data(), 'Track is unavailable.', 'failed-precondition');
    const previousSession = sessionRef ? (await get(sessionRef)).data() : undefined;
    if (previousSession) check(previousSession.schemaVersion === 2 && previousSession.telemetryRoot === ROOT && previousSession.id === input.session.id && Number.isSafeInteger(previousSession.revision) && previousSession.revision > 0, 'Stored session is invalid.', 'failed-precondition');
    if (sessionRef) check((previousSession?.revision || 0) === input.expectedSessionRevision, 'Session changed. Reload before saving.', 'failed-precondition');
    if (sessionRef && input.session.endAt === null) {
      // One indexed, bounded query; transaction isolation prevents concurrent open sessions.
      const open = await transaction.get(db.collection(dayRef.path + '/sessions').where('endAt', '==', null).limit(2));
      reads += Math.max(1, open.size);
      check(reads <= 105, 'Read budget exceeded.', 'resource-exhausted');
      check(open.docs.every(doc => doc.id === input.session.id), 'Close the open session before opening another.', 'failed-precondition');
    }
    let sessionTypeCounts = before.sessionTypeCounts;
    if (sessionTypeCounts !== undefined) validateSessionTypeCounts(sessionTypeCounts);
    const countsChanged = !!sessionRef && previousSession?.type !== input.session.type;
    if (sessionRef) {
      check(sessionTypeCounts !== undefined, 'Session counts need initialisation before editing sessions.', 'failed-precondition');
      sessionTypeCounts = { ...sessionTypeCounts };
      if (countsChanged) {
        if (previousSession) {
          check(TYPES.includes(previousSession.type) && sessionTypeCounts[previousSession.type] > 0, 'Session counts need repair.', 'failed-precondition');
          if (--sessionTypeCounts[previousSession.type] === 0) delete sessionTypeCounts[previousSession.type];
        }
        sessionTypeCounts[input.session.type] = (sessionTypeCounts[input.session.type] || 0) + 1;
        validateSessionTypeCounts(sessionTypeCounts);
      }
    }
    const ranges = input.kind === 'session' && canonical(input.session.ranges) !== canonical(previousSession?.ranges || []) ? input.session.ranges : [];
    await preload(ranges.flatMap(range => [db.doc(dayRef.path + '/chunks/' + range.firstChunk), db.doc(dayRef.path + '/chunks/' + range.lastChunk),
      ...(range.importId ? [db.doc(ROOT + '/imports/' + range.importId)] : [])]));
    for (const range of ranges) await verifySegment(db, get, range);
    const after = input.kind === 'event'
      ? { ...input.data, wheelCircumferenceM: input.data.wheelCircumferenceM ?? before.wheelCircumferenceM ?? 1.29, ...(sessionTypeCounts === undefined ? {} : { sessionTypeCounts }), schemaVersion: 2, revision: before.revision + 1, updatedBy: auth.uid, updatedAt: timestamp() }
      : { ...input.session, telemetryRoot: ROOT, schemaVersion: 2, revision: input.expectedSessionRevision + 1, updatedBy: auth.uid, updatedAt: timestamp() };
    check(Buffer.byteLength(JSON.stringify(after)) <= (sessionRef ? 16 * 1024 : MAX_BYTES), 'Metadata exceeds its size limit.');
    const target = sessionRef || dayRef;
    const result = { date: input.date, revision: sessionRef ? before.revision : after.revision, changeId,
      ...(sessionTypeCounts === undefined ? {} : { sessionTypeCounts }),
      ...(sessionRef ? { sessionId: input.session.id, sessionRevision: after.revision } : {}) };
    const records = { [sessionRef ? 'sessions' : 'days']: { [target.path]: { before: (sessionRef ? previousSession : before) || null, after } } };
    const parentAfter = countsChanged ? { ...before, sessionTypeCounts } : undefined;
    if (parentAfter) {
      check(Buffer.byteLength(JSON.stringify(parentAfter)) <= MAX_BYTES, 'Event exceeds 8 KiB.');
      records.days = { [dayRef.path]: { before, after: parentAfter } };
    }
    if (!dryRun) {
      transaction.set(target, after);
      if (parentAfter) transaction.set(dayRef, parentAfter);
      transaction.create(db.doc(ROOT + '/metadataChanges/' + changeId), { actor: auth.uid, action: sessionRef ? 'edit-session' : 'edit-day', requestId: input.requestId,
        requestSha256: checksum, createdAt: timestamp(), records });
      transaction.create(requestRef, { actor: auth.uid, requestSha256: checksum, result, createdAt: timestamp() });
    }
    return { ...result, reads, writes: dryRun ? 0 : countsChanged ? 4 : 3 };
  }, { maxAttempts: 3 });
}
module.exports = { validateDay, validateSession, validateSessionTypeCounts, emptyDay, editDayMetadata, hash, canonical, ROOT, TYPES };
