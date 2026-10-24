import assert from 'node:assert/strict';
import { test } from 'node:test';
const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(host || '', /^(127\.0\.0\.1|localhost):\d+$/, 'A local Firestore emulator is required.');
const project = 'demo-participants';
let sequence = 0;
function token(uid, claims = {}) {
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url'), now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims, sub: uid, user_id: uid, aud: project,
    iss: `https://securetoken.google.com/${project}`, iat: now, exp: now + 3600,
    firebase: { sign_in_provider: 'custom', identities: {} } })}.`;
}
function field(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(field) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, field(entry)])) } };
}
async function write(uid, change, claims = {}, author = uid, method = 'create') {
  const name = `projects/${project}/databases/(default)/documents/PERRINNMessages/participants-${sequence++}`;
  const data = { user: author || 'anonymous', text: 'Participant update', chain: 'engineering',
    ...(change === undefined ? {} : { participantChange: change }) };
  const response = await fetch(`http://${host}/v1/projects/${project}/databases/(default)/documents:commit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${token(uid, claims)}` } : {}) },
    body: JSON.stringify({ writes: [{ update: { name, fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, field(value)])) },
      currentDocument: { exists: method !== 'create' }, updateTransforms: [{ fieldPath: 'serverTimestamp', setToServerValue: 'REQUEST_TIME' }] }] })
  });
  return { status: response.status, body: await response.text() };
}
test('ordinary messages remain available; participant commands require the exact admin claim and author', async () => {
  for (const uid of ['alice', 'bob']) assert.equal((await write(uid)).status, 200);
  for (const action of ['add', 'remove']) {
    const command = { action, userId: 'target' };
    for (const uid of [undefined, 'alice', 'bob']) assert.equal((await write(uid, command)).status, 403);
    assert.equal((await write('admin', command, { perrinnAdmin: 'true' })).status, 403);
    assert.equal((await write('admin', command, { perrinnAdmin: true }, 'bob')).status, 403);
    const result = await write('admin', command, { perrinnAdmin: true }); assert.equal(result.status, 200, result.body);
  }
});
test('admins cannot submit malformed participant commands or update historical messages', async () => {
  for (const command of [null, [], {}, { action: 'clear', userId: 'target' }, { action: 'add', userId: '' },
    { action: 'remove', userId: '../target' }, { action: 'add', userId: 'a'.repeat(129) },
    { action: 'add', userId: 'target', extra: true }]) {
    assert.equal((await write('admin', command, { perrinnAdmin: true })).status, 403);
  }
  const result = await write('admin', { action: 'add', userId: 'target' }, { perrinnAdmin: true }, 'admin', 'update');
  assert.equal(result.status, 403, result.body);
});
