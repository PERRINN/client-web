import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(host || '', /^(localhost|127\.0\.0\.1):\d+$/, 'A local Firestore emulator is required; never use production.');
const require = createRequire(import.meta.url), admin = require('firebase-admin');
const projectId = 'demo-voice-input', app = admin.initializeApp({ projectId }), db = app.firestore();
process.env.OPENAI_API_KEY = 'emulator-fake-key';
process.env.VOICE_TRANSCRIPTION_MODEL = 'gpt-transcribe';
const { voiceInput } = require('../functions/voiceInput.f.js');
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
test('rules deny event/counter get, list, create, update and delete to anonymous, owner, other users and admins', async () => {
  for (const collection of ['VoiceInputEvents', 'VoiceInputLimits']) {
    await db.doc(collection + '/rule-fixture').set({ userId: 'alice', transcript: 'Private' });
    await db.doc(collection + '/rule-fixture/nested/child').set({ userId: 'alice' });
    for (const [uid, claims] of [[undefined, {}], ['alice', {}], ['bob', {}], ['admin', { perrinnAdmin: true }]]) {
      for (const path of [collection + '/rule-fixture', collection + '/rule-fixture/nested/child'])
        for (const method of ['GET', 'PATCH', 'DELETE']) assert.equal((await access(path, uid, method, claims)).status, 403, `${uid}: ${method} ${path}`);
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
