import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { enqueueVoiceInput, processVoiceInbox, failExhaustedInbox, eventIdFor } = require('../functions/utils/voiceInbox');
const { VoiceInputError } = require('../functions/utils/voiceAudio');
const { VOICE_CONVERSATION, VOICE_ADMIN, VOICE_PARTICIPANT, VOICE_PARTICIPANTS } = require('../functions/utils/voiceConversation');
export function audio() {
  const b = Buffer.alloc(32044); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(32000, 40);
  for (let i = 44; i < b.length; i += 2) b.writeInt16LE(Math.round(3000 * Math.sin(i)), i);
  return b;
}
export const input = (changes = {}) => ({ requestId: randomUUID(), sourcePage: '/prototypes/voice-input', audio: audio().toString('base64'), owner: 'alice', ...changes });
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
  assert.equal(f.blobs.size, 0); assert.equal(f.counts.provider, 1);
  await f.process(receipt.eventId); assert.equal(f.counts.provider, 1);
  assert.equal(f.records.get('VoiceInputLimits/alice').activeUntil, 0);
});
test('a completed legacy recording replays without storage, task creation, or another transcription', async () => {
  const f = fixture(), data = input(), id = eventIdFor('alice', data.requestId);
  const { validateInput } = require('../functions/utils/voiceAudio'), { owner, ...legacy } = data;
  f.records.set(eventPath(id), { userId: owner, eventId: id, status: 'completed', fingerprint: validateInput(legacy).fingerprint, transcript: 'Legacy saved' });
  const receipt = await f.enqueue(data); assert.equal(receipt.transcript, 'Legacy saved'); assert.equal(f.blobs.size, 0); assert.equal(f.tasks.size, 0);
});
test('old failed/stale requests migrate with their original identity and no second quota charge', async () => {
  for (const status of ['failed', 'processing']) {
    const f = fixture(), data = input(), id = eventIdFor('alice', data.requestId);
    const { validateInput } = require('../functions/utils/voiceAudio'), { owner, ...legacy } = data;
    f.records.set(eventPath(id), { userId: owner, eventId: id, status, model: 'test-model', fingerprint: validateInput(legacy).fingerprint, createdAt: { toMillis: () => 1 } });
    const receipt = await f.enqueue(data); assert.equal(receipt.eventId, id); assert.equal(f.records.get(eventPath(id)).attempts, 1);
    assert.ok(!f.records.has('VoiceInputLimits/alice')); await f.process(id); assert.equal(f.counts.provider, 1);
  }
});
test('fresh legacy work is allowed to finish without a competing transcription', async () => {
  const f = fixture(), data = input(), id = eventIdFor('alice', data.requestId);
  const { validateInput } = require('../functions/utils/voiceAudio'), { owner, ...legacy } = data;
  f.records.set(eventPath(id), { userId: owner, eventId: id, status: 'processing', fingerprint: validateInput(legacy).fingerprint, createdAt: f.options.timestamp() });
  await assert.rejects(f.enqueue(data), e => e.code === 'aborted'); assert.equal(f.blobs.size, 0); assert.equal(f.tasks.size, 0);
});
test('transient failures are retried automatically but never exceed three provider attempts', async () => {
  const f = fixture(), receipt = await f.enqueue(); let calls = 0;
  const settings = { transcribe: async () => { calls++; throw new VoiceInputError('unavailable', 'Unavailable'); } };
  for (let retryCount = 0; retryCount < 3; retryCount++) {
    const job = f.process(receipt.eventId, { ...settings, retryCount });
    if (retryCount < 2) await assert.rejects(job); else await job;
  }
  assert.equal(calls, 3); assert.equal(f.records.get(eventPath(receipt.eventId)).status, 'failed'); assert.equal(f.blobs.size, 1);
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
test('existing ordinary/admin daily quotas apply once per accepted recording', async () => {
  for (const [uid, claims, count, highLimitUid, allowed] of [['alice', {}, 20, '', false], ['admin', { perrinnAdmin: true }, 20, 'admin', true], ['admin', {}, 20, 'admin', false], ['admin', { perrinnAdmin: true }, 1000, 'admin', false]]) {
    const f = fixture(); f.options.highLimitUid = highLimitUid;
    f.records.set('VoiceInputLimits/' + uid, { day: new Date().toISOString().slice(0, 10), count });
    const request = f.enqueue(input({ owner: uid }), { uid, token: claims });
    if (allowed) await request; else await assert.rejects(request, e => e.code === 'resource-exhausted');
  }
});

for (const uid of VOICE_PARTICIPANTS) test('pilot participant ' + uid + ' can resume at 20, replay at 1000, and reset at UTC midnight', async () => {
  const f = fixture(), auth = { uid, token: {} };
  const limitPath = 'VoiceInputLimits/' + uid;
  const data = input({ owner: uid, conversationId: 'pilot' });
  const day = new Date(f.options.now()).toISOString().slice(0, 10);
  f.records.set(limitPath, { day, count: 20 });
  await f.enqueue(data, auth);
  assert.equal(f.records.get(limitPath).count, 21);
  f.records.set(limitPath, { day, count: 999 });
  const last = input({ owner: uid, conversationId: 'pilot' });
  const receipt = await f.enqueue(last, auth);
  assert.equal(f.records.get(limitPath).count, 1000);
  assert.deepEqual(await f.enqueue(last, auth), receipt);
  assert.equal(f.records.get(limitPath).count, 1000);
  const work = { ...f.counts }, tasks = f.tasks.size;
  const next = input({ owner: uid, conversationId: 'pilot' });
  await assert.rejects(f.enqueue(next, auth), e => e.code === 'resource-exhausted'
    && e.details.reason === 'daily-limit' && e.details.dailyLimit === 1000);
  assert.equal(f.counts.writes, work.writes);
  assert.equal(f.counts.saves, work.saves);
  assert.equal(f.tasks.size, tasks);
  f.advance(86400000);
  await f.enqueue(next, auth);
  assert.equal(f.records.get(limitPath).count, 1);
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
test('raw audio deletion failure cannot undo success or cause a second provider attempt', async () => {
  const f = fixture(), receipt = await f.enqueue(), file = f.bucket.file;
  f.bucket.file = path => ({ ...file(path), delete: async () => { throw Error('Delete unavailable'); } });
  await f.process(receipt.eventId); await f.process(receipt.eventId);
  assert.equal(f.blobs.size, 1); assert.equal(f.counts.provider, 1); assert.equal(f.records.get(eventPath(receipt.eventId)).status, 'completed');
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

test('shared pilot accepts only its three participants, including an exact admin claim for its admin account', async () => {
  for (const [uid, token, allowed] of [[VOICE_PARTICIPANT, {}, true], [VOICE_PARTICIPANTS[1], {}, true], [VOICE_ADMIN, { perrinnAdmin: true }, true],
    [VOICE_ADMIN, {}, false], ['sPJhQ9lcLRgdKcIitszQp4oi7M23', {}, false], ['outsider', {}, false], ['another-admin', { perrinnAdmin: true }, false]]) {
    const f = fixture(), data = input({ owner: uid, conversationId: VOICE_CONVERSATION });
    if (allowed) {
      const receipt = await f.enqueue(data, { uid, token });
      assert.equal(f.records.get(eventPath(receipt.eventId)).conversationId, VOICE_CONVERSATION);
    } else {
      await assert.rejects(f.enqueue(data, { uid, token }), e => e.code === 'permission-denied');
      assert.equal(f.counts.reads, 0); assert.equal(f.counts.writes, 0); assert.equal(f.blobs.size, 0);
    }
  }
  const f = fixture();
  await assert.rejects(f.enqueue(input({ owner: VOICE_PARTICIPANT, conversationId: 'other' })), e => e.code === 'permission-denied');
});
for (const uid of VOICE_PARTICIPANTS) test('shared completion for ' + uid + ' publishes exactly once atomically, with trusted author and no private metadata', async () => {
  const f = fixture(), data = input({ owner: uid, conversationId: VOICE_CONVERSATION });
  const receipt = await f.enqueue(data, { uid: data.owner, token: { name: 'Test participant' } });
  const transaction = f.db.runTransaction.bind(f.db); let lost = false;
  f.db.runTransaction = async (...args) => {
    const result = await transaction(...args);
    if (!lost && f.records.get(eventPath(receipt.eventId))?.status === 'completed') { lost = true; throw Error('Lost acknowledgement'); }
    return result;
  };
  await f.process(receipt.eventId); await f.process(receipt.eventId); await f.enqueue(data);
  const shared = [...f.records.keys()].filter(path => path.startsWith('VoiceConversations/'));
  assert.deepEqual(shared, [`VoiceConversations/pilot/messages/${receipt.eventId}`]);
  const message = f.records.get(shared[0]);
  assert.deepEqual(Object.keys(message).sort(), ['audioExpiresAt', 'authorName', 'createdAt', 'requestId', 'source', 'text', 'userId']);
  assert.equal(message.text, 'Saved transcript'); assert.equal(message.authorName, 'Test participant');
  assert.equal(message.requestId, data.requestId); assert.equal(message.userId, data.owner);
  assert.equal(f.counts.provider, 1); assert.equal(lost, true);
  assert.equal(message.source, 'voice'); assert.equal(message.audioExpiresAt, f.options.now() + 7 * 86400000);
  assert.equal(f.blobs.size, 1, 'Shared audio survives completion and replay.');
});
test('replays cannot move a private recording into shared history or change its destination', async () => {
  const f = fixture(), privateInput = input({ owner: VOICE_PARTICIPANT });
  const receipt = await f.enqueue(privateInput);
  await assert.rejects(f.enqueue({ ...privateInput, conversationId: VOICE_CONVERSATION }), e => e.code === 'invalid-argument');
  await f.process(receipt.eventId);
  assert.equal([...f.records.keys()].some(path => path.startsWith('VoiceConversations/')), false);
  const shared = input({ owner: VOICE_PARTICIPANT, conversationId: VOICE_CONVERSATION });
  await f.enqueue(shared);
  const { conversationId, ...withoutDestination } = shared;
  await assert.rejects(f.enqueue(withoutDestination), e => e.code === 'invalid-argument');
});
test('failed shared transcription delivers a playable audio-only message', async () => {
  const f = fixture(), receipt = await f.enqueue(input({ owner: VOICE_PARTICIPANT, conversationId: VOICE_CONVERSATION }));
  await f.process(receipt.eventId, { transcribe: async () => { throw new VoiceInputError('failed-precondition', 'No speech'); } });
  const event = f.records.get(eventPath(receipt.eventId));
  assert.equal(event.status, 'completed'); assert.equal(event.transcript, '');
  const message = f.records.get(`VoiceConversations/pilot/messages/${receipt.eventId}`);
  assert.equal(message.text, ''); assert.equal(message.source, 'voice');
  assert.ok((await voicePlayback(f.db, f.bucket, { uid: VOICE_ADMIN, token: { perrinnAdmin: true } },
    { eventId: receipt.eventId, automatic: false }, f.options.now())).audio);
});

const { voicePlayback } = require('../functions/utils/voicePlayback');
async function playableFixture() {
  const f = fixture(), data = input({ owner: VOICE_PARTICIPANT, conversationId: 'pilot' });
  const receipt = await f.enqueue(data); await f.process(receipt.eventId);
  return { ...f, id: receipt.eventId, play: (auth, automatic = false, eventId = receipt.eventId) =>
    voicePlayback(f.db, f.bucket, auth, { eventId, automatic }, f.options.now()) };
}
const playbackAdmin = { uid: VOICE_ADMIN, token: { perrinnAdmin: true } };
test('playback denies anonymous before reads and nonparticipants before audio downloads', async () => {
  const f = await playableFixture(), before = f.counts.reads;
  for (const auth of [null, { uid: 'outsider' }, { uid: 'sPJhQ9lcLRgdKcIitszQp4oi7M23' }, { uid: VOICE_ADMIN }, { uid: VOICE_ADMIN, token: { perrinnAdmin: 1 } }]) {
    await assert.rejects(f.play(auth), e => e.code === (auth ? 'permission-denied' : 'unauthenticated'));
  }
  assert.equal(f.counts.reads, before + 4);
});
test('one recipient device claims automatic audio; sender never auto downloads and either participant can replay', async () => {
  const f = await playableFixture(), downloads = f.counts.downloads;
  assert.deepEqual(await f.play({ uid: VOICE_PARTICIPANT }, true), { skipped: true });
  const results = await Promise.all([f.play(playbackAdmin, true), f.play(playbackAdmin, true)]);
  assert.equal(results.filter(r => r.audio).length, 1); assert.equal(results.filter(r => r.skipped).length, 1);
  assert.equal(f.counts.downloads, downloads + 1);
  assert.equal(Buffer.from((await f.play({ uid: VOICE_PARTICIPANT })).audio, 'base64').length, 32044);
  assert.ok((await f.play(playbackAdmin)).audio);
  assert.ok((await f.play({ uid: VOICE_PARTICIPANTS[1] })).audio);
  assert.equal(f.counts.provider, 1);
});
test('expired, legacy, wrong destination and forged paths never download audio', async () => {
  for (const change of [{ audioExpiresAt: 0 }, { audioExpiresAt: undefined }, { conversationId: 'other' }, { audioPath: 'images/secret' }, { status: 'receiving' }, { userId: 'outsider' }]) {
    const f = await playableFixture(), before = f.counts.downloads;
    Object.assign(f.records.get(eventPath(f.id)), change);
    await assert.rejects(f.play(playbackAdmin)); assert.equal(f.counts.downloads, before);
  }
  const f = await playableFixture(); f.advance(7 * 86400000);
  await assert.rejects(f.play(playbackAdmin), e => e.code === 'not-found');
  await assert.rejects(f.play(playbackAdmin, false, '../private'), e => e.code === 'invalid-argument');
});
test('failed first automatic download is not repeated across devices; explicit retry works', async () => {
  const f = await playableFixture(), original = f.bucket.file;
  f.bucket.file = path => ({ ...original(path), download: async () => { throw Error('Offline'); } });
  await assert.rejects(f.play(playbackAdmin, true));
  f.bucket.file = original;
  assert.deepEqual(await f.play(playbackAdmin, true), { skipped: true });
  assert.ok((await f.play(playbackAdmin)).audio);
  assert.ok((await f.play({ uid: VOICE_PARTICIPANTS[1] })).audio);
});


test('verified audio is shared and playable before transcription; text updates the same message without reordering', async () => {
  const f = fixture(), receipt = await f.enqueue(input({ owner: VOICE_PARTICIPANT, conversationId: 'pilot' }));
  let finish;
  const pending = f.process(receipt.eventId, { transcribe: () => new Promise(resolve => { finish = resolve; }) });
  for (let i = 0; i < 100 && !finish; i++) await new Promise(setImmediate);
  assert.ok(finish);
  const path = `VoiceConversations/pilot/messages/${receipt.eventId}`, before = f.records.get(path);
  assert.equal(before.text, ''); assert.equal(f.records.get(eventPath(receipt.eventId)).status, 'processing');
  assert.ok((await voicePlayback(f.db, f.bucket, playbackAdmin, { eventId: receipt.eventId, automatic: false }, f.options.now())).audio);
  f.advance(10000); finish('Later text'); await pending;
  const after = f.records.get(path);
  assert.equal(after.text, 'Later text'); assert.equal(after.createdAt, before.createdAt);
  assert.equal(after.audioExpiresAt, before.audioExpiresAt);
  assert.equal([...f.records.keys()].filter(p => p.startsWith('VoiceConversations/')).length, 1);
});
test('shared transcription retries exhaust as one successful audio delivery, with no extra provider work on replay', async () => {
  const f = fixture(), data = input({ owner: VOICE_PARTICIPANT, conversationId: 'pilot' }), receipt = await f.enqueue(data);
  let calls = 0;
  const settings = { transcribe: async () => { calls++; throw new VoiceInputError('unavailable', 'Offline'); } };
  for (let i = 0; i < 3; i++) {
    if (i < 2) await assert.rejects(f.process(receipt.eventId, settings)); else await f.process(receipt.eventId, settings);
  }
  const event = f.records.get(eventPath(receipt.eventId));
  assert.equal(event.status, 'completed'); assert.equal(event.transcript, ''); assert.equal(event.failureCode, 'transcription-unavailable');
  assert.equal(f.records.get(`VoiceConversations/pilot/messages/${receipt.eventId}`).text, '');
  assert.deepEqual(await f.enqueue(data), { eventId: receipt.eventId, status: 'completed', transcript: '' });
  await f.process(receipt.eventId, settings); assert.equal(calls, 3); assert.equal(f.blobs.size, 1);
});
test('task/attempt exhaustion preserves already shared audio and empty transcription is delivered without text', async () => {
  for (const end of ['task', 'attempt', 'empty']) {
    const f = fixture(), receipt = await f.enqueue(input({ owner: VOICE_PARTICIPANT, conversationId: 'pilot' }));
    if (end === 'empty') await f.process(receipt.eventId, { transcribe: async () => '' });
    else {
      await assert.rejects(f.process(receipt.eventId, { transcribe: async () => { throw new VoiceInputError('unavailable', 'Offline'); } }));
      if (end === 'task') await failExhaustedInbox(f.db, receipt.eventId, f.options.timestamp);
      else { f.records.get(eventPath(receipt.eventId)).attempts = 3; await f.process(receipt.eventId); }
    }
    assert.equal(f.records.get(eventPath(receipt.eventId)).status, 'completed');
    assert.equal(f.records.get(eventPath(receipt.eventId)).transcript, '');
    assert.equal(f.records.get(`VoiceConversations/pilot/messages/${receipt.eventId}`).text, '');
    assert.equal(f.blobs.size, 1);
  }
});
test('invalid stored audio is never shared and retains the existing failure behavior', async () => {
  const f = fixture(), receipt = await f.enqueue(input({ owner: VOICE_PARTICIPANT, conversationId: 'pilot' }));
  f.blobs.values().next().value.bytes[50] ^= 1;
  await f.process(receipt.eventId);
  assert.equal(f.records.get(eventPath(receipt.eventId)).status, 'failed');
  assert.equal(f.records.has(`VoiceConversations/pilot/messages/${receipt.eventId}`), false);
  await assert.rejects(voicePlayback(f.db, f.bucket, playbackAdmin, { eventId: receipt.eventId, automatic: false }, f.options.now()));
});

test('added participant audio can be replayed by both other participants', async () => {
  const f = fixture(), uid = VOICE_PARTICIPANTS[1];
  const receipt = await f.enqueue(input({ owner: uid, conversationId: 'pilot' }), { uid });
  await f.process(receipt.eventId);
  for (const auth of [playbackAdmin, { uid: VOICE_PARTICIPANT }]) {
    const result = await voicePlayback(f.db, f.bucket, auth, { eventId: receipt.eventId, automatic: false }, f.options.now());
    assert.ok(result.audio);
  }
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
  for (const [uid, token, limit] of [['alice', {}, 100], [VOICE_ADMIN, {perrinnAdmin:true}, 1000], ['other-admin', {perrinnAdmin:true}, 1000], ...VOICE_PARTICIPANTS.map(uid=>[uid, {}, 100]), ['forged-admin', {perrinnAdmin:'true'}, 100], ['numeric-admin', {perrinnAdmin:1}, 100]]) {
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
