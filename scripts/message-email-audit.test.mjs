import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../functions/utils/verifyMessage.js', import.meta.url), 'utf8');

// Privacy regression tests against the actual verifier with synthetic records.
// No Firebase credentials, network calls or production data are used.
async function verify({ previousEmails, messageEmails, reprocessing = false } = {}) {
  const writes = [], authReads = [], authUpdates = [], errors = [];
  const previous = {
    name: 'Synthetic user', serverTimestamp: { seconds: 1799999999 },
    verifiedTimestamp: { seconds: 1799999999 }, wallet: { balance: 0 },
    ...(previousEmails === undefined ? {} : { emails: previousEmails })
  };
  const snapshot = docs => ({ docs, forEach: fn => docs.forEach(fn) });
  let committed = false;
  const db = {
    batch: () => ({ update: (path, fields) => writes.push({ path, fields }), commit: async () => { committed = true; } }),
    doc: path => path,
    collection: () => {
      const conditions = [];
      const query = {
        where: (...args) => { conditions.push(args); return query; },
        orderBy: () => query, limit: () => query,
        get: async () => snapshot(conditions.some(([field, , value]) => field === 'user' && value === 'synthetic-user')
          ? [{ id: 'previous', data: () => previous }] : [])
      };
      return query;
    }
  };
  const auth = {
    getUser: async uid => { authReads.push(uid); return { toJSON: () => ({ email: 'current@example.test' }) }; },
    updateUser: async (uid, data) => { authUpdates.push({ uid, data }); }
  };
  const admin = {
    auth: () => auth,
    firestore: Object.assign(() => db, { FieldValue: { arrayUnion: value => [value], serverTimestamp: () => 'server-time' } })
  };
  const imports = { 'firebase-admin': admin, 'firebase-admin/firestore': { getFirestore: () => db }, './createMessage': {} };
  const module = { exports: {} };
  runInNewContext(source, {
    module, require: name => imports[name] || require('../functions/utils/' + name),
    console: { log: message => errors.push(message) }
  });
  await module.exports.verifyMessage('audited', {
    user: 'synthetic-user', chain: 'synthetic-chat', name: 'Synthetic user', text: 'Hello',
    serverTimestamp: { seconds: 1800000000 }, verified: reprocessing,
    ...(messageEmails === undefined ? {} : { emails: messageEmails })
  }, { reprocessing });
  assert.deepEqual(errors, [], 'verifier must finish rather than swallow a fixture error');
  assert.equal(committed, true);
  return { emailWrites: writes.filter(write => Object.hasOwn(write.fields, 'emails')), authReads, authUpdates };
}

test('ordinary chat does not inherit a historical authentication email', async () => {
  const result = await verify({ previousEmails: { auth: 'previous@example.test' } });
  assert.deepEqual(result.emailWrites, []);
  assert.deepEqual(result.authReads, []);
  assert.deepEqual(result.authUpdates, []);
});

test('missing email history and deleted Auth accounts do not require an Auth lookup', async () => {
  const result = await verify();
  assert.deepEqual(result.emailWrites, []);
  assert.deepEqual(result.authReads, []);
});

test('daily reprocessing never restores email fields', async () => {
  const result = await verify({ previousEmails: { auth: 'previous@example.test' }, reprocessing: true });
  assert.deepEqual(result.emailWrites, []);
  assert.deepEqual(result.authReads, []);
  assert.deepEqual(result.authUpdates, []);
});

test('legacy email commands never mutate Auth or propagate email, including on reprocessing', async () => {
  for (const reprocessing of [false, true]) {
    const result = await verify({ previousEmails: { auth: 'previous@example.test' }, messageEmails: { auth: 'requested@example.test' }, reprocessing });
    assert.deepEqual(result.emailWrites, []);
    assert.deepEqual(result.authReads, []);
    assert.deepEqual(result.authUpdates, []);
  }
});
