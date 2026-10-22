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
export const input = (changes = {}) => ({ requestId: randomUUID(), sourcePage: '/prototypes/voice-input', audio: audio().toString('base64'), owner: 'alice', ...changes });
function fixture() {
  const records = new Map(), blobs = new Map(), tasks = new Map(), counts = { reads: 0, writes: 0, provider: 0, saves: 0, downloads: 0 };
  let chain = Promise.resolve(), now = Date.now();
  const db = { records, doc: path => ({ path }), runTransaction(fn, settings) {
    assert.equal(settings.maxAttempts, 3);
    const pending = chain.then(async () => {
      const changes = [], tx = {
        get: async ref => { counts.reads++; return { exists: records.has(ref.path), data: () => records.get(ref.path) }; },
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
