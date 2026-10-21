import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const require = createRequire(import.meta.url);
const { validateFundCommand } = require('../functions/utils/fundCommand.js');
const cancel = { description: 'add a description', amountGBPTarget: 0.0001, daysLeft: 0.1 };
function auth(claims = {}, disabled = false) {
  const calls = [];
  return { calls, async getUser(uid) { calls.push(uid); return { customClaims: claims, disabled }; } };
}
test('ordinary messages and fund edits inherit totals without extra Auth reads', async () => {
  const account = auth();
  for (const fund of [undefined, {}, { description: 'Testing', amountGBPTarget: 100, daysLeft: 30 }, { amountGBPTarget: 0, daysLeft: 0 }]) {
    assert.equal(await validateFundCommand(fund, 'user', account), undefined);
  }
  assert.deepEqual(account.calls, []);
});
test('admin corrections include zero and totals above target with exactly one Auth lookup', async () => {
  for (const amountGBPRaised of [0, 12.34, 1500]) {
    const account = auth({ perrinnAdmin: true });
    assert.equal(await validateFundCommand({ amountGBPTarget: 100, amountGBPRaised }, 'admin', account), amountGBPRaised);
    assert.deepEqual(account.calls, ['admin']);
  }
});
test('raised corrections and cancellation require a current enabled admin', async () => {
  for (const account of [auth(), auth({ perrinnAdmin: 'true' }), auth({ perrinnAdmin: true }, true)]) {
    for (const fund of [{ amountGBPRaised: 0 }, { amountGBPRaised: 125 }, cancel, { daysLeft: -1 }, { amountGBPTarget: -1 }]) {
      await assert.rejects(validateFundCommand(fund, 'user', account), /Admin permission/);
    }
  }
  const account = auth({ perrinnAdmin: true });
  assert.equal(await validateFundCommand(cancel, 'admin', account), undefined);
  assert.equal(await validateFundCommand({ ...cancel, amountGBPRaised: 0 }, 'admin', account), 0);
  assert.deepEqual(account.calls, ['admin', 'admin']);
  await assert.rejects(validateFundCommand({ amountGBPRaised: 1 }, 'admin', { getUser: async () => { throw new Error('Auth unavailable'); } }), /Auth unavailable/);
});
test('malformed amounts and disguised cancellation fail before Auth or verification writes', async () => {
  const account = auth({ perrinnAdmin: true });
  for (const amountGBPRaised of [null, undefined, '', '0', -1, NaN, Infinity, 90071992547410]) {
    await assert.rejects(validateFundCommand({ amountGBPRaised }, 'admin', account), /Invalid raised amount/);
  }
  for (const fund of [null, [], 'cancel', { amountGBPTarget: '0.0001' }, { daysLeft: '-1' }, { amountGBPTarget: NaN }]) {
    await assert.rejects(validateFundCommand(fund, 'admin', account), /Invalid fund command/);
  }
  assert.deepEqual(account.calls, []);
});

async function verifyFixture({ fund, previousRaised = 125, adminClaim = false, verified = false, options } = {}) {
  const { readFileSync } = await import('node:fs');
  const { runInNewContext } = await import('node:vm');
  const updates = [], logs = [], authCalls = [];
  const previous = { name: 'Alex', emails: { auth: 'person@example.test' }, verifiedTimestamp: { seconds: 1799999999 },
    serverTimestamp: 1, wallet: { balance: 100 }, fund: { description: 'Testing', amountGBPTarget: 1000, amountGBPRaised: previousRaised, daysLeft: 30 } };
  const doc = { id: 'previous', data: () => previous }, snapshot = docs => ({ docs, forEach: fn => docs.forEach(fn) });
  const db = { batch: () => ({ update: (path, fields) => updates.push({ path, fields }), commit: async () => {} }), doc: path => path,
    collection: () => {
      const conditions = [], query = { where: (...args) => { conditions.push(args); return query; }, orderBy: () => query, limit: () => query,
        get: async () => snapshot(conditions.some(([key, , value]) => key === 'chain' || (key === 'user' && value === 'person')) ? [doc] : []) };
      return query;
    } };
  const admin = { auth: () => ({ getUser: async uid => { authCalls.push(uid); return { customClaims: { perrinnAdmin: adminClaim } }; } }),
    firestore: Object.assign(() => db, { FieldValue: { arrayUnion: value => [value], serverTimestamp: () => 'server-time' } }) };
  const module = { exports: {} };
  runInNewContext(readFileSync(new URL('../functions/utils/verifyMessage.js', import.meta.url), 'utf8'), {
    module, require: name => ({ 'firebase-admin': admin, 'firebase-admin/firestore': { getFirestore: () => db }, './createMessage': {}, './fundCommand': { validateFundCommand }, './fundState': require('../functions/utils/fundState') })[name],
    Date: class extends Date { static now() { return 1800000000000; } }, console: { log: message => logs.push(message) }
  });
  await module.exports.verifyMessage('new', { user: 'person', chain: 'chat', name: 'Alex', text: 'Testing', serverTimestamp: 2, verified, ...(fund === undefined ? {} : { fund }) }, options);
  return { fund: updates.find(update => update.fields.fund)?.fields.fund, updates, logs, authCalls };
}

test('full verifier applies zero and inherits corrected totals on subsequent ordinary messages', async () => {
  for (const amountGBPRaised of [0, 200]) {
    const correction = await verifyFixture({ fund: { amountGBPRaised }, adminClaim: true });
    assert.deepEqual(correction.logs, []);
    assert.equal(correction.fund.amountGBPRaised, amountGBPRaised);
    assert.ok(correction.updates.some(update => update.fields.verified === true));
    const next = await verifyFixture({ previousRaised: amountGBPRaised });
    assert.equal(next.fund.amountGBPRaised, amountGBPRaised);
    assert.deepEqual(next.authCalls, []);
  }
});
test('full verifier rejects unauthorized corrections and cancellation before any batch writes', async () => {
  for (const fund of [{ amountGBPRaised: 0 }, cancel, { amountGBPTarget: '0.0001' }]) {
    const result = await verifyFixture({ fund });
    assert.equal(result.updates.length, 0);
    assert.equal(result.logs.length, 1);
  }
});

test('trusted daily reprocessing preserves zero, positive totals and ended funds without admin reads', async () => {
  for (const fund of [{ amountGBPRaised: 0, daysLeft: 0.2 }, { amountGBPRaised: 200, daysLeft: -2 }, { ...cancel, amountGBPRaised: 0 }]) {
    const result = await verifyFixture({ fund, verified: true, options: { reprocessing: true } });
    assert.deepEqual(result.logs, []);
    assert.equal(result.fund.amountGBPRaised, fund.amountGBPRaised);
    assert.deepEqual(result.authCalls, []);
    assert.ok(result.updates.some(update => update.fields.verified === true));
  }
});
test('reprocessing does not skip validation of unverified commands or new trigger messages', async () => {
  for (const verified of [false, true]) {
    const result = await verifyFixture({ fund: { amountGBPRaised: 0 }, verified });
    assert.equal(result.updates.length, 0);
    assert.deepEqual(result.authCalls, ['person']);
  }
  const unverified = await verifyFixture({ fund: { amountGBPRaised: 0 }, options: { reprocessing: true } });
  assert.equal(unverified.updates.length, 0);
  assert.deepEqual(unverified.authCalls, ['person']);
});

test('full verifier processes explicit cancellation while keeping inherited target and raised total', async () => {
  const result=await verifyFixture({fund:{cancelled:true},adminClaim:true});
  assert.deepEqual(result.logs,[]);assert.equal(result.fund.cancelled,true);assert.equal(result.fund.active,false);
  assert.equal(result.fund.amountGBPTarget,1000);assert.equal(result.fund.amountGBPRaised,125);
  assert.equal(result.fund.closesAt,1799999999000+30*86400000);
});
