// Explicit trusted operator only. Preparation reads metadata; application never reads or writes chunks.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { withEventOperator } from './eventBackfill.mjs';
const require = createRequire(import.meta.url);
const { validateDay, validateSession, hash, ROOT, TYPES } = require('../../functions/utils/greenpowerDayMetadata');
const MAX_DAYS = 30;
const serialHash = value => hash(JSON.parse(JSON.stringify(value)));
const cleanParent = value => Object.fromEntries(Object.entries(value || {}).filter(([key]) => !['count', 'activeChunk', 'latest', 'updatedAt'].includes(key)));
function check(ok, message) { if (!ok) throw Error(message); }
function date(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
function safeId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !/^__.*__$/.test(value); }
function defaults(source = {}) {
  const engineering = source.engineering || {}, result = {};
  if (source.driver) result.driver = source.driver;
  for (const key of ['motorId', 'generatorId']) if (engineering[key]) result[key] = engineering[key];
  for (const [old, key] of [['carMass', 'carMassKg'], ['driverMass', 'driverMassKg']]) {
    if (engineering[old]) { check(engineering[old].unit === 'kg', 'Review mass units.'); result[key] = engineering[old].value; }
  }
  // A ratio or free-text gear/wheel cannot establish two teeth counts.
  return result;
}
export const bounds = { days: 30, eventQueries: 30, eventQueryLimit: 3, sessionQueries: 90, sessionQueryLimit: 21,
  targetSessionQueries: 30, targetSessionQueryLimit: 1, maximumPrepareDocuments: 2130, maximumApplyReadsPerAttempt: 48, attempts: 3, maximumApplyReads: 4320,
  maximumWrites: 720, concurrency: 1, automaticApplicationRetries: 0, chunkReads: 0, chunkWrites: 0 };
export async function prepareMetadataMigration(db, review) {
  check(review?.version === 2 && review.projectId === 'perrinn-d5fc1' && Array.isArray(review.days) && review.days.length > 0 && review.days.length <= MAX_DAYS, 'Review must explicitly name 1–30 recorded days.');
  check(new Set(review.days.map(item => item.date)).size === review.days.length, 'Duplicate days.');
  const plan = { version: 2, projectId: review.projectId, scope: 'day-session-subcollections', records: [], bounds };
  for (const item of review.days) {
    check(date(item.date) && (item.trackId === null || typeof item.trackId === 'string' && item.trackId.length > 0 && item.trackId.length <= 128 && !item.trackId.includes('/')), 'Each reviewed day needs a date and explicit trackId or null.');
    const path = ROOT + '/days/' + item.date;
    const [parentSnapshot, liveSnapshot, trackSelectionSnapshot] = await db.getAll(db.doc(path), db.doc(path + '/live/latest'), db.doc(path + '/config/track'));
    const trackSelection = trackSelectionSnapshot.data();
    if (trackSelection?.trackId && trackSelection.trackId !== item.trackId) check(item.trackChangeConfirmed === true, 'Review the existing map track before changing it: ' + item.date);
    const parent = parentSnapshot.data();
    check(parent && parent.date === item.date && parent.schemaVersion !== 2 && Number.isSafeInteger(parent.count) && parent.count > 0 && Number.isSafeInteger(parent.activeChunk) && parent.activeChunk >= 0 && parent.latest, 'Missing, migrated or malformed day: ' + item.date);
    check(!liveSnapshot.data(), 'Unexpected live state: ' + item.date);
    check((await db.collection(path + '/sessions').limit(1).get()).size === 0, 'Target sessions already exist: ' + item.date);
    const metadata = await db.collection(ROOT + '/events').where('date', '==', item.date).limit(3).get();
    check(metadata.size < 3, 'Crowded metadata needs explicit review: ' + item.date);
    const sourceRecords = Object.fromEntries(metadata.docs.map(doc => [doc.ref.path, JSON.parse(JSON.stringify(doc.data()))]));
    sourceRecords[path + '/config/track'] = trackSelection ? JSON.parse(JSON.stringify(trackSelection)) : null;
    if (!metadata.docs.some(doc => doc.id === item.date)) sourceRecords[ROOT + '/events/' + item.date] = null;
    const active = metadata.docs.filter(doc => doc.data().state === 'active');
    const canonical = active.find(doc => doc.id === item.date);
    check(canonical || active.length <= 1, 'Ambiguous event metadata: ' + item.date);
    const source = (canonical || active[0])?.data() || {};
    if (source.location) check(item.trackId || item.noTrackConfirmed === true, 'Map the historical Track or explicitly confirm no track: ' + item.date);
    if (item.trackId) {
      const track = (await db.doc(ROOT + '/tracks/' + item.trackId).get()).data();
      check(track && typeof track.name === 'string', 'Missing reviewed track.');
    }
    const sessions = new Map();
    for (const eventId of new Set([item.date, ...metadata.docs.map(doc => doc.id)])) {
      const result = await db.collection(ROOT + '/sessions').where('eventId', '==', eventId).limit(21).get();
      check(result.size <= 20, 'Too many sessions; review before migration.');
      result.docs.forEach(doc => sessions.set(doc.id, doc));
    }
    check(sessions.size <= 20, 'More than twenty sessions across source events.');
    for (const doc of metadata.docs) check(doc.data().sessionCount === [...sessions.values()].filter(session => session.data().eventId === doc.id).length, 'Session count mismatch: ' + doc.id);
    const data = { date: item.date, eventName: source.name || '', trackId: item.trackId, result: source.result || '',
      defaults: defaults(source) };
    const plannedSessions = [];
    const warnings = [];
    for (const doc of sessions.values()) {
      const session = doc.data(); sourceRecords[doc.ref.path] = JSON.parse(JSON.stringify(session));
      const type = item.sessionTypes?.[session.type] || session.type;
      check(TYPES.includes(type), 'Review session type ' + session.type + ' for ' + doc.id);
      check(Array.isArray(session.segments) && session.segments.every(range => range.day === item.date), 'Review cross-day session: ' + doc.id);
      plannedSessions.push({ id: doc.id, type, startAt: session.firstAt, endAt: session.lastAt,
        batteryIds: session.engineering?.batteryIds || [], overrides: defaults(session), ranges: session.segments });
      if (session.engineering?.gearingRatio) warnings.push({ session: doc.id, field: 'gearingRatio', action: 'Archived; teeth counts require explicit values.' });
    }
    plannedSessions.sort((a, b) => a.startAt - b.startAt || a.id.localeCompare(b.id));
    if (source.engineering?.gearingRatio) warnings.push({ field: 'gearingRatio', action: 'Archived; teeth counts require explicit values.' });
    if (source.engineering?.batteryIds?.length) warnings.push({ field: 'batteryIds', action: 'Archived event values; session assignments require review.' });
    if (item.teeth) {
      check(Object.keys(item.teeth).every(key => ['motorGearTeeth', 'wheelGearTeeth'].includes(key)), 'Only explicit teeth counts are accepted.');
      Object.assign(data.defaults, item.teeth);
    }
    validateDay(data);
    plannedSessions.forEach(session => validateSession(session, item.date));
    plan.records.push({ date: item.date, expectedParentSha256: serialHash(cleanParent(parent)), sources: sourceRecords, data, sessions: plannedSessions, warnings });
  }
  return plan;
}
export async function applyMetadataMigration(db, auth, plan, { timestamp, dryRun = true, actor } = {}) {
  check(auth?.token?.perrinnAdmin === true && typeof auth.uid === 'string' && auth.uid.length > 0 && Buffer.byteLength(auth.uid) <= 128, 'Trusted admin required.');
  check(plan?.version === 2 && plan.projectId === 'perrinn-d5fc1' && plan.scope === 'day-session-subcollections'
    && Array.isArray(plan.records) && plan.records.length > 0 && plan.records.length <= MAX_DAYS, 'Invalid migration plan.');
  check(new Set(plan.records.map(record => record.date)).size === plan.records.length, 'Duplicate target days.');
  for (const record of plan.records) {
    validateDay(record.data);
    check(Array.isArray(record.sessions) && record.sessions.length <= 20 && new Set(record.sessions.map(session => session.id)).size === record.sessions.length, 'Migrate at most twenty distinct sessions per day per reviewed plan.');
    record.sessions.forEach(session => validateSession(session, record.date));
    check(record.date === record.data.date && /^[a-f0-9]{64}$/.test(record.expectedParentSha256), 'Invalid planned target.');
    const entries = Object.entries(record.sources);
    check(entries.length <= 24 && entries.every(([path]) => path.startsWith(ROOT + '/events/') && safeId(path.slice((ROOT + '/events/').length))
      || path.startsWith(ROOT + '/sessions/') && safeId(path.slice((ROOT + '/sessions/').length))
      || path === ROOT + '/days/' + record.date + '/config/track'), 'Invalid source paths.');
  }
  const planHash = hash(plan), results = [];
  for (const record of plan.records) {
    if (actor) { const current = await actor(); check(current.uid === auth.uid && current.token?.perrinnAdmin === true, 'Operator permission changed.'); }
    const changeId = hash(['day-metadata-migration', auth.uid, planHash, record.date]);
    const result = await db.runTransaction(async tx => {
      const dayRef = db.doc(ROOT + '/days/' + record.date), liveRef = db.doc(dayRef.path + '/live/latest');
      const checkpoint = db.doc(ROOT + '/metadataRequests/' + changeId);
      let reads = 0;
      const get = async ref => { check(++reads <= 48, 'Migration read budget exceeded.'); return (await tx.get(ref)).data(); };
      const previous = await get(checkpoint);
      if (previous) { check(previous.actor === auth.uid && previous.requestSha256 === planHash, 'Checkpoint conflict.'); return { date: record.date, writes: 0, replayed: true, reads }; }
      const before = await get(dayRef), live = await get(liveRef);
      check(before?.schemaVersion !== 2 && before?.date === record.date && serialHash(cleanParent(before)) === record.expectedParentSha256 && !live, 'Destination changed: ' + record.date);
      check(Number.isSafeInteger(before.count) && before.count > 0 && Number.isSafeInteger(before.activeChunk) && before.activeChunk >= 0 && before.latest, 'Invalid live state.');
      for (const [path, source] of Object.entries(record.sources)) check(serialHash(await get(db.doc(path)) || null) === serialHash(source), 'Source changed: ' + path);
      if (record.data.trackId) check(await get(db.doc(ROOT + '/tracks/' + record.data.trackId)), 'Track disappeared.');
      for (const session of record.sessions) check(!await get(db.doc(dayRef.path + '/sessions/' + session.id)), 'Target session already exists.');
      const sessionRecords = Object.fromEntries(record.sessions.map(session => [dayRef.path + '/sessions/' + session.id, { before: null, after: { ...session, telemetryRoot: ROOT, schemaVersion: 2, revision: 1, updatedBy: auth.uid, updatedAt: timestamp() } }]));
      const sessionTypeCounts = {};
      for (const session of record.sessions) sessionTypeCounts[session.type] = (sessionTypeCounts[session.type] || 0) + 1;
      const after = { ...record.data, sessionTypeCounts, schemaVersion: 2, revision: 1, updatedBy: auth.uid, updatedAt: timestamp() };
      const audit = { actor: auth.uid, action: 'migrate-day', requestSha256: planHash, createdAt: timestamp(),
        records: { days: { [record.date]: { before, after } }, sessions: sessionRecords }, migrationSources: record.sources };
      check(Buffer.byteLength(JSON.stringify(audit)) <= 512 * 1024, 'Migration audit exceeds 512 KiB; review source metadata.');
      if (!dryRun) {
        tx.set(liveRef, { date: record.date, count: before.count, activeChunk: before.activeChunk, latest: before.latest, updatedAt: before.updatedAt || timestamp() });
        tx.set(dayRef, after);
        for (const [path, value] of Object.entries(sessionRecords)) tx.create(db.doc(path), value.after);
        tx.create(db.doc(ROOT + '/metadataChanges/' + changeId), audit);
        tx.create(checkpoint, { actor: auth.uid, requestSha256: planHash, createdAt: timestamp(), result: { date: record.date, revision: 1 } });
      }
      return { date: record.date, writes: dryRun ? 0 : 4 + record.sessions.length, reads };
    }, { maxAttempts: 3 });
    results.push(result);
  }
  return { dryRun, planHash, results, writes: results.reduce((sum, result) => sum + result.writes, 0), bounds, chunkReads: 0, chunkWrites: 0 };
}
async function main() {
  const [mode, path, flag, value, reportFlag, reportPath] = process.argv.slice(2);
  if (mode === 'prepare' && flag === '--out' && value && !reportFlag) {
    await withEventOperator(async (db, settings) => {
      await settings.actor();
      const plan = await prepareMetadataMigration(db, JSON.parse(await readFile(path, 'utf8')));
      const text = JSON.stringify(plan, null, 2) + '\n'; await writeFile(value, text);
      console.log(JSON.stringify({ plan: value, sha256: hash(plan), days: plan.records.length, bounds }));
    });
  } else if (mode === 'apply' && flag === '--sha256' && /^[a-f0-9]{64}$/.test(value || '') && reportFlag === '--report' && reportPath) {
    const plan = JSON.parse(await readFile(path, 'utf8')); check(hash(plan) === value, 'Plan checksum mismatch.');
    await withEventOperator(async (db, settings) => {
      const actor = await settings.actor();
      await applyMetadataMigration(db, actor, plan, { timestamp: settings.timestamp });
      const result = await applyMetadataMigration(db, actor, plan, { timestamp: settings.timestamp, dryRun: false, actor: settings.actor });
      await writeFile(reportPath, JSON.stringify(result, null, 2) + '\n');
    });
  } else throw Error('Usage: dayMetadataMigration.mjs prepare REVIEW --out PLAN | apply PLAN --sha256 SHA256 --report REPORT');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
