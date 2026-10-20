import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { memoryDb, recording, adminAuth, options, ROOT } from './eventFixtures.mjs';
import { dayData } from './load.mjs';
const require = createRequire(import.meta.url);
const { emptyDay, validateDay, validateSession, editDayMetadata } = require('../../functions/utils/greenpowerDayMetadata');
function fixture(settings = {}) {
  const rec = recording(), day = '2026-06-14', parent = emptyDay(day, options.timestamp);
  const db = memoryDb([...rec.records, [ROOT + '/days/' + day, parent], [ROOT + '/days/' + day + '/live/latest', { date: day, count: 4, activeChunk: 0 }]], settings);
  const { schemaVersion, revision, updatedBy, updatedAt, sessionTypeCounts, ...data } = parent;
  const request = { schemaVersion: 2, requestId: 'save', date: day, expectedRevision: 0, kind: 'event', data };
  return { rec, db, request, day };
}
test('event metadata saves require admin authorization and exact field allowlists before database reads', async () => {
  for (const auth of [undefined, { uid: 'viewer', token: {} }, { uid: 'viewer', token: { perrinnAdmin: 'true' } }]) {
    const h = fixture(); await assert.rejects(editDayMetadata(h.db, auth, h.request, options), error => ['unauthenticated', 'permission-denied'].includes(error.code)); assert.equal(h.db.counts.reads, 0);
  }
  for (const mutate of [data => data.notes = 'retired', data => data.defaults.motorGearTeeth = 1.5, data => data.defaults.carMassKg = -1,
    data => data.sessionTypeCounts = { race: 9 }, data => data.defaults.unknown = 1, data => data.result = 'x'.repeat(121), data => data.sessions = new Array(21).fill({})]) {
    const h = fixture(); mutate(h.request.data); await assert.rejects(editDayMetadata(h.db, adminAuth, h.request, options), error => error.code === 'invalid-argument'); assert.equal(h.db.counts.reads, 0);
  }
});
test('a metadata-only update has three reads, three writes, preserves chunks, and replays without writes', async () => {
  const paths = [], h = fixture({ onRead: ref => paths.push(ref.path) });
  const before = structuredClone(h.db.records.get(h.rec.records[1][0]));
  h.request.data.defaults = { driver: 'Alex', motorGearTeeth: 12, wheelGearTeeth: 60 };
  const result = await editDayMetadata(h.db, adminAuth, h.request, options);
  assert.equal(result.reads, 3); assert.equal(result.writes, 3); assert.equal(paths.some(path => path.includes('/chunks/')), false);
  assert.deepEqual(h.db.records.get(h.rec.records[1][0]), before);
  const writes = h.db.counts.writes; const replay = await editDayMetadata(h.db, adminAuth, h.request, options);
  assert.equal(replay.replayed, true); assert.equal(h.db.counts.writes, writes);
  h.request.data.eventName = 'Different'; await assert.rejects(editDayMetadata(h.db, adminAuth, h.request, options), error => error.code === 'already-exists');
});
function sessionRequest(h, id = 'race') {
  const range = h.rec.segment();
  return { schemaVersion: 2, kind: 'session', requestId: 'save-' + id, date: h.day, expectedRevision: 0, expectedSessionRevision: 0,
    session: { id, type: 'race', startAt: range.firstAt, endAt: range.lastAt, batteryIds: ['A', 'B'], overrides: { driver: 'Sam' }, ranges: [range] } };
}
test('session creation updates counts atomically while same-type edits leave the parent untouched', async () => {
  const h = fixture(), input = sessionRequest(h), parent = structuredClone(h.db.records.get(ROOT + '/days/' + h.day));
  const result = await editDayMetadata(h.db, adminAuth, input, options);
  assert.equal(result.writes, 4); assert.equal(result.sessionRevision, 1); assert.equal(result.revision, 0);
  assert.deepEqual(h.db.records.get(ROOT + '/days/' + h.day), { ...parent, sessionTypeCounts: { race: 1 } });
  const after = h.db.records.get(ROOT + '/days/' + h.day + '/sessions/race');
  assert.equal(after.telemetryRoot, ROOT); assert.equal(after.revision, 1);
  const changed = { ...input, requestId: 'rename-driver', expectedSessionRevision: 1, session: { ...input.session, overrides: { driver: 'Jamie' } } };
  const update = await editDayMetadata(h.db, adminAuth, changed, options); assert.equal(update.reads, 4); assert.equal(update.writes, 3);
  const bad = structuredClone(changed); bad.requestId = 'wrong-boundary'; bad.expectedSessionRevision = 2; bad.session.ranges[0].firstSampleId = 'wrong';
  const writes = h.db.counts.writes; await assert.rejects(editDayMetadata(h.db, adminAuth, bad, options)); assert.equal(h.db.counts.writes, writes);
});
test('different sessions edit independently, while stale session revisions and changed event defaults conflict', async () => {
  const h = fixture(); const a = sessionRequest(h, 'a'), b = sessionRequest(h, 'b');
  await editDayMetadata(h.db, adminAuth, a, options); await editDayMetadata(h.db, adminAuth, b, options);
  await assert.rejects(editDayMetadata(h.db, adminAuth, { ...a, requestId: 'stale-a' }, options), error => error.code === 'failed-precondition');
  h.request.data.defaults = { driver: 'Alex' }; await editDayMetadata(h.db, adminAuth, h.request, options);
  await assert.rejects(editDayMetadata(h.db, adminAuth, { ...b, requestId: 'stale-parent', expectedSessionRevision: 1 }, options), error => error.code === 'failed-precondition');
  assert.equal(dayData.effectiveDefaults(h.request.data, { overrides: {} }).driver, 'Alex');
  assert.equal(dayData.effectiveDefaults(h.request.data, { overrides: { driver: 'Sam' } }).driver, 'Sam');
});
test('dry-run, stale revisions, missing track references and retry limits cannot partially write', async () => {
  const h = fixture(); const preview = await editDayMetadata(h.db, adminAuth, h.request, { ...options, dryRun: true }); assert.equal(preview.writes, 0);
  h.request.data.trackId = 'missing'; await assert.rejects(editDayMetadata(h.db, adminAuth, h.request, options), error => error.code === 'failed-precondition');
  assert.equal(h.db.counts.writes, 0); h.request.data.trackId = null;
  await editDayMetadata(h.db, adminAuth, h.request, options);
  await assert.rejects(editDayMetadata(h.db, adminAuth, { ...h.request, requestId: 'stale' }, options), error => error.code === 'failed-precondition');
  const retry = fixture({ retryOnce: true }); await editDayMetadata(retry.db, adminAuth, retry.request, options); assert.equal(retry.db.counts.writes, 3); assert.equal(retry.db.counts.attempts, 2);
});
test('session count is not capped by the event; invalid types, extra fields and cross-day endpoints fail before reads', async () => {
  const h = fixture();
  for (let i = 0; i < 31; i++) await editDayMetadata(h.db, adminAuth, sessionRequest(h, 's' + i), options);
  assert.equal([...h.db.records.keys()].filter(path => path.startsWith(ROOT + '/days/' + h.day + '/sessions/')).length, 31);
  assert.equal(h.db.records.get(ROOT + '/days/' + h.day).sessions, undefined);
  for (const mutate of [session => session.type = 'qualifying', session => session.ranges[0].day = '2026-06-15', session => session.ranges[0].firstAt = 0, session => session.telemetryRoot = 'other']) {
    const session = sessionRequest(h).session; mutate(session); assert.throws(() => validateSession(session, h.day));
  }
});
test('teeth overrides derive the ratio without storing it, and existing track IDs remain valid', () => {
  const h = fixture(); h.request.data.trackId = 'existing:track';
  h.request.data.defaults = { motorGearTeeth: 12, wheelGearTeeth: 60 };
  validateDay(h.request.data); assert.equal(dayData.dayMetadataError(h.request.data), '');
  assert.equal(dayData.gearingRatio(h.request.data), 5);
  assert.equal(dayData.gearingRatio(h.request.data, { overrides: { motorGearTeeth: 15 } }), 4);
  assert.equal(dayData.gearingRatio({ ...h.request.data, defaults: {} }), undefined);
});

test('type changes move counts, remove zero entries, preserve event revision and are replay-safe', async () => {
  const h = fixture({ retryOnce: true }), input = sessionRequest(h);
  await editDayMetadata(h.db, adminAuth, input, options);
  const changed = { ...input, requestId: 'change-type', expectedSessionRevision: 1, session: { ...input.session, type: 'practice' } };
  const result = await editDayMetadata(h.db, adminAuth, changed, options);
  assert.equal(result.writes, 4); assert.deepEqual(result.sessionTypeCounts, { practice: 1 });
  const parent = h.db.records.get(ROOT + '/days/' + h.day);
  assert.equal(parent.revision, 0); assert.deepEqual(parent.sessionTypeCounts, { practice: 1 });
  const audit = h.db.records.get(ROOT + '/metadataChanges/' + result.changeId);
  assert.deepEqual(audit.records.days[ROOT + '/days/' + h.day].before.sessionTypeCounts, { race: 1 });
  assert.deepEqual(audit.records.days[ROOT + '/days/' + h.day].after.sessionTypeCounts, { practice: 1 });
  assert.equal((await editDayMetadata(h.db, adminAuth, changed, options)).writes, 0);
  h.request.data.eventName = 'Renamed'; await editDayMetadata(h.db, adminAuth, h.request, options);
  assert.deepEqual(h.db.records.get(ROOT + '/days/' + h.day).sessionTypeCounts, { practice: 1 });
});
test('missing, corrupt, underflowing and overflowing counts cannot produce partial session writes', async () => {
  for (const counts of [undefined, { race: -1 }, { other: 1 }, { race: Number.MAX_SAFE_INTEGER }]) {
    const h = fixture(); h.db.records.get(ROOT + '/days/' + h.day).sessionTypeCounts = counts;
    await assert.rejects(editDayMetadata(h.db, adminAuth, sessionRequest(h), options));
    assert.equal(h.db.counts.writes, 0);
  }
  const h = fixture(), input = sessionRequest(h); await editDayMetadata(h.db, adminAuth, input, options);
  h.db.records.get(ROOT + '/days/' + h.day).sessionTypeCounts = {};
  const writes = h.db.counts.writes;
  await assert.rejects(editDayMetadata(h.db, adminAuth, { ...input, requestId: 'underflow', expectedSessionRevision: 1, session: { ...input.session, type: 'practice' } }, options));
  assert.equal(h.db.counts.writes, writes);
  const legacy = fixture(); delete legacy.db.records.get(ROOT + '/days/' + legacy.day).sessionTypeCounts;
  await editDayMetadata(legacy.db, adminAuth, legacy.request, options);
  assert.equal(legacy.db.records.get(ROOT + '/days/' + legacy.day).sessionTypeCounts, undefined);
});

test('circumference defaults to 1.29, validates before reads, persists edits, audits and replays', async () => {
  const h = fixture();
  assert.equal(emptyDay(h.day, options.timestamp).wheelCircumferenceM, 1.29);
  assert.equal(dayData.emptyDay(h.day).wheelCircumferenceM, 1.29);
  for (const value of [0, -1, null, '1.29', NaN, Infinity]) {
    const bad = fixture(); bad.request.data.wheelCircumferenceM = value;
    assert.ok(dayData.dayMetadataError(bad.request.data));
    await assert.rejects(editDayMetadata(bad.db, adminAuth, bad.request, options), error => error.code === 'invalid-argument');
    assert.equal(bad.db.counts.reads, 0);
  }
  h.request.data.wheelCircumferenceM = 1.35;
  const result = await editDayMetadata(h.db, adminAuth, h.request, options);
  assert.equal(result.reads, 3); assert.equal(result.writes, 3);
  assert.equal(h.db.records.get(ROOT + '/days/' + h.day).wheelCircumferenceM, 1.35);
  const audit = h.db.records.get(ROOT + '/metadataChanges/' + result.changeId).records.days[ROOT + '/days/' + h.day];
  assert.equal(audit.before.wheelCircumferenceM, 1.29); assert.equal(audit.after.wheelCircumferenceM, 1.35);
  assert.equal((await editDayMetadata(h.db, adminAuth, h.request, options)).writes, 0);
  const legacy = { ...h.request, requestId: 'older-client', expectedRevision: 1, data: { ...h.request.data } };
  delete legacy.data.wheelCircumferenceM;
  await editDayMetadata(h.db, adminAuth, legacy, options);
  assert.equal(h.db.records.get(ROOT + '/days/' + h.day).wheelCircumferenceM, 1.35, 'older clients preserve custom circumference');
  const oldEvent = { ...dayData.emptyDay(h.day) }; delete oldEvent.wheelCircumferenceM;
  assert.equal(dayData.validRecordedEvent(oldEvent), true);
  assert.equal(dayData.editableDay(oldEvent).wheelCircumferenceM, 1.29);
  const old = fixture(); delete old.request.data.wheelCircumferenceM;
  delete old.db.records.get(ROOT + '/days/' + old.day).wheelCircumferenceM;
  await editDayMetadata(old.db, adminAuth, old.request, options);
  assert.equal(old.db.records.get(ROOT + '/days/' + old.day).wheelCircumferenceM, 1.29);
});
