import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(host || '', /^(localhost|127\.0\.0\.1):\d+$/, 'A local Firestore emulator is required; never use production.');
const require = createRequire(import.meta.url), admin = require('firebase-admin');
const projectId = 'demo-voice-input', app = admin.initializeApp({ projectId, storageBucket: projectId + '.appspot.com' }), db = app.firestore();
const originalFetch = globalThis.fetch;
after(async () => { await db.terminate(); await app.delete(); });
const audio = Buffer.alloc(32044);
audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28);
audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(32000, 40);
for (let i = 44; i < audio.length; i += 2) audio.writeInt16LE(Math.round(3000 * Math.sin(i * .2)), i);
const request = () => ({ requestId: randomUUID(), sourcePage: '/chat', audio: audio.toString('base64') });
const options = changes => ({ model: 'test-model', timestamp: () => admin.firestore.FieldValue.serverTimestamp(), transcribe: async () => 'Test', ...changes });
function token(uid, claims = {}) {
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url'), now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims, sub: uid, user_id: uid, aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`, iat: now, exp: now + 3600,
    firebase: { sign_in_provider: 'custom', identities: {} } })}.`;
}
async function access(path, uid, method = 'GET', claims = {}) {
  return originalFetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents/${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${token(uid, claims)}` } : {}) },
    ...(method === 'PATCH' ? { body: JSON.stringify({ fields: { transcript: { stringValue: 'tampered' } } }) } : {})
  });
}

const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
assert.match(storageHost || '', /^(localhost|127\.0\.0\.1):\d+$/, 'Local Storage emulator is required.');
const bucket = app.storage().bucket(projectId + '.appspot.com');
const { enqueueVoiceInput, processVoiceInbox } = require('../functions/utils/voiceInbox');
async function storageAccess(path, uid, method = 'GET') {
  return originalFetch(`http://${storageHost}/v0/b/${bucket.name}/o/${encodeURIComponent(path)}${method === 'GET' ? '?alt=media' : ''}`, {
    method, headers: { ...(uid ? { Authorization: `Bearer ${token(uid)}` } : {}), 'Content-Type': 'audio/wav' },
    ...(method === 'POST' ? { body: audio } : {})
  });
}
test('private Storage prefix denies owner/other/anonymous reads and writes; legacy object policy is preserved', async () => {
  for (const path of ['voice-input/alice/private.wav', 'voice-input', 'public-root.wav', 'existing/nested.wav']) {
    await bucket.file(path).save(audio, { resumable: false });
    for (const uid of [undefined, 'alice', 'bob']) {
      const privatePath = path.split('/')[0] === 'voice-input';
      assert.equal((await storageAccess(path, uid)).status, privatePath ? 403 : 200, `${path}: read ${uid}`);
      assert.equal((await storageAccess(path, uid, 'DELETE')).status, privatePath || !uid ? 403 : 204, `${path}: delete ${uid}`);
      if (!privatePath && uid) await bucket.file(path).save(audio, { resumable: false });
    }
  }
});

function ruleValue(value) {
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'string') return { stringValue: value };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, ruleValue(entry)])) } };
}
async function createChatCommand(fields, uid, claims = {}) {
  const name = `projects/${projectId}/databases/(default)/documents/PERRINNMessages/rules-${randomUUID()}`;
  return originalFetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents:commit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${token(uid, claims)}` } : {}) },
    body: JSON.stringify({ writes: [{ update: { name, fields: Object.fromEntries(Object.entries({ user: uid || 'anonymous', chain: 'voice-chat', text: 'Chat update', ...fields }).map(([key, value]) => [key, ruleValue(value)])) },
      updateTransforms: [{ fieldPath: 'serverTimestamp', setToServerValue: 'REQUEST_TIME' }] }] })
  });
}
test('production rules restrict mode changes to admins, reject forged voice records and retain typed limits', async () => {
  assert.equal((await createChatCommand({}, 'alice')).status, 200);
  for (const mode of ['text', 'voice']) {
    for (const uid of [undefined, 'alice', 'bob']) assert.equal((await createChatCommand({ chatInputMode: mode }, uid)).status, 403);
    assert.equal((await createChatCommand({ chatInputMode: mode }, 'admin', { perrinnAdmin: 'true' })).status, 403);
    assert.equal((await createChatCommand({ chatInputMode: mode }, 'admin', { perrinnAdmin: true })).status, 200);
  }
  assert.equal((await createChatCommand({ chatInputMode: 'other' }, 'admin', { perrinnAdmin: true })).status, 403);
  for (const uid of ['alice', 'admin']) assert.equal((await createChatCommand({ voice: { eventId: 'forged' } }, uid, { perrinnAdmin: true })).status, 403);
  assert.equal((await createChatCommand({ text: 'a'.repeat(501) }, 'alice')).status, 403);
  assert.equal((await createChatCommand({ verified: false }, 'alice')).status, 200);
  for (const uid of ['alice', 'admin']) for (const fields of [{ verified: true }, { verifiedTimestamp: 'forged' }, { lastMessage: true }, { lastMessage: false }]) {
    assert.equal((await createChatCommand(fields, uid, { perrinnAdmin: true })).status, 403);
  }
});
test('production inbox and recipient playback use real transactions and private stored audio', async () => {
  const chain = 'production-' + randomUUID();
  const state = db.collection('PERRINNMessages').doc();
  await state.set({ chain, chatInputMode: 'voice', verified: true, recipientList: ['voice-speaker', 'voice-listener'], serverTimestamp: admin.firestore.FieldValue.serverTimestamp() });
  const data = { ...request(), sourcePage: '/chat', owner: 'voice-speaker', conversationId: 'chat:' + chain };
  const settings = options({ enqueue: async () => {}, transcribe: async () => 'Full transcript. '.repeat(60) });
  const receipt = await enqueueVoiceInput(db, bucket, { uid: data.owner }, data, settings);
  await processVoiceInbox(db, bucket, { eventId: receipt.eventId }, settings);
  const messageRef = db.doc('PERRINNMessages/voice-' + receipt.eventId), message = (await messageRef.get()).data();
  assert.ok(message.text.length > 500); assert.equal(message.user, 'voice-speaker'); assert.equal(message.chain, chain);
  assert.equal(message.voice.transcription, 'completed'); assert.equal(message.isBackendMessage, undefined);
  const { voicePlayback } = require('../functions/voicePlayback.f.js');
  const payload = { eventId: receipt.eventId, automatic: false };
  const play = uid => voicePlayback.run({ data: payload, auth: uid ? { uid } : undefined });
  assert.deepEqual(Buffer.from((await play('voice-listener')).audio, 'base64'), audio);
  await assert.rejects(play('outsider'), e => e.code === 'permission-denied');
  await assert.rejects(play(null), e => e.code === 'unauthenticated');
  await state.update({ recipientList: ['voice-speaker', 'new-listener'] });
  await assert.rejects(play('voice-listener'), e => e.code === 'permission-denied');
  assert.ok((await play('new-listener')).audio);
  const path = 'voice-input/voice-speaker/' + receipt.eventId + '.wav';
  for (const uid of [undefined, 'voice-speaker', 'new-listener', 'outsider']) assert.equal((await storageAccess(path, uid)).status, 403);
  assert.equal((await access(messageRef.path)).status, 200);
  await db.doc('VoiceInputEvents/' + receipt.eventId).update({ audioExpiresAt: Date.now() - 1 });
  await assert.rejects(play('new-listener'), e => e.code === 'not-found');
  assert.ok((await messageRef.get()).data().voice);
});

test('retired pilot history denies anonymous, former participants, other users and admins', async () => {
  const path = 'VoiceConversations/pilot/messages/retired';
  await db.doc(path).set({ text: 'Private retained history' });
  for (const [uid, claims] of [[undefined, {}], ['xDfdZLLRHuObIUNEUj8SdClxZXf2', {}], ['sks8zpXOy7ZBzhOIx1ISjtNgegh1', {}], ['other', {}], ['QYm5NATKa6MGD87UpNZCTl6IolX2', { perrinnAdmin: true }]]) {
    assert.equal((await access(path, uid, 'GET', claims)).status, 403);
    assert.equal((await access(path, uid, 'PATCH', claims)).status, 403);
  }
});
