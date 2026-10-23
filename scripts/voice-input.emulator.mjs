import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(host || '', /^(localhost|127\.0\.0\.1):\d+$/, 'A local Firestore emulator is required; never use production.');
const require = createRequire(import.meta.url), admin = require('firebase-admin');
const projectId = 'demo-voice-input', app = admin.initializeApp({ projectId, storageBucket: projectId + '.appspot.com' }), db = app.firestore();
process.env.OPENAI_API_KEY = 'emulator-fake-key';
process.env.VOICE_TRANSCRIPTION_MODEL = 'gpt-transcribe';
process.env.VOICE_INPUT_HIGH_LIMIT_UID = 'quota-admin';
const { voiceInput } = require('../functions/voiceInput.f.js');
const { voiceInputStatus } = require('../functions/voiceInputStatus.f.js');
const { processVoiceInput } = require('../functions/utils/voiceInput');
const originalFetch = globalThis.fetch;
let providerCalls = 0;
globalThis.fetch = (url, options) => {
  if (url === 'https://api.openai.com/v1/audio/transcriptions') {
    providerCalls++; assert.equal(options.headers.Authorization, 'Bearer emulator-fake-key');
    return Promise.resolve({ ok: true, json: async () => ({ text: 'Bonjour, Nürburgring.' }) });
  }
  return originalFetch(url, options);
};
after(async () => { globalThis.fetch = originalFetch; await db.terminate(); await app.delete(); });
const audio = Buffer.alloc(32044);
audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28);
audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(32000, 40);
for (let i = 44; i < audio.length; i += 2) audio.writeInt16LE(Math.round(3000 * Math.sin(i * .2)), i);
const request = () => ({ requestId: randomUUID(), sourcePage: '/prototypes/voice-input', audio: audio.toString('base64') });
const invoke = (data, uid = 'alice') => voiceInput.run({ data, auth: uid ? { uid, token: {} } : undefined });
const status = (requestId, uid = 'alice') => voiceInputStatus.run({ data: { requestId }, auth: uid ? { uid, token: {} } : undefined });
const options = changes => ({ model: 'test-model', timestamp: () => admin.firestore.FieldValue.serverTimestamp(), transcribe: async () => 'Test', ...changes });
const code = value => error => error.code === value;
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

test('actual handler persists server timestamps, returns only saved result, and replays without provider work', async () => {
  const input = request(), response = await invoke(input), saved = (await db.doc('VoiceInputEvents/' + response.eventId).get()).data();
  assert.equal(response.transcript, 'Bonjour, Nürburgring.'); assert.deepEqual(Object.keys(response).sort(), ['eventId', 'transcript']);
  assert.equal(saved.status, 'completed'); assert.equal(saved.userId, 'alice');
  assert.ok(saved.createdAt.toMillis() > 0); assert.ok(saved.completedAt.toMillis() > 0); assert.ok(!saved.audio);
  assert.equal(saved.durationMs, 1000); assert.equal(saved.model, 'gpt-transcribe');
  const before = providerCalls; assert.deepEqual(await invoke(input), response); assert.equal(providerCalls, before);
  const bob = await invoke(input, 'bob'); assert.notEqual(bob.eventId, response.eventId);
  assert.equal((await db.doc('VoiceInputEvents/' + bob.eventId).get()).data().userId, 'bob');
  await assert.rejects(invoke(input, null), code('unauthenticated'));
});
test('rules permit only owner event get and deny lists, descendants, counters and all client writes', async () => {
  for (const collection of ['VoiceInputEvents', 'VoiceInputLimits']) {
    await db.doc(collection + '/rule-fixture').set({ userId: 'alice', transcript: 'Private' });
    await db.doc(collection + '/rule-fixture/nested/child').set({ userId: 'alice' });
    for (const [uid, claims] of [[undefined, {}], ['alice', {}], ['bob', {}], ['admin', { perrinnAdmin: true }]]) {
      for (const path of [collection + '/rule-fixture', collection + '/rule-fixture/nested/child'])
        for (const method of ['GET', 'PATCH', 'DELETE']) assert.equal((await access(path, uid, method, claims)).status, collection === 'VoiceInputEvents' && path === collection + '/rule-fixture' && method === 'GET' && uid === 'alice' ? 200 : 403, `${uid}: ${method} ${path}`);
      assert.equal((await access(collection + '/new-document', uid, 'PATCH', claims)).status, 403);
      assert.equal((await access(collection + '?pageSize=1', uid, 'GET', claims)).status, 403);
    }
  }
  // Existing public access and telemetry sign-in behavior stay intact.
  await db.doc('PERRINNMessages/public-voice-rules-test').set({ text: 'Public' });
  await db.doc('GreenpowerTelemetry/voice-rules-test').set({ name: 'Telemetry' });
  assert.equal((await access('PERRINNMessages/public-voice-rules-test')).status, 200);
  assert.equal((await access('GreenpowerTelemetry/voice-rules-test')).status, 403);
  assert.equal((await access('GreenpowerTelemetry/voice-rules-test', 'alice')).status, 200);
});
test('status callable recovers only the caller result without writes, quota changes or provider calls', async () => {
  const input = request(), response = await invoke(input);
  const eventRef = db.doc('VoiceInputEvents/' + response.eventId), limitRef = db.doc('VoiceInputLimits/alice');
  const beforeEvent = await eventRef.get(), beforeLimit = await limitRef.get(), beforeCalls = providerCalls;
  assert.deepEqual(await status(input.requestId), { status: 'completed', ...response });
  assert.deepEqual(await status(input.requestId, 'status-other-user'), { status: 'missing' });
  await assert.rejects(status(input.requestId, null), code('unauthenticated'));
  await assert.rejects(voiceInputStatus.run({ data: { requestId: input.requestId, userId: 'alice' }, auth: { uid: 'bob' } }), code('invalid-argument'));
  assert.equal((await eventRef.get()).updateTime.toMillis(), beforeEvent.updateTime.toMillis());
  assert.equal((await limitRef.get()).updateTime.toMillis(), beforeLimit.updateTime.toMillis());
  assert.equal(providerCalls, beforeCalls);
  await eventRef.update({ status: 'processing', createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - 180000) });
  assert.deepEqual(await status(input.requestId), { status: 'stalled' });
  await eventRef.update({ status: 'failed' }); assert.deepEqual(await status(input.requestId), { status: 'failed' });
});
test('real concurrent transactions allow one active transcription and prevent duplicate calls', async () => {
  const uid = 'concurrent', input = request(); let calls = 0, finish;
  const settings = options({ transcribe: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const first = processVoiceInput(db, { uid }, input, settings);
  for (let attempt = 0; !finish && attempt < 500; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(finish, 'Provider work must start within five seconds.');
  await assert.rejects(processVoiceInput(db, { uid }, input, settings), code('aborted'));
  await assert.rejects(processVoiceInput(db, { uid }, request(), settings), code('resource-exhausted'));
  finish('Complete'); const response = await first;
  assert.deepEqual(await processVoiceInput(db, { uid }, input, settings), response); assert.equal(calls, 1);
  assert.equal((await db.doc('VoiceInputLimits/' + uid).get()).data().count, 1);
});
test('daily cap and failed requests remain replay safe under real Firestore transactions', async () => {
  const now = Date.now(), day = new Date(now).toISOString().slice(0, 10), uid = 'daily';
  await db.doc('VoiceInputLimits/' + uid).set({ day, count: 20, activeUntil: 0 });
  await assert.rejects(processVoiceInput(db, { uid }, request(), options({ now: () => now })), code('resource-exhausted'));
  const uid2 = 'failure', input = request(); let calls = 0;
  const failed = options({ transcribe: async () => { calls++; throw Error('PRIVATE PROVIDER FAILURE'); } });
  await assert.rejects(processVoiceInput(db, { uid: uid2 }, input, failed), error => error.code === 'internal' && !error.message.includes('PRIVATE'));
  await assert.rejects(processVoiceInput(db, { uid: uid2 }, input, failed), code('failed-precondition'));
  assert.equal(calls, 1); assert.equal((await db.doc('VoiceInputLimits/' + uid2).get()).data().activeUntil, 0);
});


test('callable forwards structured quota details and restricts configured admin exception', async () => {
  const day = new Date().toISOString().slice(0, 10);
  const uid = 'quota-admin';
  await db.doc('VoiceInputLimits/' + uid).set({ day, count: 20, activeUntil: 0 });
  await assert.rejects(voiceInput.run({ data: request(), auth: { uid, token: {} } }),
    error => error.code === 'resource-exhausted' && error.details.reason === 'daily-limit' && error.details.dailyLimit === 20);
  const response = await voiceInput.run({ data: request(), auth: { uid, token: { perrinnAdmin: true } } });
  assert.equal(response.transcript, 'Bonjour, Nürburgring.');
  assert.equal((await db.doc('VoiceInputLimits/' + uid).get()).data().count, 21);
  await db.doc('VoiceInputLimits/' + uid).update({ count: 1000 });
  const before = providerCalls;
  await assert.rejects(voiceInput.run({ data: request(), auth: { uid, token: { perrinnAdmin: true } } }),
    error => error.code === 'resource-exhausted' && error.details.reason === 'daily-limit' && error.details.dailyLimit === 1000);
  assert.equal(providerCalls, before);
  await db.doc('VoiceInputLimits/' + uid).update({ count: 21, activeUntil: Date.now() + 90000 });
  await assert.rejects(voiceInput.run({ data: request(), auth: { uid, token: { perrinnAdmin: true } } }),
    error => error.code === 'resource-exhausted' && error.details.reason === 'recording-processing');
});

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
test('durable inbox uses real Firestore and Storage, survives lost receipt, and processes without a client', async () => {
  const data = { ...request(), owner: 'inbox-owner' }, tasks = new Map(); let calls = 0;
  const settings = options({ enqueue: async (data, config) => { tasks.set(config.id, data); }, transcribe: async () => { calls++; return 'Durable result'; } });
  const receipt = await enqueueVoiceInput(db, bucket, { uid: data.owner }, data, settings);
  assert.deepEqual(await enqueueVoiceInput(db, bucket, { uid: data.owner }, data, settings), receipt);
  assert.equal(tasks.size, 1); assert.equal((await db.doc('VoiceInputLimits/' + data.owner).get()).data().count, 1);
  const ref = db.doc('VoiceInputEvents/' + receipt.eventId), event = (await ref.get()).data();
  assert.equal(event.status, 'queued'); assert.equal((await bucket.file(event.audioPath).download())[0].length, audio.length);
  assert.equal((await access(ref.path, data.owner)).status, 200); assert.equal((await access(ref.path, 'bob')).status, 403);
  await processVoiceInbox(db, bucket, { eventId: receipt.eventId }, settings);
  await processVoiceInbox(db, bucket, { eventId: receipt.eventId }, settings);
  assert.equal(calls, 1); assert.equal((await ref.get()).data().transcript, 'Durable result');
  assert.equal((await bucket.file(event.audioPath).exists())[0], false);
});

test('shared pilot publishes one message and rules isolate history to exactly two participants', async () => {
  const { VOICE_ADMIN, VOICE_PARTICIPANT } = require('../functions/utils/voiceConversation');
  const data = { ...request(), owner: VOICE_PARTICIPANT, conversationId: 'pilot' };
  let calls = 0;
  const settings = options({ enqueue: async () => {}, transcribe: async () => { calls++; return 'Shared result'; } });
  const receipt = await enqueueVoiceInput(db, bucket, { uid: data.owner, token: { name: 'Pilot participant' } }, data, settings);
  await processVoiceInbox(db, bucket, { eventId: receipt.eventId }, settings);
  await processVoiceInbox(db, bucket, { eventId: receipt.eventId }, settings);
  const path = `VoiceConversations/pilot/messages/${receipt.eventId}`, message = (await db.doc(path).get()).data();
  assert.equal(calls, 1); assert.equal(message.text, 'Shared result'); assert.equal(message.requestId, data.requestId);
  assert.equal(message.authorName, 'Pilot participant'); assert.ok(message.createdAt.toMillis() > 0);
  await db.doc('VoiceConversations/other/messages/hidden').set(message);
  await db.doc(path + '/nested/hidden').set(message);
  for (const [uid, claims, allowed] of [[undefined, {}, false], [VOICE_PARTICIPANT, {}, true],
    [VOICE_ADMIN, { perrinnAdmin: true }, true], [VOICE_ADMIN, {}, false], ['sPJhQ9lcLRgdKcIitszQp4oi7M23', {}, false], ['outsider', {}, false], ['other-admin', { perrinnAdmin: true }, false]]) {
    assert.equal((await access(path, uid, 'GET', claims)).status, allowed ? 200 : 403);
    for (const method of ['PATCH', 'DELETE']) assert.equal((await access(path, uid, method, claims)).status, 403);
    assert.equal((await access('VoiceConversations/pilot/messages/new', uid, 'PATCH', claims)).status, 403);
    assert.equal((await access('VoiceConversations/pilot', uid, 'GET', claims)).status, 403);
    assert.equal((await access('VoiceConversations/other/messages/hidden', uid, 'GET', claims)).status, 403);
    assert.equal((await access(path + '/nested/hidden', uid, 'GET', claims)).status, 403);
    for (const limit of [undefined, 50, 51]) {
      const response = await originalFetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents/VoiceConversations/pilot:runQuery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${token(uid, claims)}` } : {}) },
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'messages' }],
          orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }], ...(limit ? { limit } : {}) } })
      });
      assert.equal(response.status, allowed && limit === 50 ? 200 : 403, `${uid}: list limit ${limit}`);
    }
  }
  // Existing private events still cannot be read by the other pilot participant.
  assert.equal((await access('VoiceInputEvents/' + receipt.eventId, VOICE_ADMIN, 'GET', { perrinnAdmin: true })).status, 403);
});


test('private playback callable serves retained audio, atomically claims one device, and denies other accounts', async () => {
  const { VOICE_ADMIN, VOICE_PARTICIPANT } = require('../functions/utils/voiceConversation');
  const { voicePlayback } = require('../functions/voicePlayback.f.js');
  const data = { ...request(), owner: VOICE_PARTICIPANT, conversationId: 'pilot' };
  const settings = options({ enqueue: async () => {}, transcribe: async () => 'Playable result' });
  const receipt = await enqueueVoiceInput(db, bucket, { uid: data.owner }, data, settings);
  await processVoiceInbox(db, bucket, { eventId: receipt.eventId }, settings);
  const payload = { eventId: receipt.eventId, automatic: true }, auth = { uid: VOICE_ADMIN, token: { perrinnAdmin: true } };
  for (const denied of [undefined, { uid: 'outsider' }, { uid: VOICE_ADMIN, token: {} }]) {
    await assert.rejects(voicePlayback.run({ data: payload, auth: denied }), e => e.code === 'permission-denied');
  }
  const results = await Promise.all([voicePlayback.run({ data: payload, auth }), voicePlayback.run({ data: payload, auth })]);
  assert.equal(results.filter(r => r.skipped).length, 1); assert.equal(results.filter(r => r.audio).length, 1);
  const manual = await voicePlayback.run({ data: { ...payload, automatic: false }, auth: { uid: VOICE_PARTICIPANT } });
  assert.deepEqual(Buffer.from(manual.audio, 'base64'), audio);
  const ref = db.doc('VoiceInputEvents/' + receipt.eventId), event = (await ref.get()).data();
  assert.ok(event.audioAutoClaimedAt); assert.ok(event.audioExpiresAt > Date.now());
  assert.equal((await storageAccess(event.audioPath, VOICE_PARTICIPANT)).status, 403);
  assert.equal((await storageAccess(event.audioPath, VOICE_ADMIN)).status, 403);
  await ref.update({ audioExpiresAt: Date.now() - 1 });
  await assert.rejects(voicePlayback.run({ data: { ...payload, automatic: false }, auth }), e => e.code === 'not-found');
});
