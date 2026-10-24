import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

function fixture() {
  const writes = [];
  const timestamp = { serverTimestamp: true };
  const result = { id: 'created' };
  const module = { exports: {} };
  runInNewContext(readFileSync(new URL('../functions/utils/createMessage.js', import.meta.url), 'utf8'), {
    module, console,
    require: name => {
      assert.equal(name, 'firebase-admin/firestore');
      return {
        FieldValue: { serverTimestamp: () => timestamp },
        getFirestore: () => ({ collection: path => {
          assert.equal(path, 'PERRINNMessages');
          return { add: async message => { writes.push(message); return result; } };
        } })
      };
    }
  });
  return { create: module.exports.createMessageAFS, writes, timestamp, result };
}

test('backend writes System exactly once on the final line and preserves message fields', async () => {
  const f = fixture();
  for (const [text, expected] of [
    ['Update', 'Update\n(System)'],
    ['Update\nDetails\n', 'Update\nDetails\n(System)'],
    ['Update (Backend message)', 'Update\n(System)'],
    ['Update\n(System)', 'Update\n(System)'],
    ['Update (System) ', 'Update\n(System)'],
    ['Discuss (Backend message) here', 'Discuss (Backend message) here\n(System)'],
    ['', '(System)']
  ]) {
    const message = { text, user: 'author', chain: 'updates', purchaseCOIN: { amount: 20 } };
    assert.equal(await f.create(message), f.result);
    assert.equal(f.writes.at(-1).text, expected);
    assert.equal(message.user, 'author');
    assert.equal(message.chain, 'updates');
    assert.deepEqual(message.purchaseCOIN, { amount: 20 });
    assert.equal(message.isBackendMessage, true);
    assert.equal(message.serverTimestamp, f.timestamp);
  }
});

test('messages without text keep their payload and receive a generated chain', async () => {
  const f = fixture();
  const message = { user: 'author' };
  await f.create(message);
  assert.equal('text' in message, false);
  assert.match(message.chain, /^[A-Za-z0-9]{20}$/);
  assert.equal(f.writes.length, 1);
});
