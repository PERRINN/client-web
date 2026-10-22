import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { IDBFactory } = require(process.env.VOICE_TEST_INDEXEDDB || 'fake-indexeddb');
function load(path, overrides = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true }
  }).outputText;
  new Function('exports', 'require', source)(exports, name => overrides[name] || require(name));
  return exports;
}
const core = { Injectable: () => value => value };
const storeModule = load('../src/app/prototypes/voice-input/voiceQueueStore.service.ts', { '@angular/core': core });
const { VoiceQueueStore, VOICE_QUEUE_LIMIT, VOICE_REQUEST_LIMIT } = storeModule;
const { VoiceQueueService } = load('../src/app/prototypes/voice-input/voiceQueue.service.ts', {
  '@angular/core': core, '@angular/fire/compat/auth': {}, '@angular/fire/compat/functions': {},
  './voiceQueueStore.service': storeModule, './voiceAudio': load('../src/app/prototypes/voice-input/voiceAudio.ts')
});
const { VoiceInputService } = load('../src/app/prototypes/voice-input/voiceInput.service.ts', {
  '@angular/core': core, '@angular/fire/compat/auth': {}, './voiceQueue.service': { VoiceQueueService },
  './voiceQueueStore.service': storeModule, './voiceCapture.service': {}
});
const bytes = new Uint8Array(32044).fill(1);
const recording = (changes = {}) => ({ id: crypto.randomUUID(), owner: 'alice', createdAt: Date.now(),
  audio: new Blob([bytes], { type: 'audio/wav' }), attempts: 0, nextAt: 0, check: false, ...changes });
async function until(predicate) {
  for (let i = 0; i < 500; i++) { if (predicate()) return; await new Promise(setImmediate); }
  assert.fail('Expected async queue work to settle.');
}
let activeQueues = [];
function environment(t, online = true) {
  activeQueues = [];
  const originals = Object.fromEntries(['indexedDB', 'window', 'document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const window = new EventTarget(), document = Object.assign(new EventTarget(), { hidden: false });
  const navigator = { onLine: online, storage: { persist: async () => false } };
  for (const [key, value] of Object.entries({ indexedDB: new IDBFactory(), window, document, navigator }))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  t.after(() => {
    for (const service of activeQueues) service.ngOnDestroy();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return { window, document, navigator };
}
function queue(t, { store = new VoiceQueueStore(), call = () => of({ eventId: 'saved', transcript: 'Recovered' }), uid = 'alice' } = {}) {
  const auth = { currentUser: Promise.resolve({ uid }), authState: new BehaviorSubject({ uid }) }, calls = [], completed = [];
  const functions = { httpsCallable: (name, options) => input => { calls.push({ name, input, options }); return call(name, input); } };
  const service = new VoiceQueueService(store, auth, functions);
  service.completed.subscribe(result => completed.push(result));
  service.start(uid);
  activeQueues.push(service);
  return { service, store, auth, calls, completed };
}
async function ready(fixture) {
  await until(() => fixture.service.ready && !fixture.service.running);
  await new Promise(setImmediate);
  await until(() => !fixture.service.running);
  await new Promise(setImmediate);
}

test('IndexedDB queue persists audio, IDs and ordering across service recreation while offline', async t => {
  const env = environment(t, false), first = queue(t);
  await ready(first);
  await first.service.enqueue(bytes); await first.service.enqueue(bytes);
  const ids = first.service.items.map(item => item.id);
  assert.equal(first.calls.length, 0); assert.equal(first.service.label(first.service.items[0]), 'Queued · Offline');
  first.service.ngOnDestroy();
  const reopened = queue(t, { store: new VoiceQueueStore() }); await ready(reopened);
  assert.deepEqual(reopened.service.items.map(item => item.id), ids);
  assert.deepEqual(new Uint8Array(await reopened.service.items[0].audio.arrayBuffer()), bytes);
  env.navigator.onLine = true; env.window.dispatchEvent(new Event('online'));
  await until(() => reopened.completed.length === 2 && reopened.service.items.length === 0);
  await ready(reopened);
  assert.deepEqual(reopened.calls.map(call => call.input.requestId), ids);
  assert.equal(reopened.service.items.length, 0); assert.equal((await reopened.store.list('alice')).total, 0);
});

test('lost response recovers completed transcript by status only, retaining request identity', async t => {
  environment(t);
  const fixture = queue(t, { call: name => name === 'voiceInput'
    ? throwError(() => ({ code: 'functions/deadline-exceeded' }))
    : of({ status: 'completed', eventId: 'original', transcript: 'Saved before disconnect' }) });
  await ready(fixture); await fixture.service.enqueue(bytes);
  await until(() => fixture.calls.length === 1 && !fixture.service.running);
  const item = fixture.service.items[0];
  assert.equal(item.check, true); assert.equal(item.attempts, 1);
  assert.ok(item.nextAt > Date.now());
  fixture.service.ngOnDestroy();
  await fixture.store.change(item.id, 'alice', row => ({ ...row, nextAt: 0 }));
  const next = queue(t, { call: name => {
    assert.equal(name, 'voiceInputStatus');
    return of({ status: 'completed', eventId: 'original', transcript: 'Saved before disconnect' });
  } });
  await until(() => next.completed.length === 1); await ready(next);
  assert.deepEqual(next.calls[0].input, { requestId: item.id });
  assert.equal(next.calls[0].options.timeout, 20000);
  assert.equal(next.completed[0].transcript, 'Saved before disconnect');
  assert.equal((await next.store.list('alice')).total, 0);
});

test('missing status resubmits identical audio and ID; processing waits without retranscribing', async t => {
  environment(t);
  const store = new VoiceQueueStore(), item = recording({ check: true, attempts: 1 }); await store.add(item);
  const fixture = queue(t, { store, call: name => name === 'voiceInputStatus' ? of({ status: 'missing' }) : of({ eventId: 'saved', transcript: 'Done' }) });
  await until(() => fixture.completed.length === 1); await ready(fixture);
  assert.deepEqual(fixture.calls.map(call => call.name), ['voiceInputStatus', 'voiceInput']);
  assert.ok(fixture.calls.every(call => call.input.requestId === item.id));
  assert.deepEqual(Buffer.from(fixture.calls[1].input.audio, 'base64'), Buffer.from(bytes));
  const waiting = recording({ check: true }); await store.add(waiting);
  const processing = queue(t, { store, call: () => of({ status: 'processing' }) });
  await until(() => processing.calls.length === 1 && !processing.service.running);
  assert.equal(processing.calls[0].name, 'voiceInputStatus');
  assert.ok(processing.service.items[0].nextAt >= Date.now() + 29000);
  assert.equal(processing.service.items[0].check, true);
});

test('six-request lifetime budget survives reopening and connectivity flaps; explicit Retry grants a new budget', async t => {
  const env = environment(t);
  const fixture = queue(t, { call: () => throwError(() => ({ code: 'functions/unavailable' })) });
  await ready(fixture); await fixture.service.enqueue(bytes);
  for (let count = 1; count <= VOICE_REQUEST_LIMIT; count++) {
    await until(() => fixture.calls.length === count && !fixture.service.running);
    if (count < VOICE_REQUEST_LIMIT) {
      await fixture.store.change(fixture.service.items[0].id, 'alice', row => ({ ...row, nextAt: 0 }));
      await fixture.service.refresh();
    }
  }
  const item = fixture.service.items[0];
  assert.equal(item.attempts, 6); assert.equal(fixture.service.label(item), 'Needs attention');
  for (let flap = 0; flap < 10; flap++) env.window.dispatchEvent(new Event('online'));
  await ready(fixture); assert.equal(fixture.calls.length, 6);
  fixture.service.ngOnDestroy();
  const reopened = queue(t, { call: () => of({ status: 'completed', eventId: 'saved', transcript: 'Later' }) }); await ready(reopened);
  assert.equal(reopened.calls.length, 0);
  await reopened.service.retry(item.id);
  await until(() => reopened.completed.length === 1);
  assert.equal(reopened.calls.length, 1); assert.equal(reopened.calls[0].name, 'voiceInputStatus');
});

test('queue capacity and byte limits are atomic across connections and accounts', async t => {
  environment(t, false);
  const first = new VoiceQueueStore(), second = new VoiceQueueStore();
  const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => (i % 2 ? first : second).add(recording({ owner: i % 2 ? 'alice' : 'bob' }))));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, VOICE_QUEUE_LIMIT);
  assert.equal((await first.list('alice')).total, 10);
  assert.ok((await first.list('alice')).items.every(row => row.owner === 'alice'));
  await assert.rejects(first.add(recording({ audio: new Blob([new Uint8Array(960045)]) })), /Invalid/);
  const loaded = (await first.list('alice')).items[0];
  await first.change(loaded.id, 'bob', () => null);
  assert.equal((await first.list('alice')).total, 10, 'Other account cannot discard');
  await first.change(loaded.id, 'alice', () => null); assert.equal((await second.list('alice')).total, 9);
});

test('two tabs claim a recording once and do not start a second concurrent submission', async t => {
  environment(t, false);
  const store = new VoiceQueueStore(), item = recording(); await store.add(item);
  let response;
  const call = () => new Observable(subscriber => { response = subscriber; });
  const first = queue(t, { store, call }), second = queue(t, { store: new VoiceQueueStore(), call });
  await ready(first); await ready(second);
  navigator.onLine = true;
  await Promise.all([first.service.refresh(), second.service.refresh()]);
  await until(() => response);
  assert.equal(first.calls.length + second.calls.length, 1);
  const owner = first.calls.length ? first : second;
  assert.equal((await store.list('alice')).items[0].attempts, 1);
  await owner.service.discard(item.id); assert.equal((await store.list('alice')).total, 1);
  response.next({ eventId: 'saved', transcript: 'Only once' }); response.complete();
  await until(() => owner.completed.length === 1); await ready(owner);
  await (owner === first ? second : first).service.refresh();
  assert.equal(first.calls.length + second.calls.length, 1);
});

test('storage write failure retains a volatile recording and blocks further capture until save or discard', async t => {
  environment(t, false);
  const store = new VoiceQueueStore(), add = store.add.bind(store); let fail = true;
  store.add = item => fail ? Promise.reject(new Error('Storage full. Keep this page open.')) : add(item);
  const fixture = queue(t, { store }); await ready(fixture);
  await fixture.service.enqueue(bytes);
  const item = fixture.service.items[0];
  assert.equal(fixture.service.canRecord, false); assert.equal(fixture.service.label(item), 'Not saved on this device');
  assert.equal((await store.list('alice')).total, 0); assert.equal(item.audio.size, bytes.length);
  fail = false; await fixture.service.retry(item.id);
  assert.equal((await store.list('alice')).total, 1); assert.equal(fixture.service.canRecord, true);
  assert.equal(fixture.service.items[0].id, item.id);
  await fixture.service.discard(item.id); assert.equal((await store.list('alice')).total, 0);
});

test('storage open/update failures stop network work and recover through explicit storage retry', async t => {
  environment(t, false);
  const store = new VoiceQueueStore(), list = store.list.bind(store); let fail = true;
  store.list = owner => fail ? Promise.reject(Error('Unavailable')) : list(owner);
  const fixture = queue(t, { store });
  await until(() => fixture.service.storageError);
  assert.equal(fixture.service.canRecord, false); assert.equal(fixture.calls.length, 0);
  fail = false; await fixture.service.refresh(); assert.equal(fixture.service.canRecord, true);
});

test('sign-out/account switch suppresses late results, retains original account audio, and never submits it as another user', async t => {
  environment(t);
  let response;
  const fixture = queue(t, { call: () => new Observable(subscriber => { response = subscriber; }) });
  await ready(fixture); await fixture.service.enqueue(bytes); await until(() => response);
  const id = fixture.service.items[0].id;
  fixture.auth.currentUser = Promise.resolve({ uid: 'bob' }); fixture.service.start('bob'); await ready(fixture);
  response.next({ eventId: 'private', transcript: 'Alice only' }); response.complete();
  assert.deepEqual(fixture.completed, []); assert.equal(fixture.service.items.length, 0);
  assert.equal((await fixture.store.list('alice')).items[0].id, id);
  assert.equal(fixture.calls.length, 1);
  fixture.service.start(''); assert.equal((await fixture.store.list('alice')).total, 1);
});

test('background pauses new work; resuming uses the existing budget and creation order', async t => {
  const env = environment(t); env.document.hidden = true;
  const fixture = queue(t); await ready(fixture); await fixture.service.enqueue(bytes); await fixture.service.enqueue(bytes);
  assert.equal(fixture.calls.length, 0);
  const ids = fixture.service.items.map(item => item.id);
  env.document.hidden = false; env.document.dispatchEvent(new Event('visibilitychange'));
  await until(() => fixture.completed.length === 2); assert.deepEqual(fixture.calls.map(call => call.input.requestId), ids);
});

test('capture remains available during transcription; pending entries update in place without interrupting another capture', async t => {
  environment(t);
  let response;
  const fixture = queue(t, { call: () => new Observable(subscriber => { response = subscriber; }) });
  const capture = { start: async () => true, finish: async () => bytes, cancel() {} };
  const voice = new VoiceInputService(fixture.auth, fixture.service, capture, { run: fn => fn() });
  t.after(() => voice.ngOnDestroy()); await ready(fixture);
  await voice.press(); await voice.release(); await until(() => response);
  assert.equal(voice.canRecord, true); assert.equal(voice.replies[0].kind, 'pending');
  const row = voice.replies[0];
  await voice.press(); assert.equal(voice.phase, 'recording');
  response.next({ eventId: 'saved', transcript: 'First' }); response.complete();
  await until(() => fixture.completed.length === 1); await ready(fixture);
  assert.equal(voice.replies[0], row); assert.equal(row.text, 'First'); assert.equal(row.kind, 'transcript');
  assert.equal(voice.phase, 'recording'); voice.cancel();
});

test('quota errors retain audio and distinguish the approved daily allowances', async t => {
  environment(t);
  for (const dailyLimit of [20, 1000]) {
    const fixture = queue(t, { call: () => throwError(() => ({ code: 'functions/resource-exhausted', details: { reason: 'daily-limit', dailyLimit } })) });
    await ready(fixture); await fixture.service.enqueue(bytes);
    await until(() => fixture.calls.length === 1 && !fixture.service.running);
    const item = fixture.service.items.find(row => row.error?.includes(dailyLimit.toLocaleString('en-GB')));
    assert.ok(item); assert.match(item.error, /midnight UTC/); assert.equal(fixture.service.label(item), 'Needs attention');
    fixture.service.ngOnDestroy(); await fixture.store.change(item.id, 'alice', () => null);
  }
});

test('terminal or stranded server states retain audio for attention without another transcription', async t => {
  environment(t);
  for (const status of ['failed', 'stalled']) {
    const store = new VoiceQueueStore(), item = recording({ check: true }); await store.add(item);
    const fixture = queue(t, { store, call: () => of({ status }) });
    await until(() => fixture.calls.length === 1 && !fixture.service.running);
    assert.equal(fixture.service.label(fixture.service.items[0]), 'Needs attention');
    assert.equal(fixture.calls[0].name, 'voiceInputStatus'); assert.equal((await store.list('alice')).total, 1);
    fixture.service.ngOnDestroy(); await store.change(item.id, 'alice', () => null);
  }
});

const { getVoiceInputStatus } = require('../functions/utils/voiceInput');
test('status lookup authenticates, validates IDs, derives owner paths, and performs only one read', async () => {
  const id = crypto.randomUUID(), reads = [], records = new Map();
  const db = { doc: path => ({ get: async () => { reads.push(path); return { exists: records.has(path), data: () => records.get(path) }; } }) };
  const path = uid => 'VoiceInputEvents/' + createHash('sha256').update(uid + ':' + id).digest('hex');
  await assert.rejects(getVoiceInputStatus(db, null, { requestId: id }), error => error.code === 'unauthenticated');
  for (const data of [{ requestId: '../alice' }, { requestId: id, userId: 'alice' }, {}, null])
    await assert.rejects(getVoiceInputStatus(db, { uid: 'bob' }, data), error => error.code === 'invalid-argument');
  assert.equal(reads.length, 0);
  records.set(path('alice'), { userId: 'alice', status: 'completed', eventId: 'event', transcript: 'Private', fingerprint: 'secret' });
  assert.deepEqual(await getVoiceInputStatus(db, { uid: 'alice' }, { requestId: id }), { status: 'completed', eventId: 'event', transcript: 'Private' });
  assert.deepEqual(await getVoiceInputStatus(db, { uid: 'bob' }, { requestId: id }), { status: 'missing' });
  assert.deepEqual(reads, [path('alice'), path('bob')]);
  records.set(path('bob'), { userId: 'alice', status: 'completed', transcript: 'Private' });
  await assert.rejects(getVoiceInputStatus(db, { uid: 'bob' }, { requestId: id }), error => error.code === 'permission-denied');
  records.set(path('alice'), { userId: 'alice', status: 'processing', createdAt: { toMillis: () => 1000 } });
  assert.deepEqual(await getVoiceInputStatus(db, { uid: 'alice' }, { requestId: id }, 120999), { status: 'processing' });
  assert.deepEqual(await getVoiceInputStatus(db, { uid: 'alice' }, { requestId: id }, 121000), { status: 'stalled' });
  records.set(path('alice'), { userId: 'alice', status: 'failed' });
  assert.deepEqual(await getVoiceInputStatus(db, { uid: 'alice' }, { requestId: id }), { status: 'failed' });
});

test('actual status callable returns sanitized errors and never initializes a provider', async () => {
  let reads = 0;
  const db = { doc: () => ({ get: async () => { reads++; return { exists: false }; } }) };
  const { voiceInputStatus } = load('../functions/voiceInputStatus.f.js', {
    'firebase-admin': { firestore: () => db }, './utils/voiceInput': { getVoiceInputStatus },
    './utils/voiceAudio': require('../functions/utils/voiceAudio')
  });
  const input = { requestId: crypto.randomUUID() };
  await assert.rejects(voiceInputStatus.run({ data: input }), error => error.code === 'unauthenticated');
  assert.equal(reads, 0);
  assert.deepEqual(await voiceInputStatus.run({ data: input, auth: { uid: 'alice' } }), { status: 'missing' });
  assert.equal(reads, 1);
  db.doc = () => ({ get: async () => { throw Error('PRIVATE DATABASE ERROR'); } });
  await assert.rejects(voiceInputStatus.run({ data: input, auth: { uid: 'alice' } }), error => error.code === 'unavailable' && !error.message.includes('PRIVATE'));
});

test('auth mismatch stops the worker without a request loop or budget consumption', async t => {
  environment(t, false);
  const fixture = queue(t); await ready(fixture); await fixture.service.enqueue(bytes);
  fixture.auth.currentUser = Promise.resolve({ uid: 'bob' }); navigator.onLine = true;
  await fixture.service.refresh(); await until(() => !fixture.service.owner);
  assert.equal(fixture.calls.length, 0); assert.equal((await fixture.store.list('alice')).total, 1);
  const row = (await fixture.store.list('alice')).items[0];
  assert.equal(row.attempts, 0);
});

test('storage transaction failure before dispatch preserves audio and stops requests until storage retry', async t => {
  environment(t, false);
  const fixture = queue(t); await ready(fixture); await fixture.service.enqueue(bytes);
  const change = fixture.store.change.bind(fixture.store);
  fixture.store.change = async () => { throw Error('Storage transaction failed'); };
  navigator.onLine = true; await fixture.service.refresh();
  await until(() => fixture.service.storageError && !fixture.service.running);
  assert.equal(fixture.calls.length, 0);
  const saved = (await fixture.store.list('alice')).items[0]; assert.equal(saved.attempts, 0); assert.equal(saved.audio.size, bytes.length);
  fixture.store.change = change; await fixture.service.refresh();
  await until(() => fixture.completed.length === 1);
  assert.equal(fixture.calls.length, 1);
});

test('going offline during an IndexedDB claim releases the lease without dispatch or budget consumption', async t => {
  environment(t, false);
  const fixture = queue(t); await ready(fixture); await fixture.service.enqueue(bytes);
  const change = fixture.store.change.bind(fixture.store); let interrupt = true;
  fixture.store.change = async (...args) => {
    const result = await change(...args);
    if (interrupt) { interrupt = false; navigator.onLine = false; }
    return result;
  };
  navigator.onLine = true; await fixture.service.refresh();
  await until(() => !fixture.service.running && fixture.service.items[0]?.attempts === 0);
  const saved = (await fixture.store.list('alice')).items[0];
  assert.equal(saved.attempts, 0); assert.equal(saved.leaseUntil, 0); assert.equal(saved.check, false); assert.equal(fixture.calls.length, 0);
});
