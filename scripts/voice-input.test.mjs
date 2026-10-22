import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { BehaviorSubject, of, throwError } from 'rxjs';

const require = createRequire(import.meta.url);
const { validateInput, VoiceInputError } = require('../functions/utils/voiceAudio');
const { processVoiceInput } = require('../functions/utils/voiceInput');
const { transcribe } = require('../functions/utils/voiceTranscription');
function load(file, overrides = {}) {
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true }
  }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, name => overrides[name] || require(name));
  return exports;
}
const core = { Injectable: () => target => target, Component: () => target => target, HostListener: () => () => {}, ViewChild: () => () => {} };
const audio = load('../src/app/prototypes/voice-input/voiceAudio.ts');
const wav = (seconds = 1, amplitude = .1) => audio.voiceWav(Float32Array.from({ length: seconds * 16000 }, (_, i) => amplitude * Math.sin(i * .2)));
const request = (changes = {}) => ({ requestId: '12345678-1234-1234-1234-123456789abc', sourcePage: '/prototypes/voice-input', audio: audio.voiceBase64(wav()), ...changes });
const valid = request();
const rejected = code => error => error.code === code;
async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Expected asynchronous work to start within 500 ms.');
}

function store() {
  const records = new Map(), work = { reads: 0, writes: 0, transactions: 0 };
  let queue = Promise.resolve();
  const ref = path => ({ path, update: async data => {
    work.writes++; if (!records.has(path)) throw Error('Missing document');
    records.set(path, { ...records.get(path), ...data });
  } });
  const db = { records, work, doc: ref, runTransaction(fn, options) {
    assert.equal(options.maxAttempts, 3);
    const execute = async () => {
      work.transactions++;
      const writes = [];
      const tx = { get: async doc => { work.reads++; return { exists: records.has(doc.path), data: () => records.get(doc.path) }; },
        create: (doc, data) => { assert.equal(records.has(doc.path), false); writes.push([doc.path, data]); },
        set: (doc, data) => writes.push([doc.path, data]), update: (doc, data) => writes.push([doc.path, { ...records.get(doc.path), ...data }]) };
      const result = await fn(tx);
      writes.forEach(([path, data]) => { work.writes++; records.set(path, data); });
      return result;
    };
    const pending = queue.then(execute); queue = pending.catch(() => undefined); return pending;
  } };
  return db;
}
const settings = (changes = {}) => ({ model: 'gpt-transcribe', timestamp: () => 'server-time', now: () => 1792670400000,
  transcribe: async () => 'Bonjour PERRINN', ...changes });

test('client WAV matches backend format; min/max duration and clipping are enforced', () => {
  assert.equal(validateInput(valid).durationMs, 1000);
  assert.equal(validateInput(request({ audio: audio.voiceBase64(wav(.4)) })).durationMs, 400);
  assert.equal(validateInput(request({ audio: audio.voiceBase64(wav(30)) })).durationMs, 30000);
  assert.throws(() => wav(.39)); assert.throws(() => wav(30.1)); assert.throws(() => wav(1, 0));
  const clipped = audio.voiceWav(new Float32Array(16000).fill(2));
  assert.equal(new DataView(clipped.buffer).getInt16(44, true), 32767);
});
test('server rejects malformed, silent, oversized, forged duration, and unsupported WAVs', () => {
  for (const changes of [{ sourcePage: '/chat' }, { requestId: '../bob' }, { extra: true }, { audio: '!' }, { audio: '='.repeat(1280064) }])
    assert.throws(() => validateInput(request(changes)), rejected('invalid-argument'));
  for (const [offset, value] of [[4, 0], [16, 18], [20, 3], [22, 2], [24, 48000], [28, 96000], [32, 4], [34, 32], [40, 1]]) {
    const bytes = Buffer.from(wav()); bytes.writeUInt32LE(value, offset);
    assert.throws(() => validateInput(request({ audio: bytes.toString('base64') })), rejected('invalid-argument'));
  }
  const silent = Buffer.from(wav()); silent.fill(0, 44);
  assert.throws(() => validateInput(request({ audio: silent.toString('base64') })), rejected('invalid-argument'));
  const long = Buffer.alloc(960046); Buffer.from(wav()).copy(long);
  assert.throws(() => validateInput(request({ audio: long.toString('base64') })), rejected('invalid-argument'));
});
test('auth/validation rejection performs no reads or provider work', async () => {
  const db = store(); let calls = 0;
  const options = settings({ transcribe: async () => { calls++; } });
  await assert.rejects(processVoiceInput(db, null, valid, options), rejected('unauthenticated'));
  await assert.rejects(processVoiceInput(db, { uid: 'alice' }, {}, options), rejected('invalid-argument'));
  assert.deepEqual(db.work, { reads: 0, writes: 0, transactions: 0 }); assert.equal(calls, 0);
});
test('success persists private metadata before return; same-ID replay costs one read and no provider call', async () => {
  const db = store(); let calls = 0;
  const options = settings({ transcribe: async () => { calls++; return 'Bonjour PERRINN'; } });
  const response = await processVoiceInput(db, { uid: 'alice' }, valid, options);
  const event = db.records.get('VoiceInputEvents/' + response.eventId);
  assert.equal(event.transcript, response.transcript); assert.equal(event.userId, 'alice'); assert.equal(event.status, 'completed');
  assert.equal(event.createdAt, 'server-time'); assert.equal(event.sourcePage, valid.sourcePage);
  assert.ok(!('audio' in event)); assert.equal(calls, 1);
  assert.deepEqual(db.work, { reads: 3, writes: 4, transactions: 2 });
  assert.deepEqual(await processVoiceInput(db, { uid: 'alice' }, valid, options), response);
  assert.equal(db.work.reads, 4); assert.equal(db.work.writes, 4); assert.equal(calls, 1);
  const other = await processVoiceInput(db, { uid: 'bob' }, valid, options);
  assert.notEqual(other.eventId, response.eventId);
  assert.equal(db.records.get('VoiceInputEvents/' + other.eventId).userId, 'bob');
});
test('concurrent duplicates and different IDs reserve only one provider call per user', async () => {
  const db = store(); let finish, calls = 0;
  const first = processVoiceInput(db, { uid: 'alice' }, valid, settings({ transcribe: () => { calls++; return new Promise(resolve => { finish = resolve; }); } }));
  await until(() => finish);
  await assert.rejects(processVoiceInput(db, { uid: 'alice' }, valid, settings()), rejected('aborted'));
  await assert.rejects(processVoiceInput(db, { uid: 'alice' }, request({ requestId: '22345678-1234-1234-1234-123456789abc' }), settings()), rejected('resource-exhausted'));
  finish('Saved'); await first; assert.equal(calls, 1); assert.equal(db.records.get('VoiceInputLimits/alice').count, 1);
});
test('same ID cannot be repurposed, daily limit is enforced, and UTC rollover resets it', async () => {
  const db = store(); await processVoiceInput(db, { uid: 'alice' }, valid, settings());
  await assert.rejects(processVoiceInput(db, { uid: 'alice' }, request({ audio: audio.voiceBase64(wav(2)) }), settings()), rejected('invalid-argument'));
  const limit = db.records.get('VoiceInputLimits/alice'); limit.count = 20;
  const next = request({ requestId: '22345678-1234-1234-1234-123456789abc' });
  await assert.rejects(processVoiceInput(db, { uid: 'alice' }, next, settings()), rejected('resource-exhausted'));
  await processVoiceInput(db, { uid: 'alice' }, next, settings({ now: () => 1792670400000 + 86400000 }));
  assert.equal(db.records.get('VoiceInputLimits/alice').count, 1);
});
test('failed provider/persistence leaves no success response and never retranscribes the same ID', async () => {
  for (const failure of ['provider', 'save', 'acknowledgement']) {
    const db = store(); let calls = 0;
    const original = db.doc;
    db.doc = path => {
      const ref = original(path), update = ref.update;
      ref.update = async data => {
        if (path.startsWith('VoiceInputEvents/') && data.status === 'completed') {
          if (failure === 'save') throw Error('write failed');
          if (failure === 'acknowledgement') { await update(data); throw Error('ack lost'); }
        }
        return update(data);
      };
      return ref;
    };
    const options = settings({ transcribe: async () => { calls++; if (failure === 'provider') throw new VoiceInputError('unavailable', 'Failed'); return 'Saved'; } });
    await assert.rejects(processVoiceInput(db, { uid: 'alice' }, valid, options));
    if (failure === 'acknowledgement') assert.equal((await processVoiceInput(db, { uid: 'alice' }, valid, options)).transcript, 'Saved');
    else await assert.rejects(processVoiceInput(db, { uid: 'alice' }, valid, options), rejected('failed-precondition'));
    assert.equal(calls, 1); assert.equal(db.records.get('VoiceInputLimits/alice').activeUntil, 0);
  }
});
test('provider receives one WAV upload with configured model; unsafe errors are sanitized and never retried', async () => {
  let calls = 0;
  const options = { apiKey: 'fake-test-key', model: 'configured-model', fetcher: async (url, init) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(init.body.get('model'), 'configured-model'); assert.equal(init.body.get('file').type, 'audio/wav');
    return { ok: true, json: async () => ({ text: '  Bonjour  ' }) };
  } };
  assert.equal(await transcribe(Buffer.from(wav()), options), 'Bonjour'); assert.equal(calls, 1);
  await assert.rejects(transcribe(Buffer.from(wav()), { ...options, fetcher: async () => { calls++; throw Error('SECRET PROVIDER RESPONSE'); } }),
    error => error.code === 'unavailable' && !error.message.includes('SECRET'));
  assert.equal(calls, 2);
});

function client(call = () => of({ eventId: 'saved-id', transcript: 'Bonjour' }), captureChanges = {}) {
  const authState = new BehaviorSubject({ uid: 'alice' });
  const auth = { authState, currentUser: Promise.resolve({ uid: 'alice' }) };
  const capture = { start: async () => true, finish: async () => wav(), cancel: () => {}, ...captureChanges };
  const calls = [];
  const functions = { httpsCallable: () => input => { calls.push(input); return call(input); } };
  const { VoiceInputService } = load('../src/app/prototypes/voice-input/voiceInput.service.ts', {
    '@angular/core': core, '@angular/fire/compat/auth': {}, '@angular/fire/compat/functions': {},
    './voiceCapture.service': {}, './voiceAudio': audio
  });
  return { service: new VoiceInputService(auth, functions, capture, { run: fn => fn() }), auth, calls, capture };
}
test('release during permission prompt and cancellation never submit, including late permission grants', async () => {
  let grant, cancel = 0;
  const fixture = client(undefined, { start: () => new Promise(resolve => { grant = resolve; }), cancel: () => { cancel++; } });
  const pending = fixture.service.press(); assert.equal(fixture.service.phase, 'requesting');
  await fixture.service.release(); grant(true); await pending;
  assert.equal(fixture.service.phase, 'idle'); assert.equal(fixture.calls.length, 0); assert.ok(cancel > 0);
  fixture.service.ngOnDestroy();
});
test('normal release saves; repeated release does not duplicate, and sign-out clears transcript', async () => {
  const { service, auth, calls } = client(); await service.press();
  const phases = []; service.changed.subscribe(() => phases.push(service.phase));
  await Promise.all([service.release(), service.release()]);
  assert.equal(calls.length, 1); assert.equal(service.phase, 'saved'); assert.equal(service.replies.at(-1)?.text, 'Bonjour');
  assert.ok(phases.includes('saved'), 'Async completion must notify the rendered component without another gesture.');
  auth.authState.next(null); assert.deepEqual(service.replies, []); assert.equal(service.canRecord, false); service.ngOnDestroy();
});
test('unknown outcomes automatically allow a fresh recording without replaying the prior request', async () => {
  let attempt = 0;
  const { service, calls } = client(() => ++attempt === 1 ? throwError(() => ({ code: 'functions/deadline-exceeded' })) : of({ eventId: 'saved', transcript: 'Next recording' }));
  await service.press(); await service.release();
  assert.equal(service.canRecord, true); assert.equal(service.label, 'Start recording'); assert.equal(calls.length, 1);
  assert.match(service.replies.at(-1)?.text, /Could not confirm/);
  await service.press(); assert.equal(service.replies.length, 1); await service.release();
  assert.equal(calls.length, 2); assert.notEqual(calls[0].requestId, calls[1].requestId);
  assert.equal(service.replies.at(-1)?.text, 'Next recording'); assert.equal(service.canRecord, true); service.ngOnDestroy();
});
test('auth change during response discards result; permission denial and empty recordings are recoverable', async () => {
  let deliver;
  const { Observable } = require('rxjs');
  const fixture = client(() => new Observable(subscriber => { deliver = subscriber; }));
  await fixture.service.press(); const pending = fixture.service.release();
  await until(() => deliver);
  fixture.auth.authState.next({ uid: 'bob' }); deliver.next({ eventId: 'private', transcript: 'Alice only' }); deliver.complete(); await pending;
  assert.deepEqual(fixture.service.replies, []); fixture.service.ngOnDestroy();
  const denied = client(undefined, { start: async () => { throw { name: 'NotAllowedError' }; } });
  await denied.service.press(); assert.match(denied.service.replies.at(-1)?.text, /denied/); assert.equal(denied.service.canRecord, true); denied.service.ngOnDestroy();
  const empty = client(undefined, { finish: async () => { throw Error('No speech detected. Try again.'); } });
  await empty.service.press(); await empty.service.release(); assert.equal(empty.calls.length, 0); assert.match(empty.service.replies.at(-1)?.text, /No speech/); empty.service.ngOnDestroy();
});
test('worklet hard-caps capture at 30 seconds and flushes the final partial block before stopped', () => {
  let Processor; const messages = [];
  const scope = { AudioWorkletProcessor: class { port = { postMessage: message => messages.push(message) }; }, Float32Array,
    registerProcessor: (_, processor) => { Processor = processor; } };
  vm.runInNewContext(readFileSync(new URL('../src/assets/voice-input/capture.worklet.js', import.meta.url), 'utf8'), scope);
  const recorder = new Processor();
  for (let i = 0; i < 4000; i++) recorder.process([[new Float32Array(128).fill(.1)]]);
  assert.equal(messages.filter(item => item.type === 'samples').reduce((sum, item) => sum + item.samples.length, 0), 480000);
  assert.equal(messages.filter(item => item.type === 'limit').length, 1);
  recorder.port.onmessage({ data: 'stop' }); assert.equal(messages.at(-1).type, 'stopped');
});

test('capture cancels late microphone grants, drains samples on normal release, and stops every track', async () => {
  const originals = Object.fromEntries(['navigator', 'AudioContext', 'AudioWorkletNode'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let grant, stops = 0, closes = 0, node;
  const track = { stop: () => { stops++; } }, stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const connection = () => ({ gain: { value: 1 }, connect() {}, disconnect() {} });
  class Context {
    sampleRate = 16000; state = 'running'; audioWorklet = { addModule: async () => {} };
    resume = async () => {}; close = async () => { closes++; };
    createGain = connection; createMediaStreamSource = connection;
  }
  class Node {
    constructor() { node = this; }
    connect() {} disconnect() {}
    port = { close() {}, postMessage: () => queueMicrotask(() => this.port.onmessage?.({ data: { type: 'stopped' } })) };
  }
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(resolve => { grant = resolve; }) } } });
    Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
    Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: Node });
    const { VoiceCaptureService } = load('../src/app/prototypes/voice-input/voiceCapture.service.ts', { '@angular/core': core, './voiceAudio': audio });
    const capture = new VoiceCaptureService();
    const first = capture.start(() => {}, () => {}); capture.cancel(); grant(stream);
    assert.equal(await first, false); assert.equal(stops, 1); assert.equal(closes, 1);
    navigator.mediaDevices.getUserMedia = async () => stream;
    const levels = [];
    assert.equal(await capture.start(() => {}, () => {}, level => levels.push(level)), true);
    node.port.onmessage({ data: { type: 'samples', samples: new Float32Array(2048) } });
    assert.equal(levels.at(-1), 0);
    node.port.onmessage({ data: { type: 'samples', samples: new Float32Array(2048).fill(.5) } });
    assert.equal(levels.at(-1), 1);
    // Start fresh so the final WAV assertion still verifies one second of captured audio.
    capture.cancel();
    assert.equal(await capture.start(() => {}, () => {}, level => levels.push(level)), true);
    node.port.onmessage({ data: { type: 'samples', samples: Float32Array.from({ length: 16000 }, (_, i) => .1 * Math.sin(i * .2)) } });
    assert.equal((await capture.finish()).length, 32044); assert.equal(stops, 3); assert.equal(closes, 3);
    assert.ok(levels.at(-1) > 0 && levels.at(-1) < 1);
    assert.equal(capture.node, undefined);
    capture.ngOnDestroy();
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});


test('audio history is bounded, clears on release/cancel, and ignores late capture callbacks', async () => {
  let report;
  const { service } = client(undefined, { start: async (_limit, _error, level) => { report = level; return true; } });
  await service.press();
  for (let i = 0; i < 20; i++) report(.5);
  assert.deepEqual(service.levels, Array(9).fill(.5));
  report(0); assert.equal(service.levels.at(-1), 0);
  await service.release(); assert.deepEqual(service.levels, Array(9).fill(0));
  report(1); assert.deepEqual(service.levels, Array(9).fill(0));
  await service.press(); const oldReport = report;
  report(.8); service.cancel();
  assert.deepEqual(service.levels, Array(9).fill(0));
  await service.press(); oldReport(1);
  assert.deepEqual(service.levels, Array(9).fill(0));
  service.ngOnDestroy(); report(1);
  assert.deepEqual(service.levels, Array(9).fill(0));
});

function componentFixture(fixture = client()) {
  let marks = 0;
  const { VoiceInputComponent } = load('../src/app/prototypes/voice-input/voice-input.component.ts', {
    '@angular/core': core, './voiceCapture.service': {}, './voiceInput.service': {}
  });
  const component = new VoiceInputComponent(fixture.service, { markForCheck: () => { marks++; } });
  return { ...fixture, component, marks: () => marks };
}
const pointer = (changes = {}) => ({ pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0,
  timeStamp: 0, clientX: 20, clientY: 20, preventDefault() {}, currentTarget: { setPointerCapture() {} }, ...changes });
function gesture(component, duration, changes = {}) {
  component.pointerDown(pointer(changes));
  component.pointerUp(pointer({ ...changes, timeStamp: duration }));
}
test('touch toggle ignores quick taps, movement and cancelled gestures when opening and closing', async () => {
  const { service, component, calls, marks } = componentFixture();
  gesture(component, 199); assert.equal(service.phase, 'idle');
  component.pointerDown(pointer());
  component.pointerMove(pointer({ clientX: 31 }));
  component.pointerUp(pointer({ timeStamp: 300 })); assert.equal(service.phase, 'idle');
  component.pointerDown(pointer()); component.pointerCancel(pointer());
  component.pointerUp(pointer({ timeStamp: 300 })); assert.equal(service.phase, 'idle');
  gesture(component, 200); await until(() => service.phase === 'recording');
  gesture(component, 50); assert.equal(service.phase, 'recording');
  component.pointerDown(pointer()); component.pointerCancel(pointer());
  component.pointerUp(pointer({ timeStamp: 300 })); assert.equal(service.phase, 'recording');
  component.pointerDown(pointer()); component.pointerUp(pointer({ timeStamp: 300, clientY: 31 }));
  assert.equal(service.phase, 'recording');
  gesture(component, 250); await until(() => service.phase === 'saved');
  assert.equal(calls.length, 1); assert.ok(marks() > 0);
  const previous = marks(); component.ngOnDestroy(); service.changed.next(); assert.equal(marks(), previous);
  service.ngOnDestroy();
});
test('mouse and keyboard toggle immediately, pending startup cancels, and sending cannot overlap', async () => {
  let grant;
  const fixture = componentFixture(client(undefined, { start: () => new Promise(resolve => { grant = resolve; }) }));
  const { component, service, calls } = fixture;
  gesture(component, 1, { pointerType: 'mouse' }); assert.equal(service.phase, 'requesting');
  gesture(component, 1, { pointerType: 'mouse' }); grant(true);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(service.phase, 'idle'); assert.equal(calls.length, 0);
  component.toggle(); grant(true); await until(() => service.phase === 'recording');
  let prevented = 0;
  component.keyDown({ key: 'Enter', repeat: true, preventDefault() { prevented++; } });
  assert.equal(prevented, 1); assert.equal(service.phase, 'recording');
  component.toggle(); component.toggle(); await until(() => service.phase === 'saved'); assert.equal(calls.length, 1);
  component.toggle(); grant(true); await until(() => service.phase === 'recording');
  component.keyDown({ key: 'Escape', preventDefault() {} }); assert.equal(service.phase, 'idle');
  component.ngOnDestroy(); service.ngOnDestroy();
});



test('submission failures leave the control ready without a recovery action or automatic retry', async () => {
  for (const code of ['unavailable', 'aborted', 'failed-precondition', 'resource-exhausted', 'invalid-argument', 'unauthenticated']) {
    const { service, calls } = client(() => throwError(() => ({ code: 'functions/' + code })));
    await service.press(); await service.release();
    assert.equal(service.canRecord, true, code); assert.equal(service.label, 'Start recording');
    assert.equal(calls.length, 1); assert.ok(service.replies.at(-1)?.text);
    await service.press(); assert.equal(service.phase, 'recording'); assert.equal(service.replies.length, 1);
    service.ngOnDestroy();
  }
});


test('conversation appends one ordered reply per result and preserves earlier replies during capture', async () => {
  let attempt = 0;
  const { service, auth } = client(() => ++attempt === 2
    ? throwError(() => ({ code: 'functions/unavailable' }))
    : of({ eventId: 'event-' + attempt, transcript: 'Transcript ' + attempt }));
  await service.press(); await Promise.all([service.release(), service.release()]);
  assert.deepEqual(service.replies.map(reply => [reply.kind, reply.text]), [['transcript', 'Transcript 1']]);
  const first = service.replies[0];
  await service.press(); assert.equal(service.replies[0], first); await service.release();
  await service.press(); await service.release();
  assert.deepEqual(service.replies.map(reply => reply.kind), ['transcript', 'error', 'transcript']);
  assert.equal(new Set(service.replies.map(reply => reply.id)).size, 3);
  assert.equal(service.replies[0], first); assert.match(service.replies[1].text, /Could not confirm/);
  await service.press(); service.cancel(); assert.equal(service.replies.length, 3);
  await service.press(); service.cancel('Recording interrupted. Try again.');
  assert.equal(service.replies.length, 4); assert.equal(service.replies.at(-1).kind, 'error');
  auth.authState.next({ uid: 'bob' }); assert.deepEqual(service.replies, []);
  service.ngOnDestroy();
});
test('permission and local capture failures become conversation replies without provider calls', async () => {
  const fixture = client(undefined, { start: async () => { throw { name: 'NotAllowedError' }; } });
  await fixture.service.press();
  assert.equal(fixture.service.replies.length, 1); assert.match(fixture.service.replies[0].text, /denied/);
  fixture.capture.start = async () => true;
  fixture.capture.finish = async () => { throw Error('No speech detected. Try again.'); };
  await fixture.service.press(); await fixture.service.release();
  assert.equal(fixture.service.replies.length, 2); assert.match(fixture.service.replies[1].text, /No speech/);
  assert.equal(fixture.calls.length, 0); fixture.service.ngOnDestroy();
});
test('new replies scroll into view once, without repeated scrolling on audio-level updates', () => {
  const { Subject } = require('rxjs'); let scrolls = 0;
  const voice = { replies: [], changed: new Subject() };
  const { VoiceInputComponent } = load('../src/app/prototypes/voice-input/voice-input.component.ts', {
    '@angular/core': core, './voiceCapture.service': {}, './voiceInput.service': {}
  });
  const component = new VoiceInputComponent(voice, { markForCheck() {} });
  component.replies = { nativeElement: { lastElementChild: { scrollIntoView: () => { scrolls++; } } } };
  component.ngAfterViewChecked(); assert.equal(scrolls, 0);
  voice.replies.push({ id: 1, kind: 'transcript', text: 'Hello' });
  component.ngAfterViewChecked(); component.ngAfterViewChecked(); assert.equal(scrolls, 1);
  voice.replies.push({ id: 2, kind: 'error', text: 'No speech detected.' });
  component.ngAfterViewChecked(); assert.equal(scrolls, 2); component.ngOnDestroy();
});

function safariCapture({ stalled = false, permissionPending = false } = {}) {
  const originals = Object.fromEntries(['navigator', 'AudioContext', 'AudioWorkletNode'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const contexts = [], tracks = [], nodes = [];
  let grant;
  const connection = () => ({ gain: { value: 1 }, connect() {}, disconnect() {} });
  class Context {
    sampleRate = 16000; state = 'suspended'; resumes = 0; closed = false;
    audioWorklet = { addModule: async () => {} };
    constructor() { contexts.push(this); }
    resume() {
      this.resumes++;
      // Reopening the microphone can leave the gesture's resume unresolved.
      if (stalled || (contexts.length > 1 && this.resumes === 1)) return new Promise(() => {});
      this.state = 'running'; return Promise.resolve();
    }
    async close() { this.closed = true; this.state = 'closed'; }
    createGain = connection; createMediaStreamSource = connection;
  }
  class Node {
    constructor() { nodes.push(this); }
    connect() {} disconnect() {}
    port = { close() {}, postMessage: () => queueMicrotask(() => this.port.onmessage?.({ data: { type: 'stopped' } })) };
  }
  const stream = () => {
    const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => permissionPending
    ? new Promise(resolve => { grant = () => resolve(stream()); }) : Promise.resolve(stream()) } } });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: Node });
  const { VoiceCaptureService } = load('../src/app/prototypes/voice-input/voiceCapture.service.ts', { '@angular/core': core, './voiceAudio': audio });
  const capture = new VoiceCaptureService();
  return { capture, contexts, tracks, nodes, grant: () => grant(), restore() {
    capture.ngOnDestroy();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  } };
}

test('second recording resumes again after microphone acquisition without waiting on a stalled first resume', { timeout: 1000 }, async () => {
  const fixture = safariCapture();
  try {
    for (let recording = 0; recording < 2; recording++) {
      assert.equal(await fixture.capture.start(() => {}, () => {}), true);
      const node = fixture.nodes.at(-1);
      node.port.onmessage({ data: { type: 'samples', samples: new Float32Array(16000).fill(.1) } });
      assert.equal((await fixture.capture.finish()).length, 32044);
      assert.ok(fixture.tracks.at(-1).stopped); assert.ok(fixture.contexts.at(-1).closed);
    }
    assert.equal(fixture.contexts[0].resumes, 1); assert.equal(fixture.contexts[1].resumes, 2);
  } finally { fixture.restore(); }
});

test('startup deadline begins after permission, releases the microphone, and cancellation settles without permission', { timeout: 1000 }, async () => {
  const fixture = safariCapture({ stalled: true, permissionPending: true });
  const originalTimeout = globalThis.setTimeout;
  let expire, deadlineCount = 0;
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay !== 5000) return originalTimeout(callback, delay, ...args);
    deadlineCount++; expire = callback; return undefined;
  };
  try {
    const cancelled = fixture.capture.start(() => {}, () => {});
    assert.equal(deadlineCount, 0); fixture.capture.cancel();
    assert.equal(await cancelled, false);
    fixture.grant(); await Promise.resolve(); assert.ok(fixture.tracks[0].stopped);
    const pending = fixture.capture.start(() => {}, () => {});
    const rejected = assert.rejects(pending, /startup timed out/);
    assert.equal(deadlineCount, 0); fixture.grant();
    await Promise.resolve(); assert.equal(deadlineCount, 1);
    expire(); await rejected;
    assert.ok(fixture.tracks.at(-1).stopped); assert.ok(fixture.contexts.at(-1).closed);
    assert.equal(fixture.capture.node, undefined);
  } finally { globalThis.setTimeout = originalTimeout; fixture.restore(); }
});

test('temporary 1000 quota requires configured identity and exact trusted admin claim', async () => {
  for (const [uid, token, highLimitUid, expected] of [
    ['alice', { perrinnAdmin: true }, 'alice', 1000],
    ['alice', {}, 'alice', 20],
    ['alice', { perrinnAdmin: 'true' }, 'alice', 20],
    ['bob', { perrinnAdmin: true }, 'alice', 20],
    ['alice', { perrinnAdmin: true }, '', 20]
  ]) {
    const db = store(), options = settings({ highLimitUid });
    const day = new Date(options.now()).toISOString().slice(0, 10);
    db.records.set('VoiceInputLimits/' + uid, { day, count: expected - 1, activeUntil: 0 });
    await processVoiceInput(db, { uid, token }, valid, options);
    assert.equal(db.records.get('VoiceInputLimits/' + uid).count, expected);
    const work = { ...db.work };
    await assert.rejects(processVoiceInput(db, { uid, token }, request({ requestId: '22345678-1234-1234-1234-123456789abc' }), options),
      error => error.code === 'resource-exhausted' && error.details.reason === 'daily-limit' && error.details.dailyLimit === expected);
    assert.equal(db.work.writes, work.writes, 'Quota rejection must not write or call the provider');
  }
});

test('raised allowance reuses today counter, counts failures and resets at UTC rollover', async () => {
  const db = store(), auth = { uid: 'alice', token: { perrinnAdmin: true } };
  let calls = 0;
  const options = settings({ highLimitUid: 'alice', transcribe: async () => { calls++; throw new VoiceInputError('unavailable', 'Failed'); } });
  const day = new Date(options.now()).toISOString().slice(0, 10);
  db.records.set('VoiceInputLimits/alice', { day, count: 20, activeUntil: 0 });
  await assert.rejects(processVoiceInput(db, auth, valid, options), rejected('unavailable'));
  assert.equal(db.records.get('VoiceInputLimits/alice').count, 21); assert.equal(calls, 1);
  await processVoiceInput(db, auth, request({ requestId: '22345678-1234-1234-1234-123456789abc' }), settings({ highLimitUid: 'alice', now: () => options.now() + 86400000 }));
  assert.equal(db.records.get('VoiceInputLimits/alice').count, 1);
});

test('client clearly distinguishes daily quotas, active recordings and unrecognised errors', async () => {
  for (const [details, expected] of [
    [{ reason: 'daily-limit', dailyLimit: 20 }, /daily limit of 20 recordings.*midnight UTC/],
    [{ reason: 'daily-limit', dailyLimit: 1000 }, /daily limit of 1,000 recordings.*midnight UTC/],
    [{ reason: 'recording-processing' }, /previous recording is still processing/],
    [undefined, /temporarily unavailable/],
    [{ reason: 'daily-limit', dailyLimit: '<unsafe>' }, /temporarily unavailable/]
  ]) {
    const { service } = client(() => throwError(() => ({ code: 'functions/resource-exhausted', details, message: 'PRIVATE ERROR' })));
    await service.press(); await service.release();
    assert.match(service.replies.at(-1).text, expected);
    assert.ok(!service.replies.at(-1).text.includes('PRIVATE')); assert.equal(service.canRecord, true);
    service.ngOnDestroy();
  }
});
