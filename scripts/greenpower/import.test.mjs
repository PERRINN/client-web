import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planImport, rawRecords, fetchHistory, CAR_ID } from './historySource.mjs';
import { runImport, importChunks } from './historyImport.mjs';
import { data } from './load.mjs';

const at = Date.parse('2026-10-18T10:00:00Z');
const bodyFor = (count = 65) => JSON.stringify(Array.from({ length: count }, (_, i) => ({ id: i + 1, carId: CAR_ID, updated: String(at + i * 3000), voltage: 24, speed: i % 2 ? 12 : 0, brake: null, extra: { nested: [null, '{x}'] } })));
const planFor = (count = 65) => planImport(bodyFor(count), '2026-10-18', count);

function memoryDb() {
  const records = new Map(), queries = [];
  let writes = 0, reads = 0;
  const snapshot = (path, value) => ({ id: path.split('/').at(-1), exists: value !== undefined, data: () => value });
  function ref(path, options = {}) {
    return { path, id: path.split('/').at(-1), doc: id => ref(path + '/' + id), collection: name => ref(path + '/' + name),
      orderBy: () => ref(path, options), limit: limit => ref(path, { ...options, limit }), startAfter: cursor => ref(path, { ...options, cursor: cursor.id }),
      async get() {
        if (path.split('/').length % 2 === 0) { reads++; return snapshot(path, records.get(path)); }
        assert.ok(options.limit > 0 && options.limit <= 100); queries.push(options.limit);
        const docs = [...records].filter(([key]) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/') && (!options.cursor || key.split('/').at(-1) > options.cursor)).sort(([a], [b]) => a.localeCompare(b)).slice(0, options.limit).map(([key, value]) => snapshot(key, value));
        reads += docs.length; return { docs, size: docs.length, empty: !docs.length };
      }
    };
  }
  return { records, queries, doc: ref, get writes() { return writes; }, get reads() { return reads; },
    async runTransaction(callback, options) {
      assert.equal(options.maxAttempts, 3); const pending = [];
      await callback({ getAll: async (...refs) => { reads += refs.length; return refs.map(r => snapshot(r.path, records.get(r.path))); },
        create: (r, v) => { assert.ok(!records.has(r.path)); pending.push([r.path, v]); }, set: (r, v) => pending.push([r.path, v]) });
      pending.forEach(([path, value]) => { records.set(path, structuredClone(value)); writes++; });
    }
  };
}

test('source parsing preserves exact raw objects and rejects wrong IDs, dates, counts and checksums', () => {
  const body = '[ { "id": 1, "carId": "' + CAR_ID + '", "updated":"' + at + '", "v":1.00,"text":"}\\\"["} ]';
  assert.equal(rawRecords(body)[0], body.slice(2, -2));
  const plan = planImport(body, '2026-10-18', 1);
  assert.match(plan.records[0].raw, /1\.00/);
  for (const [source, day, count, digest] of [[body, '2026-10-17', 1], [body, '2026-10-18', 2], [body, '2026-10-18', 1, 'wrong'], [body.replace(CAR_ID, 'other'), '2026-10-18', 1], [bodyFor(1).replace('"id":1', '"id":9007199254740993'), '2026-10-18', 1], ['[' + rawRecords(body)[0] + ',' + rawRecords(body)[0] + ']', '2026-10-18', 2]]) assert.throws(() => planImport(source, day, count, digest));
});
test('import resumes after interruption and completed reruns perform zero writes', async () => {
  const db = memoryDb(), plan = planFor();
  const dry = await runImport(db, plan); assert.equal(dry.mode, 'dry-run'); assert.equal(db.writes, 0);
  await assert.rejects(runImport(db, plan, { write: true, now: () => 1792400000000, progress: () => { throw new Error('interrupted after commit'); } }), /interrupted/);
  assert.equal(db.records.get('GreenpowerTelemetry/424/days/2026-10-18').count, 32);
  const result = await runImport(db, plan, { write: true, now: () => 9999999999999 });
  assert.equal(result.added, 33); assert.equal(result.existing, 32); assert.equal(result.chunks, 3);
  const writes = db.writes;
  const rerun = await runImport(db, plan, { write: true });
  assert.equal(rerun.mode, 'verified-rerun'); assert.equal(rerun.added, 0); assert.equal(db.writes, writes);
  const samples = [...db.records].filter(([p]) => p.includes('/chunks/')).flatMap(([, c]) => c.samples);
  assert.equal(samples.length, 65); assert.equal(new Set(samples.map(s => s.id)).size, 65);
  assert.ok(samples.every(s => s.receivedAt === 1792400000000));
  assert.deepEqual(samples.map(s => s.raw), plan.records.map(r => r.raw));
  assert.equal(data.channelsFor(samples).find(c => c.label === 'Vehicle speed').points.length, 65);
});
test('existing live data, orphan chunks, changed snapshots and modified stored samples fail closed', async () => {
  const plan = planFor(1), day = 'GreenpowerTelemetry/424/days/2026-10-18';
  const live = memoryDb(); live.records.set(day, { count: 1, latest: { source: '424-phone' } });
  await assert.rejects(runImport(live, plan, { write: true }), /day exists/); assert.equal(live.writes, 0);
  const orphan = memoryDb(); orphan.records.set(day + '/chunks/0000000000', { samples: [] });
  await assert.rejects(runImport(orphan, plan, { write: true }), /orphan/); assert.equal(orphan.writes, 0);
  const db = memoryDb(); await runImport(db, plan, { write: true }); const writes = db.writes;
  await assert.rejects(runImport(db, planImport(bodyFor(1).replace('"voltage":24', '"voltage":23'), '2026-10-18', 1), { write: true }), /conflicts/);
  db.records.get(day + '/chunks/0000000000').samples[0].raw = '{}';
  await assert.rejects(runImport(db, plan, { write: true }), /mismatch/); assert.equal(db.writes, writes);
});
test('rerun catches extra/missing chunks; byte rollover and all reads stay bounded', async () => {
  const plan = planFor(3252), db = memoryDb();
  await runImport(db, plan, { write: true }); const writes = db.writes;
  const before = db.reads; await runImport(db, plan, { write: true });
  assert.equal(db.reads - before, 104); assert.equal(db.writes, writes);
  db.records.set('GreenpowerTelemetry/424/days/2026-10-18/chunks/9999999999', { samples: [] });
  await assert.rejects(runImport(db, plan), /Unexpected/);
  const large = { ...planFor(1), records: Array.from({ length: 30 }, (_, i) => ({ id: String(i), eventAt: at, raw: JSON.stringify({ value: 'x'.repeat(15000) }) })) };
  const chunks = importChunks(large, Date.now());
  assert.ok(chunks.length > 1); assert.ok(chunks.every(c => c.bytes <= 128 * 1024));
});
test('history uses source time and canonical channel IDs without changing raw or live behavior', () => {
  const record = planFor(1).records[0]; const sample = { ...record, receivedAt: at + 86400000, source: 'echook-history' };
  const channel = data.channelsFor([sample], sample).find(c => c.label === 'Vehicle speed');
  assert.equal(channel.id, '["Spd"]:m/s'); assert.deepEqual(channel.points, [{ time: at, value: 0 }]);
  assert.equal(data.channelsFor([sample]).some(c => ['id', 'updated', 'carId'].includes(c.label)), false);
  assert.equal(data.fields(sample.raw).find(c => c.label === 'speed').unit, '');
  const live = { ...sample, source: '424-phone', eventAt: undefined, raw: '{"Spd":4}' };
  assert.equal(data.channelsFor([live])[0].points[0].time, live.receivedAt);
  assert.equal(data.fields('{"brake":1}', true)[0].id, '["brake"]');
  assert.equal(data.fields('{"constructor":3}', true)[0].id, '["constructor"]');
});
const response = (body, status = 200, headers = {}) => new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } });
test('fetcher completes short/empty pages, paginates 5,000 records and bounds retries', async () => {
  let calls = 0; const delays = [];
  const full = '[' + Array(5000).fill('{"x":1}').join(',') + ']';
  const result = await fetchHistory({ start: at, end: at + 1000, fetcher: async url => {
    calls++; assert.equal(url.searchParams.get('limit'), '5000');
    if (calls === 1) return response('', 429, { 'retry-after': '2' });
    return response(calls === 2 ? full : '[]');
  }, sleep: async ms => delays.push(ms) });
  assert.equal(result.count, 5000); assert.equal(result.requests, 3); assert.deepEqual(delays, [2000]);
  await assert.rejects(fetchHistory({ start: at, end: at, fetcher: async () => new Response(null, { status: 304 }) }), /HTTP 304/);
  await assert.rejects(fetchHistory({ start: at, end: at, fetcher: async () => response('{}', 200, { 'content-type': 'application/msgpack' }) }), /Expected JSON/);
  let failed = 0;
  await assert.rejects(fetchHistory({ start: at, end: at, fetcher: async () => { failed++; throw new Error('network'); }, sleep: async () => {} }), /three attempts/);
  assert.equal(failed, 3);
  let pages = 0;
  await assert.rejects(fetchHistory({ start: at, end: at, fetcher: async () => { pages++; return response(full); } }), /page budget/);
  assert.equal(pages, 20);
});
