import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { enqueueVoiceInput, processVoiceInbox, failExhaustedInbox, eventIdFor } = require('../functions/utils/voiceInbox');
const { VoiceInputError } = require('../functions/utils/voiceAudio');
export function audio() {
  const b = Buffer.alloc(32044); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(32000, 40);
  for (let i = 44; i < b.length; i += 2) b.writeInt16LE(Math.round(3000 * Math.sin(i)), i);
  return b;
}
export const input = (changes = {}) => ({ requestId: randomUUID(), sourcePage: '/chat', conversationId: 'chat:engineering', audio: audio().toString('base64'), owner: 'alice', ...changes });
function fixture() {
  const records = new Map(), blobs = new Map(), tasks = new Map(), counts = { reads: 0, writes: 0, provider: 0, saves: 0, downloads: 0 };
  let chain = Promise.resolve(), now = Date.now();
  const db = { records, collection: name => {
    assert.equal(name, 'PERRINNMessages'); const filters = [];
    const query = { where: (...args) => { filters.push(args); return query; }, orderBy: (field, order) => {
      assert.equal(field, 'serverTimestamp'); assert.equal(order, 'desc'); return query;
    }, limit: limit => { assert.equal(limit, 1); return query; }, get: async () => {
      counts.reads++;
      const docs = [...records].filter(([path, data]) => path.startsWith('PERRINNMessages/') && filters.every(([field, op, value]) => op === '==' && data[field] === value))
        .sort((a, b) => (b[1].serverTimestamp?.toMillis?.() || 0) - (a[1].serverTimestamp?.toMillis?.() || 0)).slice(0, 1).map(([, data]) => ({ data: () => data }));
      return { docs, empty: !docs.length };
    } }; return query;
  }, doc: path => ({ path }), runTransaction(fn, settings) {
    assert.equal(settings.maxAttempts, 3);
    const pending = chain.then(async () => {
      const changes = [], tx = {
        get: async ref => { if (ref.get) return ref.get(); counts.reads++; return { exists: records.has(ref.path), data: () => records.get(ref.path) }; },
        create: (ref, data) => { assert.ok(!records.has(ref.path)); changes.push([ref.path, data]); },
        set: (ref, data) => changes.push([ref.path, data]),
        update: (ref, data) => { assert.ok(records.has(ref.path)); changes.push([ref.path, { ...records.get(ref.path), ...data }]); }
      };
      const result = await fn(tx); for (const [path, data] of changes) { records.set(path, data); counts.writes++; } return result;
    });
    chain = pending.catch(() => {}); return pending;
  } };
  const bucket = { file: path => ({
    save: async (bytes, options) => {
      counts.saves++; assert.equal(options.preconditionOpts.ifGenerationMatch, 0);
      if (blobs.has(path)) throw Object.assign(Error('Exists'), { code: 412 });
      blobs.set(path, { bytes: Buffer.from(bytes), options });
    },
    getMetadata: async () => { const blob = blobs.get(path); if (!blob) throw Error('Missing'); return [{ size: blob.bytes.length, metadata: blob.options.metadata.metadata }]; },
    download: async options => { assert.deepEqual(options, { start: 0, end: 960044 }); counts.downloads++; return [blobs.get(path).bytes]; },
    delete: async () => { blobs.delete(path); }
  }) };
  const options = {
    now: () => now, timestamp: () => ({ toMillis: () => now }), model: 'test-model',
    enqueue: async (data, settings) => {
      assert.equal(settings.id, data.eventId); assert.equal(settings.dispatchDeadlineSeconds, 90);
      if (tasks.has(settings.id)) throw Object.assign(Error('Exists'), { code: 'functions/task-already-exists' });
      tasks.set(settings.id, data);
    },
    transcribe: async (_audio, model) => { assert.equal(model, 'test-model'); counts.provider++; return 'Saved transcript'; }
  };
  records.set('PERRINNMessages/chat-state', { chain: 'engineering', verified: true, chatInputMode: 'voice', recipientList: ['alice', 'bob'], serverTimestamp: options.timestamp() });
  return { db, bucket, records, blobs, tasks, counts, options, advance: ms => { now += ms; },
    enqueue: (data = input(), auth = { uid: data.owner }) => enqueueVoiceInput(db, bucket, auth, data, options),
    process: (eventId, changes = {}) => processVoiceInbox(db, bucket, { eventId }, { ...options, ...changes }) };
}
const eventPath = id => 'VoiceInputEvents/' + id;

test('enqueue authorizes owner, validates audio and does no work for rejected requests', async () => {
  const f = fixture(), data = input();
  await assert.rejects(f.enqueue(data, null), e => e.code === 'unauthenticated');
  await assert.rejects(f.enqueue(data, { uid: 'bob' }), e => e.code === 'permission-denied');
  await assert.rejects(f.enqueue({ ...data, audio: 'bad' }), e => e.code === 'invalid-argument');
  assert.equal(f.counts.reads, 0); assert.equal(f.blobs.size, 0); assert.equal(f.tasks.size, 0);
});
test('durable receipt requires audio, event and deduplicated task; replays do not consume allowance twice', async () => {
  const f = fixture(), data = input(), receipt = await f.enqueue(data);
  assert.equal(receipt.eventId, eventIdFor('alice', data.requestId)); assert.equal(receipt.status, 'queued');
  assert.equal(f.records.get(eventPath(receipt.eventId)).status, 'queued'); assert.equal(f.blobs.size, 1); assert.equal(f.tasks.size, 1);
  assert.deepEqual(await f.enqueue(data), receipt); assert.equal(f.tasks.size, 1);
  assert.equal(f.records.get('VoiceInputLimits/alice').count, 1); assert.equal(f.counts.provider, 0);
});
test('an enqueue acknowledgement or task-creation failure retains a replayable durable inbox', async () => {
  const f = fixture(), data = input(), enqueue = f.options.enqueue; let fail = true;
  f.options.enqueue = (...args) => fail ? Promise.reject(Error('Task unavailable')) : enqueue(...args);
  await assert.rejects(f.enqueue(data)); assert.equal(f.blobs.size, 1); assert.equal(f.tasks.size, 0);
  fail = false; const receipt = await f.enqueue(data); assert.equal(receipt.status, 'queued'); assert.equal(f.tasks.size, 1);
  assert.equal(f.records.get('VoiceInputLimits/alice').count, 1);
});
test('storage failure keeps the same reservation and retry cannot bypass quota or change the audio', async () => {
  const f = fixture(), data = input(), original = f.bucket.file; let fail = true;
  f.bucket.file = path => { const file = original(path); return { ...file, save: (...args) => fail ? Promise.reject(Error('Storage unavailable')) : file.save(...args) }; };
  await assert.rejects(f.enqueue(data)); assert.equal(f.tasks.size, 0);
  fail = false; const receipt = await f.enqueue(data); assert.equal(f.records.get('VoiceInputLimits/alice').count, 1);
  const other = audio(); other[50] ^= 1;
  await assert.rejects(f.enqueue({ ...data, audio: other.toString('base64') }), e => e.code === 'invalid-argument');
  assert.equal(f.records.get(eventPath(receipt.eventId)).status, 'queued');
});
test('concurrent submissions share one event, immutable object, task and allowance', async () => {
  const f = fixture(), data = input(); const receipts = await Promise.all([f.enqueue(data), f.enqueue(data)]);
  assert.equal(receipts[0].eventId, receipts[1].eventId); assert.equal(f.tasks.size, 1); assert.equal(f.blobs.size, 1);
  assert.equal(f.records.get('VoiceInputLimits/alice').count, 1);
});
test('worker completes from stored audio after the client is gone; duplicate delivery never retranscribes', async () => {
  const f = fixture(), receipt = await f.enqueue();
  await f.process(receipt.eventId); const event = f.records.get(eventPath(receipt.eventId));
  assert.equal(event.transcript, 'Saved transcript'); assert.equal(event.status, 'completed'); assert.equal(event.attempts, 1);
  assert.equal(f.blobs.size, 1); assert.equal(f.counts.provider, 1);
  await f.process(receipt.eventId); assert.equal(f.counts.provider, 1);
  assert.equal(f.records.get('VoiceInputLimits/alice').activeUntil, 0);
});
test('transient failures are retried automatically but never exceed three provider attempts', async () => {
  const f = fixture(), receipt = await f.enqueue(); let calls = 0;
  const settings = { transcribe: async () => { calls++; throw new VoiceInputError('unavailable', 'Unavailable'); } };
  for (let retryCount = 0; retryCount < 3; retryCount++) {
    const job = f.process(receipt.eventId, { ...settings, retryCount });
    if (retryCount < 2) await assert.rejects(job); else await job;
  }
  assert.equal(calls, 3); assert.equal(f.records.get(eventPath(receipt.eventId)).status, 'completed'); assert.equal(f.blobs.size, 1);
  await f.process(receipt.eventId, settings); assert.equal(calls, 3);
});
test('invalid storage and permanent failures never call the provider or silently lose the stored audio', async () => {
  const f = fixture(), receipt = await f.enqueue(); f.blobs.values().next().value.bytes[50] ^= 1;
  await f.process(receipt.eventId); assert.equal(f.counts.provider, 0);
  assert.equal(f.records.get(eventPath(receipt.eventId)).status, 'failed'); assert.equal(f.blobs.size, 1);
});
test('user lease contention and duplicate worker delivery do not reserve an extra provider attempt', async () => {
  const f = fixture(), receipt = await f.enqueue(); let release;
  const first = f.process(receipt.eventId, { transcribe: () => new Promise(resolve => { release = resolve; }) });
  for (let i = 0; i < 100 && !release; i++) await new Promise(setImmediate);
  assert.ok(release); await assert.rejects(f.process(receipt.eventId)); assert.equal(f.records.get(eventPath(receipt.eventId)).attempts, 1);
  release('Only result'); await first;
  assert.equal(f.records.get(eventPath(receipt.eventId)).transcript, 'Only result');
});
test('last delivery reports failure rather than leaving a queued recording indefinitely', async () => {
  const f = fixture(), receipt = await f.enqueue();
  await failExhaustedInbox(f.db, receipt.eventId, f.options.timestamp);
  assert.equal(f.records.get(eventPath(receipt.eventId)).status, 'failed');
  await f.process(receipt.eventId); assert.equal(f.counts.provider, 0);
});

test('lost completion acknowledgement preserves saved transcript and never repeats provider work', async () => {
  const f = fixture(), receipt = await f.enqueue(), transaction = f.db.runTransaction.bind(f.db); let lost = false;
  f.db.runTransaction = async (...args) => {
    const result = await transaction(...args);
    if (!lost && f.records.get(eventPath(receipt.eventId))?.status === 'completed') { lost = true; throw Error('Lost acknowledgement'); }
    return result;
  };
  await f.process(receipt.eventId); await f.process(receipt.eventId);
  assert.equal(lost, true); assert.equal(f.counts.provider, 1); assert.equal(f.records.get(eventPath(receipt.eventId)).transcript, 'Saved transcript');
});

test('existing image finalizer never publishes private audio or runs image queries for that prefix', async () => {
  const { readFileSync } = require('node:fs'), exports = {}, operations = [];
  const admin = { initializeApp() {}, storage: () => { operations.push('storage'); throw Error('Private publishing'); },
    firestore: () => { operations.push('firestore'); throw Error('Private image query'); } };
  new Function('exports', 'require', readFileSync(new URL('../functions/storageOnFinalise.f.js', import.meta.url), 'utf8'))(
    exports, name => name === 'firebase-admin' ? admin : name === 'firebase-functions/v2/storage' ? { onObjectFinalized: handler => ({ run: handler }) } : require(name));
  await exports.storageOnFinalise.run({ data: { name: 'voice-input/alice/private.wav', bucket: 'demo' } });
  await exports.storageOnFinalise.run({ data: { name: 'voice-input', bucket: 'demo' } });
  assert.deepEqual(operations, []);
});

const { voicePlayback } = require('../functions/utils/voicePlayback');
test('invalid stored audio is never shared and retains the existing failure behavior', async () => {
  const f = fixture(), receipt = await f.enqueue(input());
  f.blobs.values().next().value.bytes[50] ^= 1;
  await f.process(receipt.eventId);
  assert.equal(f.records.get(eventPath(receipt.eventId)).status, 'failed');
  assert.equal(f.records.has('PERRINNMessages/voice-' + receipt.eventId), false);
  await assert.rejects(voicePlayback(f.db, f.bucket, { uid: 'alice' }, { eventId: receipt.eventId, automatic: false }, f.options.now()));
});

const { validateChatInputMode } = require('../functions/utils/chatVoice');
function productionFixture() {
  const f = fixture();
  f.records.set('PERRINNMessages/chat-state', { chain: 'engineering', verified: true, chatInputMode: 'voice', recipientList: ['alice', 'bob'], serverTimestamp: f.options.timestamp() });
  f.request = changes => input({ conversationId: 'chat:engineering', sourcePage: '/chat', ...changes });
  f.message = id => f.records.get('PERRINNMessages/voice-' + id);
  return f;
}
test('production routing requires an authenticated owner, real enabled chat and matching source', async () => {
  const f = productionFixture();
  await assert.rejects(f.enqueue(f.request(), null), e => e.code === 'unauthenticated');
  await assert.rejects(f.enqueue(f.request(), { uid: 'bob' }), e => e.code === 'permission-denied');
  await assert.rejects(f.enqueue(f.request({ sourcePage: '/prototypes/voice-input' })), e => e.code === 'invalid-argument');
  await assert.rejects(f.enqueue(f.request({ conversationId: 'chat:missing' })), e => e.code === 'not-found');
  await assert.rejects(f.enqueue(f.request({ conversationId: 'chat:../private' })), e => e.code === 'invalid-argument');
  f.records.get('PERRINNMessages/chat-state').chatInputMode = 'text';
  await assert.rejects(f.enqueue(f.request()), e => e.code === 'failed-precondition');
  assert.equal(f.counts.saves, 0); assert.equal(f.tasks.size, 0);
});
test('production publishes one full human transcript with trusted recording metadata and no backend label', async () => {
  const f = productionFixture(), data = f.request();
  const receipt = await f.enqueue(data);
  assert.equal(f.message(receipt.eventId), undefined);
  const transcript = 'Full transcription. '.repeat(100);
  await f.process(receipt.eventId, { transcribe: async () => transcript });
  const message = f.message(receipt.eventId), event = f.records.get(eventPath(receipt.eventId));
  assert.equal(message.text, transcript.trim()); assert.ok(message.text.length > 500);
  assert.equal(message.user, 'alice'); assert.equal(message.chain, 'engineering'); assert.equal(message.isBackendMessage, undefined);
  assert.equal(message.voice.eventId, receipt.eventId); assert.equal(message.voice.durationMs, 1000);
  assert.equal(message.voice.expiresAt, event.createdAt.toMillis() + 7 * 86400000);
  assert.equal(message.voice.transcription, 'completed'); assert.equal(message.chatInputMode, undefined);
  assert.ok(f.blobs.size); const writes = f.counts.writes;
  await f.process(receipt.eventId); await f.enqueue(data); assert.equal(f.counts.writes, writes);
  const reused = f.request({ requestId: data.requestId, conversationId: 'chat:other' });
  f.records.set('PERRINNMessages/other-state', { ...f.records.get('PERRINNMessages/chat-state'), chain: 'other' });
  await assert.rejects(f.enqueue(reused), e => e.code === 'invalid-argument');
});
test('transcription exhaustion and final task exhaustion publish one audio-only production message', async () => {
  const f = productionFixture(), { eventId } = await f.enqueue(f.request());
  for (let attempt = 0; attempt < 3; attempt++) {
    const work = f.process(eventId, { transcribe: async () => { throw Error('Provider down'); } });
    if (attempt < 2) { await assert.rejects(work); assert.equal(f.message(eventId), undefined); }
    else await work;
  }
  assert.equal(f.records.get(eventPath(eventId)).status, 'completed');
  assert.equal(f.message(eventId).voice.transcription, 'unavailable'); assert.equal(f.message(eventId).text, '');
  await failExhaustedInbox(f.db, eventId, f.options.timestamp); await f.process(eventId);
  const g = productionFixture(), receipt = await g.enqueue(g.request());
  await assert.rejects(g.process(receipt.eventId, { transcribe: async () => { throw Error('Provider down'); } }));
  await failExhaustedInbox(g.db, receipt.eventId, g.options.timestamp);
  assert.equal(g.message(receipt.eventId).voice.transcription, 'unavailable');
});
test('empty transcription delivers audio; corrupt stored production audio is never published', async () => {
  const f = productionFixture(), receipt = await f.enqueue(f.request());
  await f.process(receipt.eventId, { transcribe: async () => '' });
  assert.equal(f.message(receipt.eventId).voice.transcription, 'unavailable');
  const g = productionFixture(), bad = await g.enqueue(g.request());
  g.blobs.values().next().value.bytes.fill(0);
  await g.process(bad.eventId); assert.equal(g.message(bad.eventId), undefined);
  assert.equal(g.records.get(eventPath(bad.eventId)).status, 'failed');
});
test('production allowance is 100, or 1000 for trusted admins, across chats with free replays', async () => {
  for (const [uid, token, limit] of [['alice', {}, 100], ['admin', {perrinnAdmin:true}, 1000], ['other-admin', {perrinnAdmin:true}, 1000], ['forged-admin', {perrinnAdmin:'true'}, 100], ['numeric-admin', {perrinnAdmin:1}, 100]]) {
    const f = productionFixture(), day = new Date(f.options.now()).toISOString().slice(0, 10);
    f.records.set('PERRINNMessages/other-state', { ...f.records.get('PERRINNMessages/chat-state'), chain: 'other' });
    f.records.set('VoiceInputLimits/' + uid, { day, count: limit - 1 });
    const data = f.request({ owner: uid }), auth = { uid, token };
    await f.enqueue(data, auth); await f.enqueue(data, auth);
    await assert.rejects(f.enqueue(f.request({ owner: uid, conversationId: 'chat:other' }), auth), e => e.details.dailyLimit === limit);
    f.records.get('PERRINNMessages/chat-state').chatInputMode = 'text';
    await f.enqueue(data, auth); // Disabling new input does not invalidate an existing durable receipt.
    f.advance(86400000); f.records.get('PERRINNMessages/chat-state').chatInputMode = 'voice';
    await f.enqueue(f.request({ owner: uid }), auth); assert.equal(f.records.get('VoiceInputLimits/' + uid).count, 1);
  }
});
test('production playback uses current recipients, independent autoplay and seven-day expiry', async () => {
  const f = productionFixture(), receipt = await f.enqueue(f.request()); await f.process(receipt.eventId);
  const play = (uid, automatic = false) => voicePlayback(f.db, f.bucket, uid ? { uid } : null, { eventId: receipt.eventId, automatic }, f.options.now());
  await assert.rejects(play(null), e => e.code === 'unauthenticated');
  await assert.rejects(play('outsider'), e => e.code === 'permission-denied');
  assert.deepEqual(await play('alice', true), { skipped: true });
  assert.ok((await play('bob', true)).audio);
  f.records.get('PERRINNMessages/chat-state').recipientList.push('carol');
  assert.ok((await play('carol', true)).audio); assert.ok((await play('carol', false)).audio);
  f.records.get('PERRINNMessages/chat-state').recipientList = ['alice']; const downloads = f.counts.downloads;
  await assert.rejects(play('bob'), e => e.code === 'permission-denied'); assert.equal(f.counts.downloads, downloads);
  f.advance(7 * 86400000); await assert.rejects(play('alice'), e => e.code === 'not-found');
  assert.ok(f.message(receipt.eventId).text); assert.ok(f.message(receipt.eventId).voice);
});
test('input mode commands require an exact trusted admin claim; ordinary messages need no role lookup', async () => {
  let reads = 0;
  const auth = claims => ({ getUser: async uid => { assert.equal(uid, 'alice'); reads++; return { customClaims: claims }; } });
  await validateChatInputMode({ user: 'alice' }, auth({})); assert.equal(reads, 0);
  for (const mode of ['text', 'voice']) {
    for (const claims of [{}, { perrinnAdmin: 'true' }, { perrinnAdmin: 1 }]) {
      await assert.rejects(validateChatInputMode({ user: 'alice', chatInputMode: mode }, auth(claims)), e => e.code === 'permission-denied');
    }
    await validateChatInputMode({ user: 'alice', chatInputMode: mode }, auth({ perrinnAdmin: true }));
  }
  await assert.rejects(validateChatInputMode({ user: 'alice', chatInputMode: 'other' }, auth({ perrinnAdmin: true })));
});

test('trusted admin resumes at the old 100-recording cap without resetting the counter', async () => {
  const f = productionFixture(), day = new Date(f.options.now()).toISOString().slice(0,10);
  f.records.set('VoiceInputLimits/admin', {day,count:100});
  await f.enqueue(f.request({owner:'admin'}), {uid:'admin',token:{perrinnAdmin:true}});
  assert.equal(f.records.get('VoiceInputLimits/admin').count,101);
});

test('retired prototype and destinationless submissions are rejected before database, storage or provider work', async () => {
  const f = productionFixture();
  for (const conversationId of [undefined, 'pilot', 'other']) {
    await assert.rejects(f.enqueue(f.request({ conversationId })), e => e.code === 'invalid-argument');
  }
  assert.deepEqual(f.counts, { reads: 0, writes: 0, provider: 0, saves: 0, downloads: 0 });
});
test('old prototype tasks retire without provider or storage work, and playback cannot expose their audio', async () => {
  const f = productionFixture(), eventId = 'a'.repeat(64);
  f.records.set(eventPath(eventId), { eventId, userId: 'alice', conversationId: 'pilot', inboxVersion: 1, status: 'queued' });
  await f.process(eventId); await f.process(eventId);
  assert.equal(f.records.get(eventPath(eventId)).status, 'failed');
  assert.equal(f.records.get(eventPath(eventId)).failureCode, 'prototype-retired');
  assert.equal(f.counts.provider, 0); assert.equal(f.counts.downloads, 0);
  for (const auth of [undefined, { uid: 'alice' }, { uid: 'other' }, { uid: 'admin', token: { perrinnAdmin: true } }]) {
    await assert.rejects(voicePlayback(f.db, f.bucket, auth, { eventId, automatic: false }), e => ['unauthenticated', 'not-found'].includes(e.code));
  }
  assert.equal(f.counts.downloads, 0);
});
