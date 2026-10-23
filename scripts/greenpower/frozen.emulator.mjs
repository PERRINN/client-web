// Local-only integration checks; this script refuses every production endpoint.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(host || '', /^(127\.0\.0\.1|localhost):\d+$/);
const projectId = 'demo-greenpower-freeze';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const { storeSample, INGESTION_STATE_PATH } = require('./utils/greenpowerTelemetry');
const app = admin.initializeApp({ projectId }, `freeze-${process.pid}`);
const db = app.firestore();
after(async () => { await db.terminate(); await app.delete(); });
const at = Date.parse('2026-10-23T22:59:00Z');
const liveRef = db.doc('GreenpowerTelemetry/424/days/2026-10-23/live/latest');
const stateRef = db.doc(INGESTION_STATE_PATH);
const raw = (voltage = 24, phoneTime = 0) => JSON.stringify({ Vt: voltage, A: 0, RPM: 0, Timestamp: phoneTime, Lat: phoneTime });

test('real transaction freezes across midnight without updating any documents, then resumes on activity', async () => {
  assert.equal((await storeSample(db, raw(), at, 'initial')).recorded, true);
  assert.equal((await storeSample(db, raw(24, 57), at + 57000, 'grace')).recorded, true);
  const before = await db.getAll(liveRef, stateRef, db.doc('GreenpowerTelemetry/424/days/2026-10-23/chunks/0000000000'));
  for (const offset of [60000, 63000, 120000]) assert.equal((await storeSample(db, raw(24, offset), at + offset)).recorded, false);
  const after = await db.getAll(...before.map(snapshot => snapshot.ref));
  after.forEach((snapshot, index) => assert.ok(snapshot.updateTime.isEqual(before[index].updateTime)));
  assert.equal((await db.doc('GreenpowerTelemetry/424/days/2026-10-24').get()).exists, false);
  assert.equal((await storeSample(db, raw(23.9, 123), at + 123000, 'resumed')).recorded, true);
  const resumed = await db.doc('GreenpowerTelemetry/424/days/2026-10-24/live/latest').get();
  assert.equal(resumed.data().count, 1);
  assert.equal(resumed.data().latest.id, 'resumed');
});

test('concurrent requests share one detector and retries preserve the last change time', async () => {
  const results = await Promise.all([0, 1].map(i => storeSample(db, raw(23.8, i), at + 126000, `concurrent-${i}`)));
  assert.ok(results.every(result => result.recorded));
  assert.equal((await stateRef.get()).data().unchangedSince, at + 126000);
  const live = db.doc('GreenpowerTelemetry/424/days/2026-10-24/live/latest');
  assert.equal((await live.get()).data().count, 3);
  const paused = await Promise.all([0, 1].map(i => storeSample(db, raw(23.8, i + 3), at + 186000)));
  assert.ok(paused.every(result => !result.recorded));
  assert.equal((await live.get()).data().count, 3);
});

function token(uid, claims = {}) {
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims, sub: uid, user_id: uid, aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`, iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600, firebase: { sign_in_provider: 'custom', identities: {} } })}.`;
}
test('ingestion state inherits signed-in reads, anonymous denial and denied client writes including admins', async () => {
  const url = `http://${host}/v1/projects/${projectId}/databases/(default)/documents/${INGESTION_STATE_PATH}`;
  for (const [uid, claims] of [[undefined, {}], ['alice', {}], ['bob', {}], ['admin', { perrinnAdmin: true }]]) {
    const headers = { 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${token(uid, claims)}` } : {}) };
    assert.equal((await fetch(url, { headers })).status, uid ? 200 : 403);
    assert.equal((await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ fields: { tampered: { booleanValue: true } } }) })).status, 403);
    assert.equal((await fetch(url, { method: 'DELETE', headers })).status, 403);
  }
});
