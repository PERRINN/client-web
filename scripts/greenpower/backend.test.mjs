import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const require = createRequire(import.meta.url);
const { authorized, validatePayload, londonDay, storeSample, createHandler, MAX_CHUNK_BYTES, FROZEN_AFTER_MS, INGESTION_STATE_PATH, sensorFingerprint } = require('../../functions/utils/greenpowerTelemetry.js');
const secret = 'synthetic-test-password-at-least-32-characters';
const authorization = `Basic ${Buffer.from(`424:${secret}`).toString('base64')}`;

export function memoryDb() {
  const records = new Map();
  let reads = 0, writes = 0;
  const reference = path => ({ path, collection: name => ({ doc: id => reference(`${path}/${name}/${id}`) }) });
  return { records, counts: () => ({ reads, writes }), doc: reference,
    async runTransaction(callback, options) {
      assert.equal(options.maxAttempts, 3);
      return callback({ get: async ref => { reads++; return { data: () => records.get(ref.path) }; },
        set: (ref, value) => { writes++; records.set(ref.path, value); } });
    }
  };
}
test('authentication requires the configured username and a strong secret in Basic auth', () => {
  assert.equal(authorized(authorization, secret), true);
  for (const header of [undefined, 'Basic junk', `Bearer ${secret}`, `Basic ${Buffer.from(`other:${secret}`).toString('base64')}`, authorization + 'invalid']) assert.equal(authorized(header, secret), false);
  assert.equal(authorized(authorization, 'short'), false);
});
test('raw unknown fields, arrays, units and nulls survive; malformed/oversize/deep inputs fail', () => {
  const raw = '{ "unknown/channel": [[1,null]], "temperature": {"value":20,"unit":"C"}, "flag":false }';
  assert.equal(validatePayload(raw), raw);
  for (const raw of ['[]', '{}', 'null', '{', '{"v":1e999}', JSON.stringify({ value: 'x'.repeat(17000) }), JSON.stringify({ a: { a: { a: { a: { a: { a: { a: { a: { a: 1 } } } } } } } } })]) assert.throws(() => validatePayload(raw));
});
test('day assignment uses UK midnight including BST/GMT transitions', () => {
  assert.equal(londonDay(Date.parse('2026-07-01T23:30:00Z')), '2026-07-02');
  assert.equal(londonDay(Date.parse('2026-01-01T23:30:00Z')), '2026-01-01');
  for (const time of ['2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z']) assert.equal(londonDay(Date.parse(time)), '2026-10-25');
});
test('chunk rollover retains grace-period samples at three reads/three writes and creates metadata once', async () => {
  const db = memoryDb(), at = Date.UTC(2026, 9, 19);
  for (let i = 0; i < 65; i++) await storeSample(db, '{"Vt":24}', at + i, String(i));
  const chunks = [...db.records.entries()].filter(([path]) => path.includes('/chunks/')).map(([, value]) => value);
  assert.deepEqual(chunks.map(c => c.samples.length), [32, 32, 1]);
  assert.equal(chunks.flatMap(c => c.samples).length, 65);
  assert.equal(db.records.get('GreenpowerTelemetry/424/days/2026-10-19/live/latest').count, 65);
  assert.deepEqual(db.counts(), { reads: 196, writes: 196 });
});
test('byte rollover stays below the chunk budget, and late requests do not regress latest values', async () => {
  const db = memoryDb(), at = Date.UTC(2026, 9, 19), raw = JSON.stringify({ value: 'x'.repeat(15000) });
  for (let i = 0; i < 30; i++) await storeSample(db, raw, at + i, String(i));
  await storeSample(db, '{"older":true}', at, 'older');
  for (const [path, chunk] of db.records) if (path.includes('/chunks/')) assert.ok(chunk.bytes <= MAX_CHUNK_BYTES);
  assert.equal(db.records.get('GreenpowerTelemetry/424/days/2026-10-19/live/latest').latest.id, '29');
});
test('HTTP accepts documented path JSON and JSON POST, and rejects unauthorized/invalid requests without writes', async () => {
  const db = memoryDb();
  const handler = createHandler({ db, password: () => secret, timestamp: () => 'server-time' });
  async function request(overrides = {}) {
    const req = { method: 'POST', path: '/', query: {}, rawBody: Buffer.from('{"Vt":24}'), get: name => ({ authorization, 'content-type': 'application/json' })[name], ...overrides };
    const res = { code: 200, headers: {}, status(value) { this.code = value; return this; }, set(key, value) { this.headers[key] = value; return this; }, send(body) { this.body = body; return this; } };
    await handler(req, res); return res;
  }
  assert.equal((await request()).code, 204);
  assert.equal((await request({ method: 'GET', path: '/' + encodeURIComponent('{"unknown":3}') })).code, 204);
  const count = db.counts().writes;
  assert.equal((await request({ get: () => '' })).code, 401);
  assert.equal((await request({ method: 'PUT' })).code, 405);
  assert.equal((await request({ rawBody: Buffer.from('[]') })).code, 400);
  assert.equal((await request({ rawBody: Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]) })).code, 400);
  assert.equal((await request({ method: 'GET', path: '/%bad' })).code, 400);
  assert.equal((await request({ method: 'GET', path: '/%7B%7D', query: { password: 'no' } })).code, 400);
  assert.equal((await request({ get: name => name === 'authorization' ? authorization : 'text/plain' })).code, 415);
  assert.equal(db.counts().writes, count);
});

test('sensor fingerprint ignores phone fields and JSON order but preserves car values and units', () => {
  const first = sensorFingerprint('{"Vt":24,"A":2,"Lat":52,"raceseconds":1}');
  assert.equal(first, sensorFingerprint('{"raceseconds":99,"A":2,"Vt":24,"Lat":53,"timestamp":100}'));
  for (const raw of ['{"Vt":24,"A":3}', '{"Vt":24}', '{"Vt":24,"A":2,"RPM":0}']) assert.notEqual(first, sensorFingerprint(raw));
  assert.equal(sensorFingerprint('{"A":{"value":2,"unit":"A"}}'), sensorFingerprint('{"A":{"unit":"A","value":2}}'));
  assert.notEqual(sensorFingerprint('{"A":{"value":2,"unit":"A"}}'), sensorFingerprint('{"A":{"value":2,"unit":"mA"}}'));
  for (const raw of ['{"Lat":52}', '{"Vt":null}', '{"Vt":"24"}', '{"A":{"value":2}}', '{"Vt":24,"A":null}']) assert.equal(sensorFingerprint(raw), null);
});

test('frozen readings pause at exactly 60 seconds, with one read/no writes and unchanged live state', async () => {
  const db = memoryDb(), at = Date.UTC(2026, 9, 23, 12);
  const raw = second => JSON.stringify({ Vt: 24, A: 0, RPM: 0, Lat: second, raceseconds: second });
  assert.equal((await storeSample(db, raw(0), at, 'first')).recorded, true);
  assert.equal((await storeSample(db, raw(59), at + FROZEN_AFTER_MS - 1, 'grace')).recorded, true);
  const before = db.counts(), records = JSON.stringify([...db.records]);
  for (const offset of [FROZEN_AFTER_MS, FROZEN_AFTER_MS + 3000, FROZEN_AFTER_MS * 100]) {
    assert.equal((await storeSample(db, raw(offset), at + offset, 'frozen')).recorded, false);
  }
  assert.deepEqual(db.counts(), { reads: before.reads + 3, writes: before.writes });
  assert.equal(JSON.stringify([...db.records]), records);
});

test('sensor activity resumes immediately and starts a new grace period, including nonzero frozen readings', async () => {
  const db = memoryDb(), at = Date.UTC(2026, 9, 23, 12);
  await storeSample(db, '{"Vt":24,"RPM":3000}', at);
  assert.equal((await storeSample(db, '{"Vt":24,"RPM":3000}', at + 60000)).recorded, false);
  assert.equal((await storeSample(db, '{"Vt":23.99,"RPM":3000}', at + 63000)).recorded, true);
  assert.equal((await storeSample(db, '{"Vt":23.99,"RPM":3000}', at + 122999)).recorded, true);
  assert.equal((await storeSample(db, '{"Vt":23.99,"RPM":3000}', at + 123000)).recorded, false);
});

test('midnight and new handler instances do not restart the frozen window or create empty days', async () => {
  const db = memoryDb(), at = Date.parse('2026-10-23T22:59:00Z');
  await storeSample(db, '{"Vt":24}', at);
  const before = db.counts();
  const handler = createHandler({ db, password: () => secret, now: () => at + 90000 });
  const req = { method: 'GET', path: '/' + encodeURIComponent('{"Vt":24}'), query: {}, get: () => authorization };
  const res = { status(code) { this.code = code; return this; }, set() { return this; }, send() { return this; } };
  await handler(req, res);
  assert.equal(res.code, 204);
  assert.deepEqual(db.counts(), { reads: before.reads + 1, writes: before.writes });
  assert.equal(db.records.has('GreenpowerTelemetry/424/days/2026-10-24'), false);
});

test('unknown, malformed and changing sensor sets fail open and reset the detector', async () => {
  const db = memoryDb(), at = Date.UTC(2026, 9, 23, 12);
  await storeSample(db, '{"Vt":24}', at);
  for (const [i, raw] of ['{"Vt":null}', '{"Vt":"24"}', '{"newSensor":1}', '{"Vt":24}', '{"Vt":24,"RPM":0}', '{"Vt":24}'].entries()) {
    assert.equal((await storeSample(db, raw, at + (i + 1) * 120000)).recorded, true);
  }
  db.records.set(INGESTION_STATE_PATH, { sensorFingerprint: sensorFingerprint('{"Vt":24}'), unchangedSince: at });
  assert.equal((await storeSample(db, '{"Vt":24}', at + 900000)).recorded, true);
  db.records.set(INGESTION_STATE_PATH, { schemaVersion: 99, lastAcceptedAt: at + 99999999 });
  assert.equal((await storeSample(db, '{"Vt":24}', at + 1000000)).recorded, true);
  assert.equal(db.records.get(INGESTION_STATE_PATH).unchangedSince, at + 1000000);
});

test('late requests cannot regress ingestion timing or restart an existing freeze window', async () => {
  const db = memoryDb(), at = Date.UTC(2026, 9, 23, 12);
  await storeSample(db, '{"Vt":24}', at);
  await storeSample(db, '{"Vt":24}', at + 59000);
  const state = db.records.get(INGESTION_STATE_PATH);
  await storeSample(db, '{"Vt":25}', at - 1000);
  assert.deepEqual(db.records.get(INGESTION_STATE_PATH), state);
  assert.equal((await storeSample(db, '{"Vt":24}', at + 60000)).recorded, false);
});

test('ingestion-state read failures return retryable HTTP errors without accepting or storing samples', async () => {
  const db = { doc: path => ({ path }), runTransaction: async callback => callback({
    get: async () => { throw Error('Synthetic unavailable database'); },
    set: () => assert.fail('No writes after a failed state read'),
  }) };
  const handler = createHandler({ db, password: () => secret });
  const req = { method: 'GET', path: '/' + encodeURIComponent('{"Vt":24}'), query: {}, get: () => authorization };
  const res = { headers: {}, status(code) { this.code = code; return this; },
    set(key, value) { this.headers[key] = value; return this; }, send() { return this; } };
  await handler(req, res);
  assert.equal(res.code, 503);
  assert.equal(res.headers['Retry-After'], '3');
});
