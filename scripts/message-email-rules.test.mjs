import assert from 'node:assert/strict';
import { test } from 'node:test';

const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(host || '', /^(127\.0\.0\.1|localhost):\d+$/, 'A local Firestore emulator is required.');
const project = 'demo-message-email';
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
let sequence = 0;
function token(uid, claims = {}) {
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims, sub: uid, user_id: uid, aud: project,
    iss: `https://securetoken.google.com/${project}`, iat: now, exp: now + 3600,
    firebase: { sign_in_provider: 'custom', identities: {} } })}.`;
}
function field(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, value]) => [key, field(value)])) } };
}
async function request(path, uid, options = {}, claims) {
  return fetch(base + path, { ...options, headers: { 'Content-Type': 'application/json',
    ...(uid ? { Authorization: `Bearer ${uid === 'owner' ? 'owner' : token(uid, claims)}` } : {}) } });
}
async function create(uid, extra = {}, user = uid, claims) {
  const fields = Object.fromEntries(Object.entries({ user: user || 'alice', chain: 'synthetic-chat', text: 'Hello', ...extra }).map(([key, value]) => [key, field(value)]));
  const id = 'email-rule-' + sequence++;
  const response = await request(':commit', uid, { method: 'POST', body: JSON.stringify({ writes: [{
    update: { name: `projects/${project}/databases/(default)/documents/PERRINNMessages/${id}`, fields },
    updateTransforms: [{ fieldPath: 'serverTimestamp', setToServerValue: 'REQUEST_TIME' }]
  }] }) }, claims);
  return { status: response.status, body: await response.text(), id };
}

test('normal messages still require the author; email-free Settings/profile commands remain available', async () => {
  for (const uid of ['alice', 'bob']) for (const extra of [{}, { name: 'Synthetic user' }, { userCurrency: 'gbp' }]) {
    const result = await create(uid, extra); assert.equal(result.status, 200, result.body);
  }
  assert.equal((await create()).status, 403);
  assert.equal((await create('alice', {}, 'bob')).status, 403);
});

test('all client email-map submissions fail, including malformed, admin and spoofed verified commands', async () => {
  for (const uid of [undefined, 'alice', 'bob', 'admin']) for (const emails of [{ auth: 'synthetic@example.test' }, {}, null, 'synthetic@example.test']) {
    const result = await create(uid, { emails, verified: true, isBackendMessage: true }, uid, { perrinnAdmin: true });
    assert.equal(result.status, 403, result.body);
  }
});

test('existing historical email records are untouched; clients cannot patch or delete them', async () => {
  const path = '/PERRINNMessages/historical-email';
  const fields = { user: field('alice'), text: field('Historical'), emails: field({ auth: 'historical@example.test' }) };
  assert.equal((await request(path, 'owner', { method: 'PATCH', body: JSON.stringify({ fields }) })).status, 200);
  for (const uid of [undefined, 'alice', 'bob']) {
    const response = await request(path, uid); assert.equal(response.status, 200);
    assert.equal((await response.json()).fields.emails.mapValue.fields.auth.stringValue, 'historical@example.test');
    assert.equal((await request(path, uid, { method: 'PATCH', body: JSON.stringify({ fields }) })).status, 403);
    assert.equal((await request(path, uid, { method: 'DELETE' })).status, 403);
  }
});
