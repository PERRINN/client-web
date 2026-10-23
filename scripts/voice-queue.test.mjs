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
let inInjectionContext = false;
const diagnosticsModule = load('../src/app/prototypes/voice-input/voiceDiagnostics.ts');
const core = { Injectable: () => value => value, runInInjectionContext: (_injector, fn) => {
  const previous = inInjectionContext; inInjectionContext = true;
  try { return fn(); } finally { inInjectionContext = previous; }
} };
const storeModule = load('../src/app/prototypes/voice-input/voiceQueueStore.service.ts', { '@angular/core': core });
const { VoiceQueueStore, VOICE_QUEUE_LIMIT, VOICE_REQUEST_LIMIT } = storeModule;
const { VoiceQueueService } = load('../src/app/prototypes/voice-input/voiceQueue.service.ts', {
  '@angular/core': core, './voiceDiagnostics': diagnosticsModule, '@angular/fire/compat/auth': {}, '@angular/fire/compat/functions': {}, '@angular/fire/compat/firestore': {},
  './voiceQueueStore.service': storeModule, './voiceAudio': load('../src/app/prototypes/voice-input/voiceAudio.ts')
});
const { VoiceInputService } = load('../src/app/prototypes/voice-input/voiceInput.service.ts', {
  '@angular/core': core, './voiceDiagnostics': diagnosticsModule, '@angular/fire/compat/auth': {}, './voiceQueue.service': { VoiceQueueService },
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
  t.after(async () => {
    for (const service of activeQueues) service.ngOnDestroy();
    // Let pending IndexedDB completions release their Rx timers before the
    // next test replaces the browser globals and fake timer IDs.
    for (let i = 0; i < 10; i++) await new Promise(setImmediate);
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return { window, document, navigator };
}
const eventId = 'a'.repeat(64);
function queue(t, { store = new VoiceQueueStore(), call = () => of({ eventId, status: 'completed', transcript: 'Recovered' }), uid = 'alice', documentError, listenerError, serverStatus = 'processing' } = {}) {
  const auth = { currentUser: Promise.resolve({ uid }), authState: new BehaviorSubject({ uid }) }, calls = [], completed = [], listeners = new Map();
  const functions = { httpsCallable: (name, options) => input => { calls.push({ name, input, options }); return call(name, input); } };
  const firestore = { doc: path => {
    assert.equal(inInjectionContext, true, 'AngularFire document wrappers require an injection context');
    if (documentError?.()) throw Error('Document setup failed');
    return { get: options => {
      assert.equal(options.source, 'server');
      return of({ data: () => ({ userId: uid, inboxVersion: 1, status: serverStatus }) });
    }, snapshotChanges: () => new Observable(subscriber => {
      if (listenerError?.()) { subscriber.error(Error('Listener unavailable')); return; }
      listeners.set(path, subscriber); return () => listeners.delete(path);
    }) };
  } };
  const service = new VoiceQueueService(store, auth, functions, firestore, {});
  service.completed.subscribe(result => completed.push(result)); service.start(uid); activeQueues.push(service);
  const result = (status, transcript = 'Server transcript', cache = false) => {
    for (const subscriber of [...listeners.values()]) subscriber.next({ payload: { metadata: { fromCache: cache }, data: () => ({ status, transcript, userId: uid }) } });
  };
  return { service, store, auth, calls, completed, listeners, result };
}
async function ready(fixture) {
  await until(() => fixture.service.ready && !fixture.service.running);
  await new Promise(setImmediate);
  await until(() => !fixture.service.running);
  await new Promise(setImmediate);
}

test('offline recordings persist identity/audio across reload and upload automatically on reconnect', async t => {
  const env = environment(t, false), f = queue(t); await ready(f);
  await f.service.enqueue(bytes); await f.service.enqueue(bytes);
  const ids = f.service.items.map(x => x.id); assert.equal(f.calls.length, 0);
  assert.equal(f.service.label(f.service.items[0]), 'Waiting for connection'); f.service.ngOnDestroy();
  const next = queue(t); await ready(next);
  assert.deepEqual(next.service.items.map(x => x.id), ids);
  assert.deepEqual(new Uint8Array(next.service.items[0].audio), bytes);
  env.navigator.onLine = true; env.window.dispatchEvent(new Event('online'));
  await until(() => next.completed.length === 2); await ready(next);
  assert.deepEqual(next.calls.map(x => x.input.requestId), ids);
  assert.ok(next.calls.every(x => x.name === 'voiceInputEnqueue' && x.input.owner === 'alice'));
  assert.equal((await next.store.list('alice')).total, 0);
});
test('new audio stores an owned buffer containing only the selected samples', async t => {
  environment(t, false); const f = queue(t); await ready(f);
  const source = new Uint8Array(bytes.length + 20).fill(7), selected = source.subarray(10, -10);
  await f.service.enqueue(selected); source.fill(9);
  const row = (await new VoiceQueueStore().list('alice')).items[0];
  assert.ok(row.audio instanceof ArrayBuffer);
  assert.deepEqual(new Uint8Array(row.audio), new Uint8Array(bytes.length).fill(7));
});
test('existing Blob audio uploads unchanged alongside new raw buffers', async t => {
  environment(t, false); const store = new VoiceQueueStore(), legacy = recording({ createdAt: Date.now() - 1000 }); await store.add(legacy);
  const f = queue(t, { store }); await ready(f); await f.service.enqueue(bytes);
  navigator.onLine = true; await f.service.refresh(); await until(() => f.completed.length === 2);
  assert.equal(f.calls[0].input.requestId, legacy.id);
  for (const call of f.calls) assert.deepEqual(Buffer.from(call.input.audio, 'base64'), Buffer.from(bytes));
});
test('raw and legacy audio enforce the same byte bounds before persistence', async t => {
  environment(t, false); const store = new VoiceQueueStore();
  for (const length of [0, 12843, 960045]) {
    for (const audio of [new ArrayBuffer(length), new Blob([new Uint8Array(length)])])
      await assert.rejects(store.add(recording({ audio })), /Invalid/);
  }
  for (const length of [12844, 960044]) await store.add(recording({ audio: new ArrayBuffer(length) }));
  assert.equal((await store.list('alice')).total, 2);
});
test('durable receipt releases local audio; known document listener restores result after reopening', async t => {
  environment(t); const f = queue(t, { call: () => of({ status: 'queued', eventId }) }); await ready(f);
  await f.service.enqueue(bytes); await until(() => f.listeners.size === 1); await ready(f);
  const row = f.service.items[0]; assert.equal(row.audio.byteLength, 0); assert.equal(row.received, true);
  assert.equal(f.service.label(row), 'Transcribing'); assert.equal(f.calls.length, 1);
  f.result('queued', '', true); assert.equal(f.completed.length, 0);
  f.service.ngOnDestroy(); assert.equal(f.listeners.size, 0);
  const next = queue(t); await until(() => next.listeners.size === 1);
  assert.equal(next.calls.length, 0); next.result('completed', 'Server transcript', true);
  await until(() => next.completed.length === 1); await ready(next);
  assert.equal(next.completed[0].transcript, 'Server transcript'); assert.equal((await next.store.list('alice')).total, 0);
});
test('lost receipt retains audio and repeats identical identity, then recovers saved server result', async t => {
  environment(t); const f = queue(t, { call: () => throwError(() => ({ code: 'functions/unavailable' })) }); await ready(f);
  await f.service.enqueue(bytes); await until(() => f.calls.length === 1 && !f.service.running);
  const item = f.service.items[0]; assert.equal(item.audio.byteLength, bytes.length); assert.equal(item.attempts, 1);
  f.service.ngOnDestroy(); await f.store.change(item.id, 'alice', x => ({ ...x, nextAt: 0 }));
  const next = queue(t); await until(() => next.completed.length === 1);
  assert.equal(next.calls[0].input.requestId, item.id); assert.deepEqual(Buffer.from(next.calls[0].input.audio, 'base64'), Buffer.from(bytes));
  assert.equal(next.calls[0].options.timeout, 65000);
});
test('exhausted upload budget survives reopening and does not reset after a day', async t => {
  environment(t, false); const store = new VoiceQueueStore();
  const item = recording({ retryWindow: Date.now() - 86400001, attempts: VOICE_REQUEST_LIMIT }); await store.add(item);
  const f = queue(t, { store, call: () => of({ status: 'missing' }) }); await ready(f);
  f.service.ngOnDestroy(); const next = queue(t, { call: () => of({ status: 'missing' }) }); await ready(next);
  navigator.onLine = true; await next.service.refresh(); await until(() => next.completed.length === 1); await ready(next);
  assert.deepEqual(next.calls.map(x => x.name), ['voiceInputStatus']);
  assert.equal(next.completed[0].failed, true); assert.equal((await store.list('alice')).total, 0);
});
test('capacity/ownership limits are atomic and local save acknowledgement is replay safe', async t => {
  environment(t, false); const store = new VoiceQueueStore(), other = new VoiceQueueStore();
  const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => (i % 2 ? store : other).add(recording({ owner: i % 2 ? 'alice' : 'bob' }))));
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 10);
  const row = (await store.list('alice')).items[0]; await store.add(row); assert.equal((await store.list('alice')).total, 10);
  await store.change(row.id, 'bob', () => null); assert.equal((await store.list('alice')).total, 10);
  await assert.rejects(store.add(recording({ audio: new Blob([new Uint8Array(960045)]) })), /Invalid/);
});
test('two tabs use an atomic lease and make only one submission', async t => {
  environment(t, false); const store = new VoiceQueueStore(); await store.add(recording()); let response;
  const call = () => new Observable(s => { response = s; });
  const a = queue(t, { store, call }), b = queue(t, { call }); await ready(a); await ready(b);
  navigator.onLine = true; await Promise.all([a.service.refresh(), b.service.refresh()]); await until(() => response);
  assert.equal(a.calls.length + b.calls.length, 1); response.next({ eventId, status: 'completed', transcript: 'Once' }); response.complete();
  await until(() => a.completed.length + b.completed.length === 1);
});
test('account changes cancel late private replies and retain the original owner recording', async t => {
  environment(t); let response; const f = queue(t, { call: () => new Observable(s => { response = s; }) }); await ready(f);
  await f.service.enqueue(bytes); await until(() => response); f.auth.currentUser = Promise.resolve({ uid: 'bob' }); f.service.start('bob');
  response.next({ status: 'completed', eventId, transcript: 'Private' }); response.complete(); await ready(f);
  assert.equal(f.completed.length, 0); assert.equal(f.service.items.length, 0); assert.equal((await f.store.list('alice')).total, 1);
});
test('storage failures recover automatically on foreground without losing volatile audio', async t => {
  const env = environment(t, false), store = new VoiceQueueStore(), add = store.add.bind(store); let fail = true;
  store.add = x => fail ? Promise.reject(Error('Full')) : add(x);
  const f = queue(t, { store }); await ready(f); await f.service.enqueue(bytes);
  assert.equal(f.service.canRecord, false); assert.equal(f.service.items[0].audio.byteLength, bytes.length);
  const id = f.service.items[0].id; fail = false; env.window.dispatchEvent(new Event('focus'));
  await until(() => f.service.ready); assert.equal((await store.list('alice')).items[0].id, id);
});
test('terminal server failure becomes a reply and clears pending state automatically', async t => {
  environment(t); const f = queue(t, { call: () => of({ status: 'failed', eventId }) }); await ready(f);
  await f.service.enqueue(bytes); await until(() => f.listeners.size === 1); f.result('failed');
  await until(() => f.completed.length === 1); await ready(f);
  assert.equal(f.completed[0].failed, true); await until(() => f.service.items.length === 0);
});
test('daily allowance waits until UTC midnight without showing management actions', async t => {
  environment(t); const f = queue(t, { call: () => throwError(() => ({ code: 'functions/resource-exhausted', details: { reason: 'daily-limit' } })) }); await ready(f);
  await f.service.enqueue(bytes); await until(() => f.calls.length === 1 && !f.service.running);
  const row = f.service.items[0]; assert.equal(row.audio.byteLength, bytes.length); assert.ok(row.nextAt > Date.now()); assert.equal(row.error, undefined);
});
function clock(t, timers = true) { t.mock.timers.enable({ apis: timers ? ['Date', 'setTimeout', 'setInterval'] : ['Date'], now: 1792696380000 }); }
test('hung callable times out independently and automatic retry recovers without blocking forever', async t => {
  environment(t); clock(t); let response;
  const f = queue(t, { call: () => new Observable(s => { response = s; }) }); await ready(f); await f.service.enqueue(bytes); await until(() => response);
  t.mock.timers.tick(65000); await until(() => !f.service.running && f.service.items[0]?.leaseUntil === 0);
  assert.equal(response.closed, true); assert.equal(f.service.items[0].attempts, 1);
  t.mock.timers.tick(2000); await until(() => f.calls.length === 2);
  response.next({ status: 'completed', eventId, transcript: 'Recovered' }); response.complete(); await until(() => f.completed.length === 1);
});
test('hung auth preparation is bounded; late auth cannot dispatch the expired attempt', async t => {
  environment(t, false); clock(t); const f = queue(t); await ready(f); await f.service.enqueue(bytes); let resolve;
  f.auth.currentUser = new Promise(r => { resolve = r; }); navigator.onLine = true; await f.service.refresh();
  await until(() => f.service.attempt?.record); t.mock.timers.tick(75000);
  await until(() => !f.service.running && f.service.items[0]?.leaseUntil === 0);
  assert.equal(f.service.items[0].attempts, 1); assert.equal(f.calls.length, 0);
  resolve({ uid: 'alice' }); await new Promise(setImmediate); assert.equal(f.calls.length, 0);
  t.mock.timers.tick(2000); await until(() => f.completed.length === 1);
});
test('foreground resumes by wall clock even when mobile suspended timeout callbacks', async t => {
  const env = environment(t); clock(t, false); let response;
  const f = queue(t, { call: () => new Observable(s => { response = s; }) }); await ready(f); await f.service.enqueue(bytes); await until(() => response);
  t.mock.timers.tick(76000); env.window.dispatchEvent(new Event('pageshow'));
  await until(() => !f.service.running && f.service.items[0]?.leaseUntil === 0);
  assert.equal(response.closed, true); assert.equal(f.service.items[0].attempts, 1); assert.equal(f.calls.length, 1);
});
test('listener count is bounded by device capacity and cleaned up on navigation', async t => {
  environment(t, false); const store = new VoiceQueueStore();
  for (let i = 0; i < VOICE_QUEUE_LIMIT; i++) { const row = recording(); await store.add(row); await store.change(row.id, 'alice', x => ({ ...x, received: true, eventId: i.toString(16).padStart(64, '0'), audio: new Blob() })); }
  const f = queue(t, { store }); await until(() => f.listeners.size === 10); assert.equal(f.service.canRecord, false);
  f.service.ngOnDestroy(); assert.equal(f.listeners.size, 0); assert.equal(f.calls.length, 0);
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


test('a delayed upload does not block another eligible recording', async t => {
  environment(t, false); const store = new VoiceQueueStore();
  const first = recording({ nextAt: Date.now() + 3600000, createdAt: Date.now() - 1000 }), second = recording();
  await store.add(first); await store.add(second); const f = queue(t, { store }); await ready(f);
  navigator.onLine = true; await f.service.refresh(); await until(() => f.completed.length === 1);
  assert.equal(f.calls[0].input.requestId, second.id); assert.equal((await store.list('alice')).items[0].id, first.id);
});

test('cached results require the recording owner and settle without a metadata-only server snapshot', async t => {
  environment(t); const f = queue(t, { call: () => of({ status: 'queued', eventId }) }); await ready(f);
  await f.service.enqueue(bytes); await until(() => f.listeners.size === 1);
  const subscriber = [...f.listeners.values()][0];
  subscriber.next({ payload: { metadata: { fromCache: true, hasPendingWrites: false }, data: () => ({ userId: 'bob', status: 'completed', transcript: 'Other user' }) } });
  assert.equal(f.completed.length, 0);
  f.result('completed', 'Owner cached result', true); await until(() => f.completed.length === 1);
  assert.equal(f.completed[0].transcript, 'Owner cached result');
});

async function savedReceipt(store) {
  const row = recording(); await store.add(row);
  await store.change(row.id, row.owner, x => ({ ...x, received: true, eventId, audio: new Blob() }));
  return row;
}
test('synchronous transcript setup errors cannot masquerade as local storage failure or block capture/uploads', async t => {
  environment(t); const store = new VoiceQueueStore(); await savedReceipt(store);
  const raw = recording(); await store.add(raw);
  const f = queue(t, { store, documentError: () => true });
  await until(() => f.completed.length === 1); await ready(f);
  assert.equal(f.service.ready, true); assert.equal(f.service.storageError, ''); assert.equal(f.service.canRecord, true);
  assert.equal(f.calls[0].input.requestId, raw.id); assert.equal((await store.list('alice')).total, 1);
});
test('failed transcript subscriptions recover automatically within a bounded budget and never lock recording', async t => {
  const env = environment(t); clock(t); const store = new VoiceQueueStore(); await savedReceipt(store);
  let failed = true, attempts = 0;
  const f = queue(t, { store, listenerError: () => { attempts++; return failed; } }); await ready(f);
  assert.equal(attempts, 1); assert.equal(f.service.canRecord, true); assert.equal(f.service.storageError, '');
  for (let i = 0; i < 3; i++) { t.mock.timers.tick(30000); await new Promise(setImmediate); }
  assert.equal(attempts, 4);
  for (let i = 0; i < 5; i++) { await f.service.refresh(); t.mock.timers.tick(60000); }
  assert.equal(attempts, 4, 'Other local refreshes must not bypass the listener retry cap');
  assert.equal(f.service.canRecord, true); failed = false; env.window.dispatchEvent(new Event('focus'));
  await until(() => f.listeners.size === 1); assert.equal(attempts, 5);
  f.result('completed', 'Recovered result'); await until(() => f.completed.length === 1);
  assert.equal(f.completed[0].transcript, 'Recovered result');
});
test('navigation cancels scheduled transcript recovery and suppresses previous owner results', async t => {
  environment(t); clock(t); const store = new VoiceQueueStore(); await savedReceipt(store); let attempts = 0;
  const f = queue(t, { store, listenerError: () => { attempts++; return true; } }); await ready(f);
  f.service.start('bob'); await ready(f); t.mock.timers.tick(30000);
  assert.equal(attempts, 1); assert.equal(f.completed.length, 0); assert.equal((await store.list('alice')).total, 1);
});

test('a missing Blob file with a numeric DOM error cannot lock the database or retain its upload lease', async t => {
  environment(t, false); const store = new VoiceQueueStore(), broken = recording({ createdAt: Date.now() - 1000 });
  await store.add(broken); const f = queue(t, { store, call: name => name === 'voiceInputStatus' ? of({ status: 'missing' }) : of({ eventId, status: 'completed', transcript: 'Recovered' }) }); await ready(f);
  const change = store.change.bind(store);
  store.change = async (...args) => {
    const result = await change(...args);
    return result?.id === broken.id && result.leaseUntil > Date.now() ? { ...result, audio: {
      arrayBuffer: async () => { throw new DOMException('Simulated missing backing file', 'NotFoundError'); }
    } } : result;
  };
  navigator.onLine = true; await f.service.refresh(); await until(() => !f.service.running && f.service.diagnostics.uploadCode);
  assert.equal(f.service.storageError, '', 'A numeric DOMException must not become a database lock');
  assert.equal(f.service.canRecord, true);
  assert.equal((await store.list('alice')).items[0].leaseUntil, 0);
  assert.equal((await store.list('alice')).items[0].id, broken.id);
});

function unreadableAudio(store, id, name = 'NotFoundError') {
  const change = store.change.bind(store);
  store.change = async (...args) => {
    const result = await change(...args);
    return result?.id === id && result.leaseUntil > Date.now() ? { ...result, audio: {
      arrayBuffer: async () => { throw new DOMException('PRIVATE FILE DESCRIPTION', name); }
    } } : result;
  };
}
test('unreadable local audio recovers a saved server transcript without an audio upload', async t => {
  environment(t, false); const store = new VoiceQueueStore(), item = recording(); await store.add(item); unreadableAudio(store, item.id);
  const f = queue(t, { store }); await ready(f); navigator.onLine = true; await f.service.refresh();
  await until(() => f.completed.length === 1); await ready(f);
  assert.deepEqual(f.calls.map(x => x.name), ['voiceInputStatus']);
  assert.deepEqual(f.calls[0].input, { requestId: item.id }); assert.equal(f.calls[0].options.timeout, 20000);
  assert.equal(f.completed[0].transcript, 'Recovered'); assert.equal((await store.list('alice')).total, 0);
});
test('one unreadable recording is retained while healthy later recordings upload and the microphone stays enabled', async t => {
  environment(t, false); const store = new VoiceQueueStore(), broken = recording({ createdAt: Date.now() - 1000 }), healthy = recording();
  await store.add(broken); await store.add(healthy); unreadableAudio(store, broken.id);
  const f = queue(t, { store, call: name => name === 'voiceInputStatus' ? of({ status: 'missing' }) : of({ eventId, status: 'completed', transcript: 'Healthy' }) });
  await ready(f); navigator.onLine = true; await f.service.refresh(); await until(() => f.completed.length === 1); await ready(f);
  assert.equal(f.completed[0].id, healthy.id); assert.equal(f.service.canRecord, true); assert.equal(f.service.storageError, '');
  const retained = (await store.list('alice')).items[0];
  assert.equal(retained.id, broken.id); assert.equal(retained.leaseUntil, 0); assert.ok(retained.nextAt > Date.now());
  assert.match(retained.error, /NotFoundError/); assert.ok(!retained.error.includes('PRIVATE'));
  assert.equal(f.service.diagnostics.recordingFault, true);
  assert.deepEqual(f.calls.map(x => x.name), ['voiceInputStatus', 'voiceInputEnqueue']);
});
test('a hung saved-result lookup is independently bounded and does not turn into a local DB lock', async t => {
  environment(t, false); clock(t); const store = new VoiceQueueStore(), item = recording(); await store.add(item); unreadableAudio(store, item.id, 'NotReadableError');
  const f = queue(t, { store, call: () => new Observable(() => {}) }); await ready(f);
  navigator.onLine = true; await f.service.refresh(); await until(() => f.calls.length === 1);
  t.mock.timers.tick(20000); await until(() => !f.service.running && f.service.items[0]?.leaseUntil === 0);
  assert.equal(f.service.canRecord, true); assert.equal(f.service.storageError, ''); assert.match(f.service.items[0].error, /NotReadableError/);
});
test('an outstanding reservation from another page is labelled as waiting, not active sending', async t => {
  environment(t, false); const store = new VoiceQueueStore(), item = recording({ leaseUntil: Date.now() + 90000 }); await store.add(item);
  const f = queue(t, { store }); await ready(f); assert.equal(f.service.label(f.service.items[0]), 'Waiting for upload slot'); assert.equal(f.calls.length, 0);
});

test('numeric DOM errors from the SDK release the lease without being mistaken for storage failure', async t => {
  environment(t); const f = queue(t, { call: () => throwError(() => new DOMException('PRIVATE', 'NetworkError')) }); await ready(f);
  await f.service.enqueue(bytes); await until(() => f.calls.length === 1 && !f.service.running);
  assert.equal(f.service.canRecord, true); assert.equal(f.service.storageError, ''); assert.equal(f.service.items[0].leaseUntil, 0);
});
test('a late fallback result after an account change cannot expose the previous owner transcript', async t => {
  environment(t, false); const store = new VoiceQueueStore(), item = recording(); await store.add(item); unreadableAudio(store, item.id);
  let observer; const f = queue(t, { store, call: () => new Observable(s => { observer = s; }) }); await ready(f);
  navigator.onLine = true; await f.service.refresh(); await until(() => observer);
  f.auth.currentUser = Promise.resolve({ uid: 'bob' }); f.service.start('bob');
  observer.next({ status: 'completed', eventId, transcript: 'Alice private result' }); observer.complete(); await ready(f);
  assert.equal(f.completed.length, 0); assert.equal(f.service.items.length, 0); assert.equal((await store.list('alice')).total, 1);
});

// Inject the browser's actual synchronous put failure, while keeping reads and
// deletes functional. This reproduces one broken audio record, not a dead DB.
async function failPuts(store, id, { afterClaim = false, transient = false, deleteFails = false } = {}) {
  const db = await store.open(), transaction = db.transaction.bind(db);
  let failures = 0;
  db.transaction = (...args) => {
    const tx = transaction(...args), objectStore = tx.objectStore.bind(tx);
    tx.objectStore = (...names) => {
      const table = objectStore(...names), put = table.put.bind(table), remove = table.delete.bind(table);
      table.put = row => {
        if (row.id === id && (!afterClaim || !row.leaseUntil) && (!transient || failures === 0)) {
          failures++; throw new DOMException('PRIVATE AUDIO FILE', 'DataCloneError');
        }
        return put(row);
      };
      table.delete = key => {
        if (deleteFails && key === id) throw new DOMException('PRIVATE', 'UnknownError');
        return remove(key);
      };
      return table;
    };
    return tx;
  };
  return () => failures;
}
test('synchronous IndexedDB update failures reject and leave the original record unchanged', async t => {
  environment(t, false); const store = new VoiceQueueStore(), row = recording(); await store.add(row);
  await assert.rejects(store.change(row.id, 'alice', item => ({ ...item, audio: () => {} })), error => error.name === 'DataCloneError');
  assert.equal((await store.list('alice')).items[0].attempts, 0);
  await store.change(row.id, 'alice', () => null); assert.equal((await store.list('alice')).total, 0);
});
test('a broken claim is retried three times then deleted without blocking a later recording', async t => {
  environment(t, false); const store = new VoiceQueueStore(), broken = recording({ createdAt: Date.now() - 1000 }), healthy = recording();
  await store.add(broken); await store.add(healthy); const failures = await failPuts(store, broken.id);
  const f = queue(t, { store }); await ready(f); navigator.onLine = true; await f.service.refresh();
  await until(() => f.completed.length === 2); await ready(f);
  assert.equal(failures(), 3); assert.equal(f.completed[0].id, broken.id); assert.equal(f.completed[0].failed, true);
  assert.equal(f.completed[1].id, healthy.id); assert.equal(f.service.storageError, ''); assert.equal(f.service.canRecord, true);
  assert.equal((await store.list('alice')).total, 0); assert.equal(f.calls.length, 1);
});
test('a retry-state update failure removes only its row and restores recording', async t => {
  environment(t, false); const store = new VoiceQueueStore(), broken = recording(); await store.add(broken);
  const failures = await failPuts(store, broken.id, { afterClaim: true });
  const f = queue(t, { store, call: () => throwError(() => ({ code: 'functions/unavailable' })) }); await ready(f);
  navigator.onLine = true; await f.service.refresh(); await until(() => f.completed.length === 1); await ready(f);
  assert.equal(failures(), 3); assert.equal(f.completed[0].failed, true); assert.equal(f.service.canRecord, true);
  assert.equal(f.service.storageError, ''); assert.equal((await store.list('alice')).total, 0);
});
test('a transient update failure recovers without discarding audio', async t => {
  environment(t, false); const store = new VoiceQueueStore(), row = recording(); await store.add(row);
  const failures = await failPuts(store, row.id, { transient: true }); const f = queue(t, { store }); await ready(f);
  navigator.onLine = true; await f.service.refresh(); await until(() => f.completed.length === 1); await ready(f);
  assert.equal(failures(), 1); assert.equal(f.completed[0].failed, false); assert.equal(f.calls.length, 1);
});
test('a database that cannot delete still blocks capture rather than pretending cleanup succeeded', async t => {
  environment(t, false); const store = new VoiceQueueStore(), row = recording(); await store.add(row);
  await failPuts(store, row.id, { deleteFails: true }); const f = queue(t, { store }); await ready(f);
  navigator.onLine = true; await f.service.refresh(); await until(() => !f.service.running && f.service.storageError);
  assert.equal(f.service.canRecord, false); assert.equal(f.completed.length, 0); assert.equal((await store.list('alice')).total, 1);
});
test('three failed online uploads check saved status then remove the entry automatically', async t => {
  environment(t); clock(t); const f = queue(t, { call: name => name === 'voiceInputStatus' ? of({ status: 'missing' }) : throwError(() => ({ code: 'functions/unavailable' })) });
  await ready(f); await f.service.enqueue(bytes); await until(() => f.calls.length === 1 && !f.service.running);
  t.mock.timers.tick(2000); await until(() => f.calls.length === 2 && !f.service.running); await ready(f);
  await until(() => f.service.diagnostics.storageWork === 0);
  t.mock.timers.tick(5000); await until(() => f.completed.length === 1); await ready(f);
  assert.equal(f.calls.filter(x => x.name === 'voiceInputEnqueue').length, 3);
  assert.equal(f.calls.filter(x => x.name === 'voiceInputStatus').length, 1);
  assert.equal(f.completed[0].failed, true); assert.equal(f.service.canRecord, true); assert.equal((await f.store.list('alice')).total, 0);
});
test('final recovery saves a completed transcript instead of discarding it', async t => {
  environment(t, false); const store = new VoiceQueueStore(), row = recording({ attempts: VOICE_REQUEST_LIMIT - 1 }); await store.add(row);
  const f = queue(t, { store, call: name => name === 'voiceInputStatus' ? of({ status: 'completed', eventId, transcript: 'Saved' }) : throwError(() => Error('Network')) }); await ready(f);
  navigator.onLine = true; await f.service.refresh(); await until(() => f.completed.length === 1); await ready(f);
  assert.equal(f.completed[0].transcript, 'Saved'); assert.equal(f.completed[0].failed, false); assert.equal(f.service.canRecord, true);
});
test('final recovery attaches to confirmed server processing instead of discarding its result', async t => {
  environment(t, false); const store = new VoiceQueueStore(), row = recording({ attempts: VOICE_REQUEST_LIMIT - 1 }); await store.add(row);
  const f = queue(t, { store, call: name => name === 'voiceInputStatus' ? of({ status: 'processing' }) : throwError(() => Error('Network')) }); await ready(f);
  navigator.onLine = true; await f.service.refresh(); await until(() => f.listeners.size === 1); await ready(f);
  const expected = createHash('sha256').update('alice:' + row.id).digest('hex');
  assert.ok(f.listeners.has('VoiceInputEvents/' + expected)); assert.equal(f.service.items[0].received, true);
  assert.equal(f.service.items[0].audio.byteLength, 0); assert.equal(f.completed.length, 0); assert.equal(f.service.canRecord, true);
  f.result('completed', 'Processing finished'); await until(() => f.completed.length === 1);
});
test('daily quota does not consume the final upload attempt', async t => {
  environment(t, false); const store = new VoiceQueueStore(), row = recording({ attempts: VOICE_REQUEST_LIMIT - 1 }); await store.add(row);
  const f = queue(t, { store, call: () => throwError(() => ({ code: 'functions/resource-exhausted', details: { reason: 'daily-limit' } })) }); await ready(f);
  navigator.onLine = true; await f.service.refresh(); await until(() => f.calls.length === 1 && !f.service.running);
  assert.equal(f.service.items[0].attempts, VOICE_REQUEST_LIMIT - 1); assert.equal(f.completed.length, 0);
});

test('a newly accepted upload releases older quota waits without changing audio, identity or retry budgets', async t => {
  environment(t); const store = new VoiceQueueStore(), now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const waiting = [recording({ createdAt: Date.now() - 2000, nextAt: midnight, attempts: 1 }),
    recording({ createdAt: Date.now() - 1000, nextAt: midnight, attempts: 2, retryWindow: Date.now() })];
  const foreign = recording({ owner: 'bob', nextAt: midnight });
  const leased = recording({ nextAt: midnight, leaseUntil: Date.now() + 150000, leaseId: 'other-tab' });
  for (const row of [...waiting, foreign, leased]) await store.add(row);
  const f = queue(t, { store }); await ready(f); assert.equal(f.calls.length, 0);
  await f.service.enqueue(bytes, 'pilot');
  await until(() => f.completed.length === 3); await ready(f);
  assert.equal(f.calls.length, 3, 'One new upload plus one per eligible saved recording');
  assert.deepEqual(f.calls.slice(1).map(call => call.input.requestId), waiting.map(row => row.id));
  for (const call of f.calls) assert.deepEqual(Buffer.from(call.input.audio, 'base64'), Buffer.from(bytes));
  assert.equal((await store.list('bob')).items[0].nextAt, midnight);
  assert.equal((await store.list('alice')).items[0].leaseId, leased.leaseId);
});

test('quota rechecks stop at renewed daily rejection and survive reload with the original attempt count', async t => {
  environment(t); const store = new VoiceQueueStore(), now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const row = recording({ nextAt: midnight, attempts: 2 }); await store.add(row);
  const f = queue(t, { store, call: (_name, input) => input.requestId === row.id
    ? throwError(() => ({ code: 'functions/resource-exhausted', details: { reason: 'daily-limit' } }))
    : of({ eventId, status: 'queued' }) });
  await ready(f); await f.service.enqueue(bytes, 'pilot');
  await until(() => f.calls.length === 2 && !f.service.running); await ready(f);
  const saved = (await store.list('alice')).items.find(item => item.id === row.id);
  assert.equal(saved.attempts, 2); assert.equal(saved.nextAt, midnight);
  await f.service.refresh(); await ready(f); assert.equal(f.calls.length, 2);
  f.service.ngOnDestroy();
  const reopened = queue(t, { store }); await ready(reopened);
  assert.equal(reopened.calls.length, 0, 'Reopening cannot bypass the renewed server rejection');
});

test('a stalled update aborts its actual transaction before the service timeout', async t => {
  environment(t, false); clock(t); const store = new VoiceQueueStore(), db = await store.open();
  const original = db.transaction.bind(db); let aborted = false, requested = false;
  db.transaction = () => ({
    objectStore: () => ({ get: () => { requested = true; return {}; } }),
    abort() { aborted = true; this.onabort(); }
  });
  const work = assert.rejects(store.change('unused', 'alice', () => undefined), error => error.name === 'TimeoutError');
  await until(() => requested); t.mock.timers.tick(4500); await work;
  assert.equal(aborted, true); db.transaction = original;
  assert.equal((await store.list('alice')).total, 0);
});
test('account changes during final recovery suppress removal and private replies', async t => {
  environment(t, false); const store = new VoiceQueueStore(), row = recording({ attempts: VOICE_REQUEST_LIMIT }); await store.add(row);
  let response; const f = queue(t, { store, call: () => new Observable(s => { response = s; }) }); await ready(f);
  navigator.onLine = true; await f.service.refresh(); await until(() => response);
  f.service.start('bob'); response.next({ status: 'missing' }); response.complete(); await ready(f);
  assert.equal(f.completed.length, 0); assert.equal((await store.list('alice')).total, 1);
});

test('losing connectivity during final status recovery retains the recording for reconnection', async t => {
  environment(t, false); const store = new VoiceQueueStore(), row = recording({ attempts: VOICE_REQUEST_LIMIT }); await store.add(row);
  let response; const f = queue(t, { store, call: () => new Observable(s => { response = s; }) }); await ready(f);
  navigator.onLine = true; await f.service.refresh(); await until(() => response);
  navigator.onLine = false; response.error(Error('Offline')); await until(() => !f.service.running); await ready(f);
  assert.equal(f.completed.length, 0); assert.equal((await store.list('alice')).total, 1);
  assert.equal(f.service.items[0].attempts, VOICE_REQUEST_LIMIT); assert.equal(f.service.items[0].leaseUntil, 0);
});
test('a stale failed upload cannot delete a receipt saved by another tab', async t => {
  environment(t, false); const store = new VoiceQueueStore(), row = recording(); await store.add(row);
  const f = queue(t, { store }); await ready(f);
  await store.change(row.id, 'alice', x => ({ ...x, received: true, eventId, audio: new ArrayBuffer(0) }));
  await f.service.finish(row, 'Failed', true, f.service.epoch); await f.service.refresh(); await ready(f);
  assert.equal(f.completed.length, 0); assert.equal((await store.list('alice')).total, 1);
  assert.equal(f.listeners.size, 1);
});

for (const serverStatus of ['receiving', 'queued']) test(`a ${serverStatus} reservation cannot masquerade as confirmed worker processing`, async t => {
  environment(t, false); const store = new VoiceQueueStore(), row = recording({ attempts: VOICE_REQUEST_LIMIT }); await store.add(row);
  const f = queue(t, { store, serverStatus, call: () => of({ status: 'processing' }) }); await ready(f);
  navigator.onLine = true; await f.service.refresh(); await until(() => f.completed.length === 1); await ready(f);
  assert.equal(f.completed[0].failed, true); assert.equal(f.listeners.size, 0); assert.equal((await store.list('alice')).total, 0);
});

test('a legacy daily retry timestamp cannot postpone exhausted-recording cleanup', async t => {
  environment(t, false); const store = new VoiceQueueStore();
  const row = recording({ attempts: 24, retryWindow: Date.now() - 3868000, nextAt: Date.now() + 82532000 });
  await store.add(row); const f = queue(t, { store, call: () => of({ status: 'missing' }) }); await ready(f);
  assert.equal((await store.list('alice')).items[0].nextAt, row.nextAt, 'Offline loading must not mutate the entry');
  assert.equal(f.calls.length, 0);
  navigator.onLine = true; await f.service.refresh(); await until(() => f.completed.length === 1); await ready(f);
  assert.deepEqual(f.calls.map(x => x.name), ['voiceInputStatus']);
  assert.equal(f.completed[0].failed, true); assert.equal(f.service.canRecord, true); assert.equal((await store.list('alice')).total, 0);
});
test('legacy long backoff resumes with the same UUID and clears its old scheduling marker', async t => {
  environment(t, false); const store = new VoiceQueueStore();
  const row = recording({ attempts: 1, retryWindow: Date.now() - 10000, nextAt: Date.now() + 3600000 }); await store.add(row);
  const f = queue(t, { store, call: () => of({ status: 'queued', eventId }) }); await ready(f);
  assert.equal(f.service.diagnostics.nextAt, 0, 'Diagnostics must use the effective schedule');
  navigator.onLine = true; await f.service.refresh(); await until(() => f.listeners.size === 1); await ready(f);
  assert.equal(f.calls[0].input.requestId, row.id); assert.equal(f.calls.length, 1);
  const saved = (await store.list('alice')).items[0];
  assert.equal(saved.retryWindow, undefined); assert.equal(saved.nextAt, 0); assert.equal(saved.attempts, 2);
});
test('legacy quota waits until UTC midnight instead of bypassing the server daily limit', async t => {
  environment(t); const store = new VoiceQueueStore(), now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const row = recording({ attempts: 1, retryWindow: Date.now() - 10000, nextAt: midnight }); await store.add(row);
  const f = queue(t, { store }); await ready(f);
  assert.equal(f.calls.length, 0); assert.equal(f.service.diagnostics.nextAt, midnight);
  assert.equal((await store.list('alice')).items[0].nextAt, midnight);
});
test('legacy recovery respects an active upload lease from another tab', async t => {
  environment(t); const store = new VoiceQueueStore(), leaseUntil = Date.now() + 150000;
  const row = recording({ attempts: 24, retryWindow: Date.now() - 10000, nextAt: Date.now() + 82532000, leaseId: 'other-tab', leaseUntil }); await store.add(row);
  const f = queue(t, { store }); await ready(f);
  assert.equal(f.calls.length, 0); assert.equal(f.service.diagnostics.nextAt, leaseUntil);
  assert.equal(f.service.label(f.service.items[0]), 'Waiting for upload slot');
});
test('reopening after legacy recovery keeps the new short backoff without repeating immediate recovery', async t => {
  environment(t, false); const store = new VoiceQueueStore();
  const row = recording({ attempts: 1, retryWindow: Date.now() - 10000, nextAt: Date.now() + 82532000 }); await store.add(row);
  const f = queue(t, { store, call: () => throwError(() => ({ code: 'functions/unavailable' })) }); await ready(f);
  navigator.onLine = true; await f.service.refresh(); await until(() => f.calls.length === 1 && !f.service.running); await ready(f);
  const saved = (await store.list('alice')).items[0];
  assert.equal(saved.retryWindow, undefined); assert.equal(saved.attempts, 2); assert.ok(saved.nextAt > Date.now());
  f.service.ngOnDestroy(); const next = queue(t, { store }); await ready(next);
  assert.equal(next.calls.length, 0); assert.equal(next.service.diagnostics.nextAt, saved.nextAt);
});

test('new shared recordings persist their destination across reload without reclassifying legacy audio', async t => {
  const env = environment(t, false), f = queue(t); await ready(f);
  await f.service.enqueue(bytes, 'pilot');
  const sharedId = f.service.items[0].id;
  await f.service.enqueue(bytes);
  const items = (await f.store.list('alice')).items;
  assert.equal(items.find(item => item.id === sharedId).conversationId, 'pilot');
  assert.equal(items.find(item => item.id !== sharedId).conversationId, undefined);
  f.service.ngOnDestroy(); const next = queue(t); await ready(next);
  env.navigator.onLine = true; env.window.dispatchEvent(new Event('online'));
  await until(() => next.completed.length === 2); await ready(next);
  assert.equal(next.calls.find(call => call.input.requestId === sharedId).input.conversationId, 'pilot');
  assert.equal(next.calls.find(call => call.input.requestId !== sharedId).input.conversationId, undefined);
  assert.equal(next.completed.find(result => result.id === sharedId).conversationId, 'pilot');
  assert.equal(next.completed.find(result => result.id !== sharedId).conversationId, undefined);
});
