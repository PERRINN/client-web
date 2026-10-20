import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const require = createRequire(import.meta.url);
const { authorized, validatePayload, londonDay, storeSample, createHandler, MAX_CHUNK_BYTES } = require('../../functions/utils/greenpowerTelemetry.js');
const secret = 'synthetic-test-password-at-least-32-characters';
const authorization = `Basic ${Buffer.from(`424:${secret}`).toString('base64')}`;

export function memoryDb() {
  const records = new Map();
  let reads = 0, writes = 0;
  const reference = path => ({ path, collection: name => ({ doc: id => reference(`${path}/${name}/${id}`) }) });
  return { records, counts: () => ({ reads, writes }), doc: reference,
    async runTransaction(callback, options) {
      assert.equal(options.maxAttempts, 3);
      await callback({ get: async ref => { reads++; return { data: () => records.get(ref.path) }; },
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
test('chunk rollover retains every sample and keeps ordinary appends at two reads/two writes and creates metadata once', async () => {
  const db = memoryDb(), at = Date.UTC(2026, 9, 19);
  for (let i = 0; i < 65; i++) await storeSample(db, '{"Vt":24}', at + i, String(i));
  const chunks = [...db.records.entries()].filter(([path]) => path.includes('/chunks/')).map(([, value]) => value);
  assert.deepEqual(chunks.map(c => c.samples.length), [32, 32, 1]);
  assert.equal(chunks.flatMap(c => c.samples).length, 65);
  assert.equal(db.records.get('GreenpowerTelemetry/424/days/2026-10-19/live/latest').count, 65);
  assert.deepEqual(db.counts(), { reads: 131, writes: 131 });
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
