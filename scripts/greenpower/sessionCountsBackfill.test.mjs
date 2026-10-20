import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backfillSessionCounts } from './sessionCountsBackfill.mjs';
import { memoryDb, adminAuth, options, ROOT } from './eventFixtures.mjs';
const date = '2026-06-14', path = ROOT + '/days/' + date;
const review = { version: 1, projectId: 'perrinn-d5fc1', dates: [date] };
function fixture(types = []) {
  const db = memoryDb([[path, { date, schemaVersion: 2, revision: 7, eventName: 'Workshop' }], ...types.map((type, index) =>
    [path + '/sessions/s' + index, { type, schemaVersion: 2, telemetryRoot: ROOT }])]);
  db.collection = path => ({ select(...fields) {
    assert.deepEqual(fields, ['type', 'schemaVersion', 'telemetryRoot']);
    return { limit(limit) { assert.equal(limit, 201); return { path, limit, query: true }; } };
  } });
  const original = db.runTransaction;
  db.runTransaction = (callback, settings) => original(async tx => callback({ ...tx, get: async ref => {
    if (!ref.query) return tx.get(ref);
    const docs = [...db.records].filter(([key]) => key.startsWith(ref.path + '/') && !key.slice(ref.path.length + 1).includes('/'))
      .slice(0, ref.limit).map(([, value]) => ({ data: () => structuredClone(value) }));
    return { size: docs.length, docs };
  } }), settings);
  return db;
}
test('backfill previews, applies, audits and replays without changing event fields', async () => {
  const db = fixture(['race', 'practice', 'race']);
  const preview = await backfillSessionCounts(db, adminAuth, review, options);
  assert.equal(db.counts.writes, 0); assert.deepEqual(preview.results[0].sessionTypeCounts, { race: 2, practice: 1 });
  const result = await backfillSessionCounts(db, adminAuth, review, { ...options, dryRun: false });
  assert.equal(result.results[0].writes, 2);
  assert.deepEqual(db.records.get(path), { date, schemaVersion: 2, revision: 7, eventName: 'Workshop', sessionTypeCounts: { race: 2, practice: 1 } });
  assert.equal(db.records.get(ROOT + '/metadataChanges/' + result.results[0].changeId).action, 'initialise-session-counts');
  assert.equal((await backfillSessionCounts(db, adminAuth, review, { ...options, dryRun: false })).results[0].writes, 0);
});
test('empty days initialise an explicit empty summary; invalid types and overflow abort without writes', async () => {
  const empty = fixture(); await backfillSessionCounts(empty, adminAuth, review, { ...options, dryRun: false });
  assert.deepEqual(empty.records.get(path).sessionTypeCounts, {});
  for (const types of [['invalid'], Array(201).fill('race')]) {
    const db = fixture(types); await assert.rejects(backfillSessionCounts(db, adminAuth, review, { ...options, dryRun: false }));
    assert.equal(db.counts.writes, 0);
  }
  const db = fixture(Array(200).fill('race'));
  const result = await backfillSessionCounts(db, adminAuth, review, options); assert.deepEqual(result.results[0].sessionTypeCounts, { race: 200 });
});
test('backfill requires admin authority, explicit dates, and stops on revoked role', async () => {
  const db = fixture();
  for (const input of [{ ...review, dates: Array(31).fill(date) }, { ...review, dates: [date, date] }, { ...review, dates: ['2026-02-30'] }]) {
    await assert.rejects(backfillSessionCounts(db, adminAuth, input, options));
  }
  await assert.rejects(backfillSessionCounts(db, { uid: 'viewer', token: {} }, review, options));
  await assert.rejects(backfillSessionCounts(db, adminAuth, review, { ...options, actor: async () => ({ uid: adminAuth.uid, token: {} }) }));
  assert.equal(db.counts.reads, 0); assert.equal(db.counts.writes, 0);
});
