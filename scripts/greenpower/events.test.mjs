import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { ROOT, MetadataError, validateRequest, editMetadata, adminAuth, options, event, eventChange,
  request, recording, session, sessionChange, memoryDb, readEvent, readSession } from './eventFixtures.mjs';
const day = '2026-06-14';
const change = (revision = 0, data = event()) => eventChange(day, revision, data);
const run = (segments = [recording().segment()], type = 'practice') => ({ ...session(day, segments), type });
const rejects = (promise, code) => assert.rejects(promise, error => error instanceof MetadataError && error.code === code);

test('only a signed-in admin can edit or replay, including dry-run', async () => {
  const db = memoryDb(recording().records), input = request('auth', [change()]);
  for (const auth of [undefined, null, { uid: '' }]) await rejects(editMetadata(db, auth, input, options), 'unauthenticated');
  for (const token of [{}, { perrinnAdmin: 'true' }, { admin: true }, { perrinnAdmin: false }])
    await rejects(editMetadata(db, { uid: 'ordinary', token }, input, { ...options, dryRun: true }), 'permission-denied');
  assert.equal(db.counts.reads, 0);
  await editMetadata(db, adminAuth, input, options);
  await rejects(editMetadata(db, { uid: adminAuth.uid, token: {} }, input, options), 'permission-denied');
});

test('one event ID per recorded UK day; missing recordings and movable dates are refused', async () => {
  const db = memoryDb(recording().records);
  await rejects(editMetadata(db, adminAuth, request('random-id', [eventChange('another-event')]), options), 'invalid-argument');
  await rejects(editMetadata(memoryDb(), adminAuth, request('missing', [change()]), options), 'failed-precondition');
  const data = { ...event('Goodwood'), location: 'Goodwood  Circuit', engineering: { energy: { value: 250, unit: 'Wh' } } };
  const result = await editMetadata(db, adminAuth, request('create', [change(0, data)]), options);
  assert.equal(result.writes, 3); assert.equal(result.reads, 3);
  assert.equal(readEvent(db, day).sessionCount, 0); assert.equal(readEvent(db, day).locationKey, 'goodwood circuit');
  await rejects(editMetadata(db, adminAuth, request('duplicate', [change()]), options), 'failed-precondition');
  await rejects(editMetadata(db, adminAuth, request('move-date', [change(1, { ...data, date: '2026-06-15' })]), options), 'invalid-argument');
  const audit = db.records.get(ROOT + '/metadataChanges/' + result.changeId);
  assert.equal(audit.records.events[day].before, null); assert.deepEqual(audit.records.events[day].after, readEvent(db, day));
});

test('invalid metadata, types and all byte/record budgets reject without reads', async () => {
  const db = memoryDb();
  for (const update of [{ notes: '' }, { date: '2026-02-30' }, { localTime: '24:00' }, { timeZone: 'UTC' },
    { sessionCount: 99 }, { updatedBy: 'other' }, { type: 'membership' }, { engineering: { carMass: { value: 67, unit: 'lb' } } },
    { engineering: { batteryTemperature: { value: -274, unit: '°C' } } }, { tags: ['same', 'same'] }]) {
    assert.throws(() => validateRequest(request('invalid', [change(0, { ...event(), ...update })])), MetadataError);
  }
  const base = request('limits', [change()]);
  for (const input of [{ ...base, requestId: '../raw' }, { ...base, action: 'delete' },
    { ...base, events: [eventChange('__reserved__')] }, { ...base, events: Array(5).fill(change()) },
    { ...base, sessions: Array.from({ length: 21 }, (_, i) => sessionChange('s' + i, run())) },
    { ...base, sessions: [sessionChange('s', run(undefined, 'unknown'))] },
    { ...base, events: [change(0, { ...event(), notes: 'x'.repeat(128 * 1024) })] }])
    await rejects(editMetadata(db, adminAuth, input, options), 'invalid-argument');
  assert.equal(db.counts.reads, 0); assert.equal(db.counts.writes, 0);
});

test('two typed sessions share a chunk without rewriting any recording data', async () => {
  const rec = recording(), db = memoryDb(rec.records), before = structuredClone(rec.records);
  const input = request('two', [change()], [sessionChange('practice', run([rec.segment(0, 1)])), sessionChange('race', run([rec.segment(2, 3)], 'race'))]);
  const result = await editMetadata(db, adminAuth, input, options);
  assert.equal(readEvent(db, day).sessionCount, 2); assert.equal(readSession(db, 'race').type, 'race');
  assert.equal(result.reads, 7); assert.equal(result.writes, 5);
  for (const [path, data] of before) assert.deepEqual(db.records.get(path), data);
});

test('sessions reject UK-midnight crossings, wrong event days and reassignment', async () => {
  const a = recording('2026-07-01', '424-phone', Date.parse('2026-07-01T22:59:56Z'));
  const b = recording('2026-07-02', '424-phone', Date.parse('2026-07-01T23:00:00Z'));
  const db = memoryDb([...a.records, ...b.records]);
  const eventData = { ...event(), date: '2026-07-01' };
  const events = [eventChange('2026-07-01', 0, eventData)];
  for (const segments of [[a.segment(), b.segment()], [b.segment()]])
    await rejects(editMetadata(db, adminAuth, request('cross', events, [sessionChange('s', { ...session('2026-07-01', segments), type: 'race' })]), options), 'invalid-argument');
  assert.equal(db.counts.writes, 0);
  await rejects(editMetadata(db, adminAuth, request('split', events, [], 'split'), options), 'invalid-argument');
});

test('missing or changed boundary samples and incomplete imports fail atomically', async () => {
  const rec = recording();
  for (const mutate of [records => records.delete(rec.records[1][0]), records => { records.get(rec.records[1][0]).samples[0].id = 'changed'; },
    records => { records.get(rec.records[2][0]).status = 'importing'; }, records => { records.get(rec.records[0][0]).activeChunk = -1; }]) {
    const db = memoryDb(rec.records); mutate(db.records);
    await rejects(editMetadata(db, adminAuth, request('missing', [change()], [sessionChange('s', run())]), options), 'failed-precondition');
    assert.equal(db.counts.writes, 0);
  }
});

test('idempotent replay, stale revisions and failed commits never duplicate counters or audit records', async () => {
  const rec = recording(), input = request('atomic', [change()], [sessionChange('s', run())]), db = memoryDb(rec.records);
  const dry = await editMetadata(db, adminAuth, input, { ...options, dryRun: true }); assert.equal(dry.writes, 0); assert.equal(dry.plannedWrites, 4);
  await editMetadata(db, adminAuth, input, options); const writes = db.counts.writes;
  const replay = await editMetadata(db, adminAuth, input, options); assert.equal(replay.reads, 1); assert.equal(replay.writes, 0);
  await rejects(editMetadata(db, adminAuth, { ...input, sessions: [] }, options), 'already-exists');
  await rejects(editMetadata(db, adminAuth, request('stale', [change()]), options), 'failed-precondition');
  assert.equal(db.counts.writes, writes);
  const failed = memoryDb(rec.records, { failCommit: true });
  await assert.rejects(editMetadata(failed, adminAuth, input, options), /synthetic commit failure/); assert.equal(failed.counts.writes, 0);
  const retry = memoryDb(rec.records, { retryOnce: true });
  const result = await editMetadata(retry, adminAuth, input, options); assert.equal(result.reads, 12); assert.equal(result.attempts, 2); assert.equal(retry.counts.writes, 4);
});

test('twenty same-day sessions retain explicit total work and never scan collections', async () => {
  const rec = recording(), db = memoryDb(rec.records);
  const result = await editMetadata(db, adminAuth, request('budget', [change()], Array.from({ length: 20 }, (_, i) => sessionChange('s' + i, run()))), options);
  assert.equal(result.reads, 25); assert.equal(result.writes, 23); assert.equal(db.counts.rpcs, 3);
});

test('callable converts expected errors and hides private provider details', async () => {
  const require = createRequire(import.meta.url), exported = {}, state = {};
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const db = memoryDb(recording().records, { failCommit: true });
  runInNewContext(readFileSync(new URL('../../functions/greenpowerEvents.f.js', import.meta.url), 'utf8'), { exports: exported, require(name) {
    if (name === 'firebase-functions/v2/https') return { HttpsError, onCall(config, handler) { state.config = config; return handler; } };
    if (name === 'firebase-admin') return { firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: options.timestamp } }) };
    return require('../../functions/utils/greenpowerEvents.js');
  } });
  assert.equal(state.config.maxInstances, 2);
  await assert.rejects(exported.greenpowerEventEdit({ auth: null, data: {} }), error => error.code === 'unauthenticated');
  await assert.rejects(exported.greenpowerEventEdit({ auth: adminAuth, data: request('fail', [change()]) }), error => error.code === 'internal' && !error.message.includes('private provider'));
});
