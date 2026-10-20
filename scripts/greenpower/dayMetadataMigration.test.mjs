import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareMetadataMigration, applyMetadataMigration } from './dayMetadataMigration.mjs';
import { memoryDb, recording, adminAuth, options, ROOT, event, session } from './eventFixtures.mjs';
function fixture() {
  const rec = recording(), day = '2026-06-14', legacyId = 'historical-dyno';
  const source = { ...event('Dyno'), engineering: { gearingRatio: { value: 5, unit: '1' }, motorId: 'M1', carMass: { value: 100, unit: 'kg' } },
    driver: 'Alex', notes: 'Keep the original', revision: 2, sessionCount: 1, updatedBy: 'admin', updatedAt: new Date('2026-10-19') };
  const oldSession = { ...session(legacyId, [rec.segment()]), type: 'full_dyno', driver: 'Sam', revision: 1, updatedBy: 'admin', updatedAt: new Date('2026-10-19') };
  const records = [...rec.records, [ROOT + '/events/' + legacyId, source], [ROOT + '/sessions/s1', oldSession]];
  records[0][1].latest = rec.samples.at(-1);
  const db = memoryDb(records), paths = [], originalDoc = db.doc;
  const snap = (path, value) => ({ ref: { path }, id: path.split('/').at(-1), data: () => structuredClone(value) });
  db.doc = path => ({ ...originalDoc(path), async get() { paths.push(path); return snap(path, db.records.get(path)); } });
  db.getAll = async (...refs) => Promise.all(refs.map(ref => ref.get()));
  db.collection = path => { const query = (field, value) => ({ limit(limit) { return { async get() {
    paths.push(path); assert.ok(limit === 1 || limit === 3 || limit === 21);
    const docs = [...db.records].filter(([key, data]) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/') && (!field || data[field] === value)).slice(0, limit).map(([key, data]) => snap(key, data));
    return { docs, size: docs.length };
  } }; } }); return { ...query(), where(field, op, value) { assert.equal(op, '=='); return query(field, value); } }; };
  const review = { version: 2, projectId: 'perrinn-d5fc1', days: [{ date: day, trackId: null, sessionTypes: { full_dyno: 'motor_dyno' } }] };
  return { db, day, rec, review, paths, source };
}
test('migration preparation reads metadata only, preserves reviewed fields and reports nonconvertible ratios', async () => {
  const h = fixture(), plan = await prepareMetadataMigration(h.db, h.review);
  assert.equal(h.db.counts.writes, 0); assert.equal(h.paths.some(path => path.includes('/chunks/')), false);
  const target = plan.records[0].data;
  assert.equal(target.eventName, 'Dyno'); assert.deepEqual(target.defaults, { driver: 'Alex', motorId: 'M1', carMassKg: 100 });
  assert.equal(plan.records[0].sessions[0].id, 's1'); assert.equal(plan.records[0].sessions[0].type, 'motor_dyno'); assert.equal(plan.records[0].sessions[0].overrides.driver, 'Sam');
  assert.deepEqual(plan.records[0].sessions[0].ranges, [h.rec.segment()]); assert.equal(target.notes, undefined);
  assert.ok(plan.records[0].warnings.some(warning => warning.field === 'gearingRatio'));
  assert.equal(plan.records[0].sources[ROOT + '/events/historical-dyno'].notes, 'Keep the original');
});
test('migration uses four writes per day plus copied sessions, moves current live state atomically, and replay preserves later edits', async () => {
  const h = fixture(), plan = JSON.parse(JSON.stringify(await prepareMetadataMigration(h.db, h.review)));
  const chunkBefore = structuredClone(h.db.records.get(h.rec.records[1][0]));
  const preview = await applyMetadataMigration(h.db, adminAuth, plan, options); assert.equal(preview.writes, 0);
  h.db.records.get(ROOT + '/days/' + h.day).count = 5;
  const result = await applyMetadataMigration(h.db, adminAuth, plan, { ...options, dryRun: false }); assert.equal(result.writes, 5);
  assert.deepEqual(h.db.records.get(h.rec.records[1][0]), chunkBefore);
  assert.equal(h.db.records.get(ROOT + '/days/' + h.day + '/live/latest').count, 5);
  assert.equal(h.db.records.get(ROOT + '/days/' + h.day).count, undefined);
  assert.deepEqual(h.db.records.get(ROOT + '/days/' + h.day).sessionTypeCounts, { motor_dyno: 1 });
  assert.equal(h.db.records.get(ROOT + '/events/historical-dyno').notes, 'Keep the original');
  h.db.records.get(ROOT + '/days/' + h.day).eventName = 'Later edit';
  const replay = await applyMetadataMigration(h.db, adminAuth, plan, { ...options, dryRun: false }); assert.equal(replay.writes, 0);
  assert.equal(h.db.records.get(ROOT + '/days/' + h.day).eventName, 'Later edit');
});
test('changed sources, newly created canonical metadata, revoked operators and unreviewed types stop migration', async () => {
  for (const mutate of [h => h.db.records.get(ROOT + '/events/historical-dyno').revision++,
    h => h.db.records.set(ROOT + '/events/' + h.day, { name: 'New event' }),
    h => h.db.records.set(ROOT + '/days/' + h.day + '/live/latest', { count: 2 })]) {
    const h = fixture(), plan = await prepareMetadataMigration(h.db, h.review); mutate(h);
    await assert.rejects(applyMetadataMigration(h.db, adminAuth, plan, { ...options, dryRun: false })); assert.equal(h.db.counts.writes, 0);
  }
  const h = fixture(); delete h.review.days[0].sessionTypes;
  await assert.rejects(prepareMetadataMigration(h.db, h.review), /session type/);
  h.review.days[0].sessionTypes = { full_dyno: 'motor_dyno' }; const plan = await prepareMetadataMigration(h.db, h.review);
  await assert.rejects(applyMetadataMigration(h.db, { uid: 'viewer', token: {} }, plan, options), /admin/);
  await assert.rejects(applyMetadataMigration(h.db, adminAuth, plan, { ...options, dryRun: false, actor: async () => ({ uid: adminAuth.uid, token: {} }) }), /permission/);
  assert.equal(h.db.counts.writes, 0);
});
test('ambiguous records, excessive sessions, invalid source paths and missing track mappings require review', async () => {
  const h = fixture(); h.db.records.set(ROOT + '/events/second', { ...h.source });
  await assert.rejects(prepareMetadataMigration(h.db, h.review), /Ambiguous/);
  h.db.records.delete(ROOT + '/events/second'); h.db.records.get(ROOT + '/events/historical-dyno').location = 'Workshop';
  await assert.rejects(prepareMetadataMigration(h.db, h.review), /historical Track/);
  h.review.days[0].noTrackConfirmed = true; const plan = await prepareMetadataMigration(h.db, h.review);
  plan.records[0].sources[ROOT + '/days/' + h.day + '/chunks/0000000000'] = {};
  await assert.rejects(applyMetadataMigration(h.db, adminAuth, plan, options), /source paths/);
  assert.equal(h.db.counts.writes, 0);
});
