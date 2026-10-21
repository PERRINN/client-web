import assert from 'node:assert/strict';
import { test } from 'node:test';
const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(host || '', /^(127\.0\.0\.1|localhost):\d+$/, 'A local Firestore emulator is required.');
const projectId = 'demo-funds';
function token(uid, claims = {}) {
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url'), now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims, sub: uid, user_id: uid, aud: projectId, iss: `https://securetoken.google.com/${projectId}`, iat: now, exp: now + 3600, firebase: { sign_in_provider: 'custom', identities: {} } })}.`;
}
function field(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, field(entry)])) } };
}
let sequence = 0;
async function write(fund, uid, claims, user = uid, method = 'commit') {
  const name = `projects/${projectId}/databases/(default)/documents/PERRINNMessages/fund-test-${sequence++}`;
  const fields = { user: field(user || 'user'), text: field('Fund update'), ...(fund === undefined ? {} : { fund: field(fund) }) };
  const response = await fetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents:${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${token(uid, claims)}` } : {}) },
    body: JSON.stringify({ writes: [{ update: { name, fields }, updateTransforms: [{ fieldPath: 'serverTimestamp', setToServerValue: 'REQUEST_TIME' }] }] })
  });
  return { status: response.status, body: await response.text() };
}
const ordinary = { description: 'Testing', amountGBPTarget: 100, daysLeft: 30 };
test('ordinary authenticated fund edits remain available; anonymous and impersonated writes fail', async () => {
  for (const uid of ['alice', 'bob']) {
    for (const fund of [undefined, ordinary]) { const result = await write(fund, uid); assert.equal(result.status, 200, result.body); }
  }
  assert.equal((await write(ordinary)).status, 403);
  assert.equal((await write(ordinary, 'alice', {}, 'bob')).status, 403);
});
test('only an exact admin claim can submit zero or positive raised corrections', async () => {
  for (const uid of [undefined, 'alice', 'bob']) for (const claims of [{}, { perrinnAdmin: 'true' }]) {
    for (const amountGBPRaised of [0, 125]) assert.equal((await write({ ...ordinary, amountGBPRaised }, uid, claims)).status, 403);
  }
  for (const amountGBPRaised of [0, 125.25, 2000]) {
    const result = await write({ ...ordinary, amountGBPRaised }, 'admin', { perrinnAdmin: true });
    assert.equal(result.status, 200, result.body);
  }
  for (const amountGBPRaised of [null, '0', -1, 90071992547410]) assert.equal((await write({ ...ordinary, amountGBPRaised }, 'admin', { perrinnAdmin: true })).status, 403);
});
test('only admins can cancel, including equivalent target/day commands; malformed commands are denied', async () => {
  const cancellation = { description: 'add a description', amountGBPTarget: 0.0001, daysLeft: 0.1 };
  for (const fund of [cancellation, { amountGBPTarget: 0.001 }, { daysLeft: -1 }, { daysLeft: 0.1 }, { amountGBPTarget: -1 }]) {
    for (const uid of [undefined, 'alice', 'bob']) assert.equal((await write(fund, uid)).status, 403);
    assert.equal((await write(fund, 'admin', { perrinnAdmin: 'true' })).status, 403);
    const result = await write(fund, 'admin', { perrinnAdmin: true }); assert.equal(result.status, 200, result.body);
  }
  for (const fund of [null, 'cancel', { amountGBPTarget: '0.0001' }, { daysLeft: '-1' }]) assert.equal((await write(fund, 'alice')).status, 403);
});

test('fixed closing-date edits are available to signed-in users; cancellation and past dates are admin-only', async () => {
  const future=Date.now()+86400000, past=Date.now()-86400000;
  for(const uid of ['alice','bob']) {
    assert.equal((await write({...ordinary,closesAt:future,cancelled:false},uid)).status,200);
    for(const fund of [{cancelled:true},{closesAt:past}]) assert.equal((await write(fund,uid)).status,403);
  }
  for(const fund of [{cancelled:true},{closesAt:past}]) {
    assert.equal((await write(fund,'admin',{perrinnAdmin:true})).status,200);
    assert.equal((await write(fund,'admin',{perrinnAdmin:'true'})).status,403);
    assert.equal((await write(fund)).status,403);
  }
  for(const fund of [{cancelled:'true'},{cancelled:null},{closesAt:0},{closesAt:-1},{closesAt:'tomorrow'},{closesAt:future+.5}]) assert.equal((await write(fund,'admin',{perrinnAdmin:true})).status,403);
});
