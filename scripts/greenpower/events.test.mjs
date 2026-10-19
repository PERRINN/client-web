import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { ROOT, LIMITS, MetadataError, validateRequest, editMetadata, adminAuth, options, event, eventChange,
  request, recording, session, sessionChange, memoryDb, readEvent, readSession } from './eventFixtures.mjs';
const rejects = (promise, code) => assert.rejects(promise, error => error instanceof MetadataError && error.code === code);

test('only a real signed-in admin can edit, including replay and dry-run', async () => {
  const db = memoryDb(), input = request('auth', [eventChange('event')]);
  for (const auth of [undefined, null, { uid: '' }]) await rejects(editMetadata(db, auth, input, options), 'unauthenticated');
  for (const token of [{}, { perrinnAdmin: 'true' }, { admin: true }, { perrinnAdmin: false }]) {
    await rejects(editMetadata(db, { uid: 'ordinary', token }, input, { ...options, dryRun: true }), 'permission-denied');
  }
  assert.deepEqual(db.counts, { reads: 0, writes: 0, attempts: 0, rpcs: 0 });
  await editMetadata(db, adminAuth, input, options);
  await rejects(editMetadata(db, { uid: 'test-admin', token: {} }, input, options), 'permission-denied');
});

test('events can have no sessions; engineering units, provenance and empty fields are validated', async () => {
  const db = memoryDb();
  const data = { ...event('Goodwood finals'), location: 'Goodwood  Circuit', tags: ['finals'],
    engineering: { energy: { value: 250, unit: 'Wh' }, carMass: { value: 67, unit: 'kg' }, batteryIds: ['3', '5'] },
    provenance: [{ kind: 'spreadsheet', sourceKey: 'reviewed-event-1', documentId: 'source-sheet', sheetId: 7, sheetName: 'events', row: 11 }] };
  const result = await editMetadata(db, adminAuth, request('create', [eventChange('goodwood', 0, data)]), options);
  assert.equal(result.writes, 3); assert.equal(result.reads, 2); assert.equal(db.counts.rpcs, 2);
  assert.equal(readEvent(db, 'goodwood').sessionCount, 0);
  assert.equal(readEvent(db, 'goodwood').locationKey, 'goodwood circuit');
  const audit = db.records.get(ROOT + '/metadataChanges/' + result.changeId);
  assert.equal(audit.actor, adminAuth.uid); assert.equal(audit.records.events.goodwood.before, null);
  assert.deepEqual(audit.records.events.goodwood.after, readEvent(db, 'goodwood'));
  for (const change of [{ notes: '' }, { date: '2026-02-30' }, { localTime: '24:00' }, { timeZone: 'UTC' },
    { sessionCount: 99 }, { updatedBy: 'other' }, { type: 'membership' }, { engineering: { carMass: { value: 67, unit: 'lb' } } },
    { engineering: { batteryTemperature: { value: -274, unit: '°C' } } }, { engineering: { energy: { value: Infinity, unit: 'Wh' } } },
    { provenance: [{ kind: 'spreadsheet', sourceKey: 'unknown' }] }, { tags: ['same', 'same'] }]) {
    assert.throws(() => validateRequest(request('invalid', [eventChange('x', 0, { ...event(), ...change })])), MetadataError);
  }
});

test('record IDs and all action/record/segment/byte budgets reject before data access', async () => {
  const db = memoryDb(), base = request('limits', [eventChange('one')]);
  const rec = recording(), data = session('one', [rec.segment()]);
  const invalid = [
    { ...base, requestId: '../raw' }, { ...base, action: 'delete' }, { ...base, events: [eventChange('../days')] },
    { ...base, events: [eventChange('__reserved__')] }, { ...base, events: [eventChange('one', Number.MAX_SAFE_INTEGER)] },
    { ...base, events: Array.from({ length: 5 }, (_, i) => eventChange('e' + i)) },
    { ...base, sessions: Array.from({ length: 21 }, (_, i) => sessionChange('s' + i, data)) },
    { ...base, events: [eventChange('one'), eventChange('one')] },
    { ...base, sessions: [sessionChange('one', { ...data, segments: Array(21).fill(rec.segment()) })] },
    { ...base, sessions: [sessionChange('one', { ...data, firstAt: -1 })] },
    { ...base, sessions: [sessionChange('one', session('one', [{ ...rec.segment(), lastAt: Number.MAX_SAFE_INTEGER }]))] },
    { ...base, events: [eventChange('one', 0, { ...event(), notes: 'x'.repeat(128 * 1024) })] },
    { ...base, events: [eventChange('one', 0, { ...event(), description: 'a'.repeat(2000), notes: 'a'.repeat(4000),
      tags: Array.from({ length: 16 }, (_, i) => (i + '€'.repeat(12))), engineering: { purpose: 'a'.repeat(500), outcome: 'a'.repeat(500), batteryIds: Array.from({ length: 8 }, (_, i) => i + 'a'.repeat(79)) } })] },
  ];
  for (const input of invalid) await rejects(editMetadata(db, adminAuth, input, options), 'invalid-argument');
  assert.equal(db.counts.reads, 0); assert.equal(db.counts.writes, 0);
});

test('two distinct same-day runs share a chunk without rewriting samples', async () => {
  const rec = recording(), db = memoryDb(rec.records), before = structuredClone(rec.records);
  const input = request('two-runs', [eventChange('dyno')], [sessionChange('run-1', session('dyno', [rec.segment(0, 1)])), sessionChange('run-2', session('dyno', [rec.segment(2, 3)], 'Run 2'))]);
  const result = await editMetadata(db, adminAuth, input, options);
  assert.equal(readEvent(db, 'dyno').sessionCount, 2); assert.equal(readSession(db, 'run-1').lastAt, rec.samples[1].eventAt);
  assert.equal(readSession(db, 'run-2').firstAt, rec.samples[2].eventAt);
  assert.equal(result.reads, 7); assert.equal(result.writes, 5); assert.equal(db.counts.rpcs, 3);
  for (const [path, data] of before) assert.deepEqual(db.records.get(path), data);
});

test('sessions cross UK midnight using separate segments, including equal timestamp positions', async () => {
  const a = recording('2026-07-01', '424-phone', Date.parse('2026-07-01T22:59:56Z'));
  const b = recording('2026-07-02', '424-phone', Date.parse('2026-07-01T23:00:00Z'));
  const db = memoryDb([...a.records, ...b.records]);
  const data = session('night', [a.segment(), b.segment()]);
  await editMetadata(db, adminAuth, request('midnight', [eventChange('night')], [sessionChange('overnight', data)]), options);
  assert.equal(readSession(db, 'overnight').segments.length, 2);
  for (const segments of [[b.segment(), a.segment()], [a.segment(), a.segment()]]) {
    assert.throws(() => validateRequest(request('bad-range', [eventChange('night')], [sessionChange('bad', session('night', segments))])), MetadataError);
  }
  const duplicateTimes = recording(); duplicateTimes.samples[1].eventAt = duplicateTimes.samples[0].eventAt;
  duplicateTimes.records[1][1].samples[1].eventAt = duplicateTimes.samples[0].eventAt;
  const equal = { ...duplicateTimes.segment(0, 1), lastAt: duplicateTimes.samples[0].eventAt };
  const equalDb = memoryDb(duplicateTimes.records);
  await editMetadata(equalDb, adminAuth, request('equal', [eventChange('same')], [sessionChange('equal-times', session('same', [equal]))]), options);
  assert.equal(readSession(equalDb, 'equal-times').segments[0].lastIndex, 1);
});

test('missing chunks, stale boundaries, incomplete imports and forged references leave no metadata', async () => {
  const rec = recording();
  const mutations = [
    records => records.delete(rec.records[1][0]),
    records => { records.get(rec.records[1][0]).samples[0].id = 'changed'; },
    records => { records.get(rec.records[2][0]).status = 'importing'; },
    records => { records.get(rec.records[2][0]).count = 3; },
    records => { records.get(rec.records[0][0]).activeChunk = -1; },
    records => { records.get(rec.records[1][0]).samples[0].source = '424-phone'; },
  ];
  for (const mutate of mutations) {
    const db = memoryDb(rec.records); mutate(db.records);
    await rejects(editMetadata(db, adminAuth, request('missing', [eventChange('event')], [sessionChange('run', session('event', [rec.segment()]))]), options), 'failed-precondition');
    assert.equal(db.counts.writes, 0); assert.equal(readEvent(db, 'event'), undefined);
  }
});

test('idempotent replay skips mutations and rejects a changed manifest or stale revision', async () => {
  const db = memoryDb(), input = request('same-id', [eventChange('b'), eventChange('a')]);
  const created = await editMetadata(db, adminAuth, input, options), writes = db.counts.writes;
  const replay = await editMetadata(db, adminAuth, { sessions: [], events: input.events.toReversed(), action: 'edit', requestId: 'same-id' }, options);
  assert.equal(replay.changeId, created.changeId); assert.equal(replay.replayed, true); assert.equal(replay.reads, 1); assert.equal(replay.writes, 0);
  assert.equal(db.counts.writes, writes);
  await rejects(editMetadata(db, adminAuth, request('same-id', [eventChange('a', 0, event('different'))]), options), 'already-exists');
  await rejects(editMetadata(db, adminAuth, request('stale', [eventChange('a', 0)]), options), 'failed-precondition');
  await rejects(editMetadata(db, { uid: 'other-admin', token: { perrinnAdmin: true } }, input, options), 'failed-precondition');
  assert.equal(db.counts.writes, writes);
});

test('split and merge preserve session IDs, count references and immutable audit history', async () => {
  const rec = recording(), db = memoryDb(rec.records);
  const one = session('original', [rec.segment(0, 1)]), two = session('original', [rec.segment(2, 3)], 'Run 2');
  const first = await editMetadata(db, adminAuth, request('initial', [eventChange('original')], [sessionChange('run-1', one), sessionChange('run-2', two)]), options);
  await editMetadata(db, adminAuth, request('split', [eventChange('original', 1, null), eventChange('new-event')], [sessionChange('run-2', { ...two, eventId: 'new-event' }, 1)], 'split'), options);
  assert.equal(readEvent(db, 'original').sessionCount, 1); assert.equal(readEvent(db, 'new-event').sessionCount, 1);
  assert.equal(readSession(db, 'run-2').revision, 2);
  await rejects(editMetadata(db, adminAuth, request('premature', [eventChange('original', 2, { ...event(), state: 'superseded', supersededBy: ['new-event'] }), eventChange('new-event', 1, null)]), options), 'failed-precondition');
  const merged = await editMetadata(db, adminAuth, request('merge', [eventChange('original', 2, null), eventChange('new-event', 1, { ...event(), state: 'superseded', supersededBy: ['original'] })], [sessionChange('run-2', two, 2)], 'merge'), options);
  assert.equal(readEvent(db, 'original').sessionCount, 2); assert.equal(readEvent(db, 'new-event').sessionCount, 0);
  assert.equal(readEvent(db, 'new-event').state, 'superseded'); assert.equal(readSession(db, 'run-2').eventId, 'original');
  assert.equal(db.records.get(ROOT + '/metadataChanges/' + first.changeId).records.events.original.after.sessionCount, 2);
  const changed = db.records.get(ROOT + '/metadataChanges/' + merged.changeId).records.sessions['run-2'];
  assert.equal(changed.before.eventId, 'new-event'); assert.equal(changed.after.eventId, 'original');
});

test('session moves require declared source/target revisions and explicit action', async () => {
  const rec = recording(), db = memoryDb(rec.records), data = session('a', [rec.segment()]);
  await editMetadata(db, adminAuth, request('create', [eventChange('a'), eventChange('b')], [sessionChange('s', data)]), options);
  const moved = sessionChange('s', { ...data, eventId: 'b' }, 1);
  await rejects(editMetadata(db, adminAuth, request('missing-source', [eventChange('b', 1, null)], [moved], 'reassign'), options), 'failed-precondition');
  await rejects(editMetadata(db, adminAuth, request('implicit', [eventChange('a', 1, null), eventChange('b', 1, null)], [moved]), options), 'invalid-argument');
  await rejects(editMetadata(db, adminAuth, request('no-move', [eventChange('a', 1, null)], [], 'merge'), options), 'invalid-argument');
  assert.equal(readSession(db, 's').eventId, 'a');
});

test('dry-run is zero-write; transaction failure and retries remain atomic', async () => {
  const rec = recording(), input = request('atomic', [eventChange('event')], [sessionChange('s', session('event', [rec.segment()]))]);
  const db = memoryDb(rec.records);
  const dryRun = await editMetadata(db, adminAuth, input, { ...options, dryRun: true });
  assert.equal(dryRun.writes, 0); assert.equal(dryRun.plannedWrites, 4); assert.equal(db.records.size, rec.records.length);
  const failed = memoryDb(rec.records, { failCommit: true });
  await assert.rejects(editMetadata(failed, adminAuth, input, options), /synthetic commit failure/);
  assert.equal(failed.counts.writes, 0); assert.equal(failed.records.size, rec.records.length);
  const retried = memoryDb(rec.records, { retryOnce: true });
  const result = await editMetadata(retried, adminAuth, input, options);
  assert.equal(retried.counts.attempts, 2); assert.equal(retried.counts.writes, 4);
  assert.equal(result.attempts, 2); assert.equal(result.reads, 12); assert.equal(result.attemptReads, 6);
  assert.equal(readEvent(retried, 'event').sessionCount, 1);
});

test('edits use the validated draft snapshot even if the caller changes its draft during reads', async () => {
  const input = request('draft-snapshot', [eventChange('original', 0, event('Reviewed name'))]);
  const db = memoryDb([], { onRead() { input.events[0].data.name = 'Unreviewed later draft'; } });
  await editMetadata(db, adminAuth, input, options);
  assert.equal(readEvent(db, 'original').name, 'Reviewed name');
});

test('twenty distinct segments and four events obey the maximum work budget', async () => {
  const recordings = Array.from({ length: 20 }, (_, i) => recording('2026-06-' + String(i + 1).padStart(2, '0')));
  // Separate first/last chunks exercise every one of the 105 permitted reads.
  for (const r of recordings) {
    r.records[0][1].activeChunk = 1;
    r.records[1][1].samples = r.samples.slice(0, 2);
    r.records.push([r.records[1][0].replace(/0$/, '1'), { samples: r.samples.slice(2), bytes: r.records[1][1].bytes }]);
    r.records[2][1].chunkCount = r.records[2][1].nextChunk = 2;
    const originalSegment = r.segment;
    r.segment = () => ({ ...originalSegment(), lastChunk: '0000000001', lastIndex: 1 });
  }
  const db = memoryDb(recordings.flatMap(r => r.records));
  const input = request('budget', ['a', 'b', 'c', 'd'].map(e => eventChange(e)), recordings.map((r, i) => sessionChange('s' + i, session('a', [r.segment()]))));
  const result = await editMetadata(db, adminAuth, input, options);
  assert.equal(result.writes, 26); assert.equal(db.counts.rpcs, 3); assert.equal(result.reads, LIMITS.readsPerAttempt);
  const retryDb = memoryDb(recordings.flatMap(r => r.records), { retryOnce: true });
  const retried = await editMetadata(retryDb, adminAuth, input, options);
  assert.equal(retried.reads, 210); assert.equal(retried.attemptReads, 105); assert.equal(retried.attempts, 2);
  assert.equal(readEvent(db, 'a').sessionCount, 20);
  const segments = Array.from({ length: 20 }, (_, i) => recordings[i].segment());
  const over = request('too-many', [eventChange('a')], [sessionChange('s', session('a', segments)), sessionChange('extra', session('a', [recordings[0].segment()]))]);
  assert.throws(() => validateRequest(over), /twenty recording segments total/);
});

test('callable converts expected errors and hides provider details', async () => {
  const require = createRequire(import.meta.url), exported = {}, state = {};
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const source = readFileSync(new URL('../../functions/greenpowerEvents.f.js', import.meta.url), 'utf8');
  const db = memoryDb([], { failCommit: true });
  runInNewContext(source, { exports: exported, require(name) {
    if (name === 'firebase-functions/v2/https') return { HttpsError, onCall(config, handler) { state.config = config; return handler; } };
    if (name === 'firebase-admin') return { firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: options.timestamp } }) };
    return require('../../functions/utils/greenpowerEvents.js');
  } });
  assert.equal(state.config.maxInstances, 2); assert.equal(state.config.timeoutSeconds, 30);
  await assert.rejects(exported.greenpowerEventEdit({ auth: null, data: {} }), e => e.code === 'unauthenticated');
  await assert.rejects(exported.greenpowerEventEdit({ auth: adminAuth, data: request('fail', [eventChange('event')]) }), e => e.code === 'internal' && !e.message.includes('private provider'));
});
