import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareDayMigration, runDayMigration, checksum } from './eventDayMigration.mjs';
import { event, recording, memoryDb, adminAuth, options, ROOT } from './eventFixtures.mjs';
const settings = { actor: async () => adminAuth, timestamp: options.timestamp };
function fixture(count = 2) {
  const events = Array.from({ length: count }, (_, i) => ({ id: 'legacy-' + i, expectedRevision: 0,
    data: { ...event('Named event ' + i), date: '2026-06-' + String(i + 1).padStart(2, '0') } }));
  const db = memoryDb(events.flatMap(record => [...recording(record.data.date).records,
    [ROOT + '/events/' + record.id, { ...record.data, notes: 'Later live correction', revision: 2, sessionCount: 0, updatedBy: 'admin', updatedAt: new Date() }]]));
  db.getAll = async (...refs) => refs.map(ref => ({ data: () => db.records.get(ref.path) }));
  let queryCount = 0;
  db.collection = path => ({ where: (field, op, id) => ({ limit: limit => ({ async get() {
    assert.equal(limit, 1); assert.equal(field, 'eventId'); assert.equal(op, '=='); queryCount++;
    return { empty: ![...db.records].some(([key, value]) => key.startsWith(path + '/') && value.eventId === id) };
  } }) }) });
  const contents = JSON.stringify({ version: 1, scope: 'events-only', projectId: 'perrinn-d5fc1', events });
  return { db, events, contents, queries: () => queryCount };
}

test('migration previews without writes, copies current live metadata, preserves legacy/raw and replays safely', async () => {
  const h = fixture(), before = structuredClone([...h.db.records]);
  const plan = await prepareDayMigration(h.db, h.contents); assert.equal(h.queries(), 2);
  assert.equal(plan.batches[0].request.events[0].data.notes, 'Later live correction');
  assert.equal((await runDayMigration(h.db, plan, settings)).writes, 0); assert.deepEqual([...h.db.records], before);
  const result = await runDayMigration(h.db, plan, { ...settings, apply: true }); assert.equal(result.writes, 4);
  for (const [path, value] of before) assert.deepEqual(h.db.records.get(path), value);
  const first = ROOT + '/events/2026-06-01'; assert.equal(h.db.records.get(first).notes, 'Later live correction');
  h.db.records.get(first).name = 'New admin edit'; h.db.records.get(first).revision = 2;
  assert.equal((await runDayMigration(h.db, plan, { ...settings, apply: true })).writes, 0);
  assert.equal(h.db.records.get(first).name, 'New admin edit');
  assert.notEqual(checksum(JSON.stringify(plan)), checksum(JSON.stringify(plan) + '\n'));
});

test('sources without recordings are reported; linked sessions or ambiguous dates stop preparation', async () => {
  const h = fixture(); h.db.records.delete(ROOT + '/days/2026-06-01');
  const plan = await prepareDayMigration(h.db, h.contents); assert.equal(plan.skipped.length, 1); assert.equal(plan.batches[0].request.events.length, 1);
  h.db.records.set(ROOT + '/sessions/orphan', { eventId: 'legacy-1' });
  await assert.rejects(prepareDayMigration(h.db, h.contents), /linked sessions/); assert.equal(h.db.counts.writes, 0);
  const manifest = JSON.parse(h.contents); manifest.events[1].data.date = manifest.events[0].data.date;
  await assert.rejects(prepareDayMigration(h.db, JSON.stringify(manifest)), /duplicate dates/);
});

test('changed sources, occupied canonical IDs and revoked actors cannot overwrite metadata', async () => {
  const h = fixture(), plan = await prepareDayMigration(h.db, h.contents);
  h.db.records.get(ROOT + '/events/legacy-1').revision++;
  await assert.rejects(runDayMigration(h.db, plan, { ...settings, apply: true }), /source changed/); assert.equal(h.db.counts.writes, 0);
  h.db.records.get(ROOT + '/events/legacy-1').revision--;
  h.db.records.set(ROOT + '/events/2026-06-01', { ...event(), revision: 1 });
  await assert.rejects(runDayMigration(h.db, plan, { ...settings, apply: true }), /changed/); assert.equal(h.db.counts.writes, 0);
  h.db.records.delete(ROOT + '/events/2026-06-01'); let calls = 0;
  await assert.rejects(runDayMigration(h.db, plan, { ...settings, apply: true, actor: async () => ++calls === 1 ? adminAuth : { uid: adminAuth.uid, token: {} } }), /admin access/);
  assert.equal(h.db.counts.writes, 0);
});
