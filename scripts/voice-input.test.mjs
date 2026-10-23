import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { BehaviorSubject, Subject, firstValueFrom, of, throwError } from 'rxjs';

const require = createRequire(import.meta.url);
const { validateInput, VoiceInputError } = require('../functions/utils/voiceAudio');
const { processVoiceInput } = require('../functions/utils/voiceInput');
const { VOICE_PARTICIPANT } = require('../functions/utils/voiceConversation');
const { transcribe } = require('../functions/utils/voiceTranscription');
function load(file, overrides = {}) {
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true }
  }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, name => overrides[name] || require(name));
  return exports;
}
const diagnosticsModule = load('../src/app/prototypes/voice-input/voiceDiagnostics.ts');
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
  const capture = { start: async () => true, finish: async () => wav(), cancel: () => {}, silenceClosingCue: () => {}, ...captureChanges };
  const calls = [];
  const queue = {
    changed: new Subject(), completed: new Subject(), items: [], canRecord: true,
    start() { this.items = []; },
    async enqueue(bytes) {
      const id = crypto.randomUUID();
      const item = { id, audio: new Blob([bytes]), owner: 'alice' };
      this.items.push(item); this.changed.next();
      const input = { requestId: id, audio: audio.voiceBase64(bytes), sourcePage: '/prototypes/voice-input' };
      calls.push(input);
      try {
        const result = await firstValueFrom(call(input));
        if (!this.items.includes(item)) return;
        this.completed.next({ id, transcript: result.transcript });
        this.items = this.items.filter(row => row !== item);
      } catch {
        if (!this.items.includes(item)) return;
        item.error = 'Could not confirm whether the recording was saved. Audio is kept on this device.';
      }
      this.changed.next();
    }
  };
  const { VoiceInputService } = load('../src/app/prototypes/voice-input/voiceInput.service.ts', {
    '@angular/core': core, './voiceDiagnostics': diagnosticsModule, '@angular/fire/compat/auth': {},
    './voiceCapture.service': {}, './voiceQueue.service': {}, './voiceQueueStore.service': {}
  });
  const service = new VoiceInputService(auth, queue, capture, { run: fn => fn() });
  auth.authState.subscribe(user => service.setAccess(!!user, user?.uid || ''));
  return { service, auth, calls, capture };
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
test('uncertain outcomes retain a pending reply while allowing another recording', async () => {
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
    const { VoiceCaptureService } = load('../src/app/prototypes/voice-input/voiceCapture.service.ts', { '@angular/core': core, './voiceAudio': audio, './voiceCue': { voiceCue: async () => {} } });
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
    '@angular/core': core, './voiceDiagnostics': diagnosticsModule, './voiceCapture.service': {}, './voiceInput.service': {}, './voiceQueue.service': {}, './voiceConversation.service': {}
  });
  const component = new VoiceInputComponent(fixture.service, { allowed: true, uid: 'alice', messages: [], changed: new Subject() }, { markForCheck: () => { marks++; } });
  return { ...fixture, component, marks: () => marks };
}
const pointer = (changes = {}) => ({ pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0,
  timeStamp: 0, clientX: 20, clientY: 20, preventDefault() {}, currentTarget: { setPointerCapture() {} }, ...changes });
function gesture(component, duration, changes = {}) {
  component.pointerDown(pointer(changes));
  component.pointerUp(pointer({ ...changes, timeStamp: duration }));
}
const shortcut = (changes = {}) => ({ key: 'p', code: 'KeyP', preventDefault() { this.defaultPrevented = true; }, ...changes });
const keyTrace = component => component.keyDiagnostics.rows().find(row => row.label === 'P trace').value;
test('an accepted P hold consumes flagged and unflagged repeats without restarting capture or losing live levels', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  let starts = 0, report;
  const { component, service, calls } = componentFixture(client(undefined, { start: async (_limit, _error, level) => {
    starts++; report = level; return true;
  } }));
  component.shortcutKeyDown(shortcut()); await new Promise(setImmediate);
  for (let i = 0; i < 20; i++) {
    t.mock.timers.tick(50);
    const event = shortcut({ repeat: i % 2 === 0 });
    component.shortcutKeyDown(event); report(.6);
    assert.equal(event.defaultPrevented, true);
    assert.equal(service.phase, 'recording');
    assert.equal(service.levels.at(-1), .6);
  }
  assert.equal(starts, 1); assert.equal(calls.length, 0);
  assert.match(component.keyDiagnostics.rows().find(row => row.label === 'P repeats').value, /^20 .*unflagged repeat/);
  assert.doesNotMatch(keyTrace(component), /already down/);
  component.shortcutKeyUp(shortcut()); await new Promise(setImmediate);
  assert.equal(calls.length, 1); assert.equal(service.phase, 'saved');
  assert.match(keyTrace(component), /1000 ms · Held release/);
  component.ngOnDestroy(); service.ngOnDestroy();
});
test('an active P hold still leaves modified shortcuts and other keys untouched', async () => {
  const { component, service } = componentFixture();
  component.shortcutKeyDown(shortcut()); await new Promise(setImmediate);
  for (const changes of [{ ctrlKey: true }, { altKey: true }, { shiftKey: true }, { metaKey: true },
    { isComposing: true }, { key: 'x', code: 'KeyX' }, { target: { isContentEditable: true } },
    { target: { closest: () => ({}) } }]) {
    const event = shortcut(changes); component.shortcutKeyDown(event);
    assert.equal(event.defaultPrevented, undefined);
    assert.equal(service.phase, 'recording');
  }
  component.ngOnDestroy(); service.ngOnDestroy();
});
test('dock diagnostics inspect actual rendered bindings without scrolling or retaining audio', () => {
  const { component, service } = componentFixture();
  component.dock = { nativeElement: { dataset: { phase: 'recording' }, querySelectorAll: () => [
    { style: { height: '4px' } }, { style: { height: '22.4px' } }
  ] } };
  component.ngAfterViewChecked();
  assert.match(component.keyDiagnostics.rows().find(row => row.label === 'Dock DOM').value, /recording · 2 bars · max 22px/);
  component.ngOnDestroy(); service.ngOnDestroy();
});
test('P diagnostics explain a held release during startup and retain the cancelled mic transition', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  let grant;
  const { component, service, calls } = componentFixture(client(undefined, { start: () => new Promise(resolve => { grant = resolve; }) }));
  component.shortcutKeyDown(shortcut()); t.mock.timers.tick(950);
  component.shortcutKeyUp(shortcut());
  assert.match(keyTrace(component), /950 ms · Held release: stop\/cancel · requesting/);
  assert.match(keyTrace(component), /Mic: idle/);
  grant(true); await new Promise(setImmediate);
  assert.equal(service.phase, 'idle'); assert.equal(calls.length, 0);
  component.ngOnDestroy(); service.ngOnDestroy();
});
test('P diagnostics explain ignored Android events, mismatched releases, repeat-only presses and interruption', async () => {
  const { component, service } = componentFixture();
  component.shortcutKeyDown(shortcut({ repeat: true }));
  assert.equal(service.phase, 'idle');
  assert.match(component.keyDiagnostics.rows().find(row => row.label === 'P repeats').value, /Repeat ignored/);
  component.shortcutKeyDown(shortcut({ key: 'Unidentified', code: '', keyCode: 229, isComposing: true }));
  assert.match(keyTrace(component), /Unidentified \/ Empty · 229 · composing · Not P/);
  component.shortcutKeyDown(shortcut()); await new Promise(setImmediate);
  component.shortcutKeyUp(shortcut({ code: '' }));
  assert.equal(service.phase, 'recording'); assert.match(keyTrace(component), /Code mismatch/);
  component.interrupt('Window blur');
  assert.match(keyTrace(component), /Interrupt: Window blur · recording/);
  assert.equal(service.phase, 'idle');
  component.ngOnDestroy(); service.ngOnDestroy();
});
test('P uses the same 600 ms quick-press and hold boundary as pointer input', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  for (const duration of [0, 30, 599, 600, 900]) {
    const { component, service, calls } = componentFixture();
    component.shortcutKeyDown(shortcut());
    assert.equal(service.phase, 'requesting');
    await new Promise(setImmediate);
    t.mock.timers.tick(duration);
    component.shortcutKeyUp(shortcut({ key: 'P', shiftKey: true }));
    await new Promise(setImmediate);
    assert.equal(service.phase, duration >= 600 ? 'saved' : 'recording', `${duration} ms`);
    assert.equal(calls.length, duration >= 600 ? 1 : 0);
    component.ngOnDestroy(); service.ngOnDestroy();
  }
});
test('held P release cancels pending microphone startup without submission', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  let grant;
  const { component, service, calls } = componentFixture(client(undefined, { start: () => new Promise(resolve => { grant = resolve; }) }));
  component.shortcutKeyDown(shortcut()); t.mock.timers.tick(600);
  component.shortcutKeyUp(shortcut()); assert.equal(service.phase, 'idle');
  grant(true); await new Promise(setImmediate);
  assert.equal(service.phase, 'idle'); assert.equal(calls.length, 0);
  component.ngOnDestroy(); service.ngOnDestroy();
});
test('holding P to stop an existing recording never reopens it on release', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const { component, service, calls } = componentFixture();
  await service.press(); component.shortcutKeyDown(shortcut());
  await until(() => service.phase === 'saved');
  t.mock.timers.tick(900); component.shortcutKeyUp(shortcut());
  assert.equal(service.phase, 'saved'); assert.equal(calls.length, 1);
  component.ngOnDestroy(); service.ngOnDestroy();
});
test('stale P releases cannot stop capture after interruptions, account changes or automatic completion', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  for (const action of ['interrupt', 'account', 'automatic completion']) {
    const { component, service, auth } = componentFixture();
    component.shortcutKeyDown(shortcut()); await new Promise(setImmediate);
    t.mock.timers.tick(900);
    if (action === 'interrupt') component.interrupt();
    else if (action === 'account') auth.authState.next({ uid: 'bob' });
    else await service.release();
    await service.press();
    component.shortcutKeyDown(shortcut({ repeat: true }));
    component.shortcutKeyUp(shortcut());
    assert.equal(service.phase, 'recording', action);
    component.ngOnDestroy(); service.ngOnDestroy();
  }
});
test('unrelated key releases and pointer presses do not end a held P gesture', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const { component, service, calls } = componentFixture();
  component.shortcutKeyDown(shortcut()); await new Promise(setImmediate);
  component.pointerDown(pointer()); component.pointerUp(pointer());
  t.mock.timers.tick(600);
  component.shortcutKeyUp(shortcut({ key: 'x', code: 'KeyX' }));
  assert.equal(service.phase, 'recording');
  component.shortcutKeyUp(shortcut()); await until(() => service.phase === 'saved');
  assert.equal(calls.length, 1);
  component.ngOnDestroy(); service.ngOnDestroy();
});
test('P starts recording immediately, ignores repeats, and stops with one submission', async () => {
  const { component, service, calls } = componentFixture();
  const event = shortcut();
  component.shortcutKeyDown(event);
  assert.equal(event.defaultPrevented, true); assert.equal(service.phase, 'requesting');
  await until(() => service.phase === 'recording');
  component.shortcutKeyDown(shortcut({ repeat: true }));
  assert.equal(service.phase, 'recording');
  component.shortcutKeyUp(shortcut());
  component.shortcutKeyDown(shortcut({ key: 'P' }));
  await until(() => service.phase === 'saved'); assert.equal(calls.length, 1);
  component.ngOnDestroy(); service.ngOnDestroy();
});
test('P cancels pending startup and ignores its late permission result', async () => {
  let grant;
  const { component, service, calls } = componentFixture(client(undefined, { start: () => new Promise(resolve => { grant = resolve; }) }));
  component.shortcutKeyDown(shortcut()); assert.equal(service.phase, 'requesting');
  component.shortcutKeyUp(shortcut());
  component.shortcutKeyDown(shortcut()); assert.equal(service.phase, 'idle');
  grant(true); await new Promise(setImmediate);
  assert.equal(service.phase, 'idle'); assert.equal(calls.length, 0);
  component.ngOnDestroy(); service.ngOnDestroy();
});
test('P leaves typing, composition, modified shortcuts and unavailable capture untouched', () => {
  const { component, service, auth } = componentFixture();
  for (const changes of [{ key: 'x' }, { repeat: true }, { isComposing: true }, { defaultPrevented: true },
    { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true },
    { target: { isContentEditable: true } },
    ...['input', 'textarea', 'select', '[role="textbox"]', '[contenteditable]:not([contenteditable="false"])']
      .map(selector => ({ target: { closest: selectors => selectors.includes(selector) ? {} : null } }))]) {
    let prevented = false;
    component.shortcutKeyDown(shortcut({ ...changes, preventDefault() { prevented = true; } }));
    assert.equal(service.phase, 'idle'); assert.equal(prevented, false);
  }
  component.pointerDown(pointer());
  const held = shortcut(); component.shortcutKeyDown(held);
  assert.equal(held.defaultPrevented, undefined); assert.equal(service.phase, 'requesting');
  component.interrupt();
  auth.authState.next(null);
  const signedOut = shortcut(); component.shortcutKeyDown(signedOut);
  assert.equal(signedOut.defaultPrevented, undefined); assert.equal(service.phase, 'idle');
  component.ngOnDestroy(); service.ngOnDestroy();
});
test('touch activates synchronously and even a quick tap stays latched', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const duration of [0, 30, 119, 599]) {
    const { service, component, calls } = componentFixture();
    component.pointerDown(pointer());
    assert.equal(service.phase, 'requesting', 'microphone starts directly in the touch gesture');
    t.mock.timers.tick(duration);
    component.pointerUp(pointer()); await new Promise(setImmediate);
    assert.equal(service.phase, 'recording', `${duration} ms tap starts recording`);
    component.pointerDown(pointer());
    assert.equal(service.phase, 'sending', 'stopping also responds immediately');
    component.pointerUp(pointer()); await new Promise(setImmediate);
    assert.equal(service.phase, 'saved'); assert.equal(calls.length, 1);
    component.ngOnDestroy(); service.ngOnDestroy();
  }
});
test('cancelled touch startup ignores late permission grants without submitting', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const action of ['move', 'cancel', 'lost capture', 'blur', 'account change']) {
    let grant;
    const { service, component, auth, calls } = componentFixture(client(undefined, {
      start: () => new Promise(resolve => { grant = resolve; })
    }));
    component.pointerDown(pointer()); assert.equal(service.phase, 'requesting');
    if (action === 'move') component.pointerMove(pointer({ clientX: 31 }));
    else if (action === 'cancel' || action === 'lost capture') component.pointerCancel(pointer());
    else if (action === 'blur') component.interrupt();
    else auth.authState.next({ uid: 'bob' });
    t.mock.timers.tick(600); component.pointerUp(pointer()); grant(true); await new Promise(setImmediate);
    assert.equal(service.phase, 'idle', action); assert.equal(calls.length, 0, action);
    component.ngOnDestroy(); service.ngOnDestroy();
  }
});
test('a held second touch cancels pending microphone permission before release', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let grant;
  const { component, service, calls } = componentFixture(client(undefined, { start: () => new Promise(resolve => { grant = resolve; }) }));
  component.pointerDown(pointer()); t.mock.timers.tick(120);
  assert.equal(service.phase, 'requesting'); component.pointerUp(pointer());
  component.pointerDown(pointer()); t.mock.timers.tick(120);
  assert.equal(service.phase, 'idle'); component.pointerUp(pointer()); grant(true);
  await new Promise(setImmediate);
  assert.equal(service.phase, 'idle'); assert.equal(calls.length, 0);
  component.ngOnDestroy(); service.ngOnDestroy();
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



test('pending failures leave capture ready and retain their conversation row', async () => {
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
  assert.deepEqual(service.replies.map(reply => reply.kind), ['transcript', 'pending', 'transcript']);
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
  const voice = { replies: [], changed: new Subject(), setAccess() {} };
  const { VoiceInputComponent } = load('../src/app/prototypes/voice-input/voice-input.component.ts', {
    '@angular/core': core, './voiceDiagnostics': diagnosticsModule, './voiceCapture.service': {}, './voiceInput.service': {}, './voiceQueue.service': {}, './voiceConversation.service': {}
  });
  const component = new VoiceInputComponent(voice, { allowed: true, uid: 'alice', messages: [], changed: new Subject() }, { markForCheck() {} });
  component.replies = { nativeElement: { lastElementChild: { scrollIntoView: () => { scrolls++; } } } };
  component.ngAfterViewChecked(); assert.equal(scrolls, 0);
  voice.replies.push({ id: 1, kind: 'transcript', text: 'Hello' });
  component.ngAfterViewChecked(); component.ngAfterViewChecked(); assert.equal(scrolls, 1);
  voice.replies.push({ id: 2, kind: 'error', text: 'No speech detected.' });
  component.ngAfterViewChecked(); assert.equal(scrolls, 2); component.ngOnDestroy();
});

test('old waiting rows precede new shared messages and cannot take their scroll target', () => {
  const { component, service } = componentFixture();
  let scrolls = 0;
  component.replies = { nativeElement: { lastElementChild: { scrollIntoView: () => { scrolls++; } } } };
  const pending = { id: 1, kind: 'pending', text: '', createdAt: 100,
    recording: { id: 'waiting', owner: 'alice', createdAt: 100, conversationId: 'pilot' } };
  service.replies.push(pending);
  component.ngAfterViewChecked();
  const message = { id: 'new', userId: 'bob', requestId: 'remote', text: 'New message', createdAt: { toMillis: () => 200 } };
  component.conversation.messages = [message];
  assert.deepEqual(component.conversationEntries.map(row => row.id), ['reply:1', 'message:new']);
  component.ngAfterViewChecked(); assert.equal(scrolls, 2);
  const entries = component.conversationEntries;
  pending.text = 'Still waiting'; service.changed.next();
  assert.equal(component.conversationEntries, entries, 'Status and waveform updates reuse the ordered timeline');
  component.ngAfterViewChecked(); assert.equal(scrolls, 2);
  component.conversation.messages = [{ ...message, id: 'earlier', createdAt: { toMillis: () => 50 } }, message];
  component.ngAfterViewChecked(); assert.equal(scrolls, 2, 'Loading earlier must keep the scroll position');
  component.ngOnDestroy(); service.ngOnDestroy();
});

test('timeline removes confirmed pending duplicates and hides private and other-conversation replies', () => {
  const { component, service } = componentFixture();
  service.replies.push(
    { id: 1, kind: 'pending', text: '', recording: { id: 'same', conversationId: 'pilot', createdAt: 100 } },
    { id: 2, kind: 'pending', text: '', recording: { id: 'legacy', createdAt: 100 } },
    { id: 3, kind: 'error', text: 'Private', private: true },
    { id: 4, kind: 'error', text: 'Capture error', createdAt: 300 }
  );
  component.conversation.messages = [{ id: 'completed', requestId: 'same', userId: service.uid, createdAt: { toMillis: () => 200 } }];
  assert.deepEqual(component.conversationEntries.map(row => row.id), ['message:completed', 'reply:4']);
  service.replies.splice(0, 3);
  assert.deepEqual(component.conversationEntries.map(row => row.id), ['message:completed', 'reply:4']);
  component.ngOnDestroy(); service.ngOnDestroy();
});

function safariCapture({ stalled = false, permissionPending = false, cue = async () => {} } = {}) {
  const originals = Object.fromEntries(['navigator', 'AudioContext', 'AudioWorkletNode'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const contexts = [], tracks = [], nodes = [], sources = [];
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
    createGain = connection;
    createMediaStreamSource() {
      const source = { connected: false, connect() { this.connected = true; }, disconnect() { this.connected = false; } };
      sources.push(source); return source;
    }
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
  const { VoiceCaptureService } = load('../src/app/prototypes/voice-input/voiceCapture.service.ts', { '@angular/core': core, './voiceAudio': audio, './voiceCue': { voiceCue: cue } });
  const capture = new VoiceCaptureService();
  return { capture, contexts, tracks, nodes, sources, grant: () => grant(), restore() {
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

test('1000 quota applies to the pilot participant or configured trusted admin', async () => {
  for (const [uid, token, highLimitUid, expected] of [
    [VOICE_PARTICIPANT, {}, '', 1000],
    [VOICE_PARTICIPANT + '-other', {}, '', 20],
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
  const db = store(), auth = { uid: VOICE_PARTICIPANT, token: {} };
  let calls = 0;
  const options = settings({ highLimitUid: 'alice', transcribe: async () => { calls++; throw new VoiceInputError('unavailable', 'Failed'); } });
  const day = new Date(options.now()).toISOString().slice(0, 10);
  db.records.set('VoiceInputLimits/' + auth.uid, { day, count: 20, activeUntil: 0 });
  await assert.rejects(processVoiceInput(db, auth, valid, options), rejected('unavailable'));
  assert.equal(db.records.get('VoiceInputLimits/' + auth.uid).count, 21); assert.equal(calls, 1);
  await processVoiceInput(db, auth, request({ requestId: '22345678-1234-1234-1234-123456789abc' }), settings({ highLimitUid: 'alice', now: () => options.now() + 86400000 }));
  assert.equal(db.records.get('VoiceInputLimits/' + auth.uid).count, 1);
});

test('radio cues use distinct quiet pitches, fade cleanly and release their audio nodes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { voiceCue } = load('../src/app/prototypes/voice-input/voiceCue.ts');
  for (const [opening, expectedFrequencies, duration] of [[true, [1040], 95], [false, [920], 95]]) {
    const envelope = [], connections = [], frequencies = [], events = [];
    let stopped, disconnected = 0, resolved = false;
    const gain = { gain: { setValueAtTime: (...args) => envelope.push(args), linearRampToValueAtTime: (...args) => envelope.push(args) },
      connect: node => connections.push(node), disconnect: () => disconnected++ };
    const oscillator = { frequency: { setValueAtTime: (...args) => frequencies.push(args) },
      connect: node => connections.push(node), start() {}, stop: when => { stopped = when; }, disconnect: () => disconnected++ };
    const context = { state: 'running', currentTime: 0, destination: {}, createOscillator: () => oscillator, createGain: () => gain };
    const pending = voiceCue(context, opening, event => events.push(event)).then(() => { resolved = true; });
    assert.deepEqual(events, ['scheduled']);
    assert.deepEqual(frequencies, expectedFrequencies.map((frequency, index) => [frequency, index * .09]));
    assert.equal(oscillator.type, 'triangle');
    assert.deepEqual(envelope, expectedFrequencies.flatMap((_frequency, index) => {
      const start = index * .09;
      return [[0, start], [.07, start + .005], [.07, start + .035], [0, start + .06]];
    }));
    assert.equal(stopped, (expectedFrequencies.length - 1) * .09 + .065);
    assert.deepEqual(connections, [gain, context.destination]);
    t.mock.timers.tick(duration + 50); await Promise.resolve(); assert.equal(resolved, false);
    assert.equal(disconnected, 0, 'Do not truncate playback when the audio timeline stalls.');
    oscillator.onended();
    assert.deepEqual(events, ['scheduled', 'ended']);
    t.mock.timers.tick(29); await Promise.resolve(); assert.equal(resolved, false);
    t.mock.timers.tick(1); await pending; assert.equal(disconnected, 2);
    assert.equal(oscillator.onended, null);
  }
  const events = [];
  await voiceCue({ state: 'suspended' }, true, event => events.push(event));
  await voiceCue({ state: 'running', createOscillator() { throw Error('Playback unavailable'); } }, true, event => events.push(event));
  assert.deepEqual(events, ['skipped', 'failed']);
  await voiceCue({ state: 'suspended' }, true, () => { throw Error('Observer unavailable'); });
});
test('opening cue finishes before microphone samples connect; closing cue follows stopped capture', async () => {
  const cues = [];
  let endCue;
  const fixture = safariCapture({ cue: async (_context, opening) => {
    cues.push(opening);
    assert.equal(fixture.sources.at(-1).connected, false);
    if (!opening) { assert.equal(fixture.tracks.at(-1).stopped, false); assert.equal(fixture.capture.node, undefined); }
    await new Promise(resolve => { endCue = resolve; });
  } });
  try {
    const starting = fixture.capture.start(() => {}, () => {});
    await until(() => cues.length === 1); assert.equal(fixture.sources[0].connected, false);
    endCue(); assert.equal(await starting, true); assert.equal(fixture.sources[0].connected, true);
    fixture.nodes[0].port.onmessage({ data: { type: 'samples', samples: new Float32Array(16000).fill(.1) } });
    const finishing = fixture.capture.finish();
    await until(() => cues.length === 2); assert.deepEqual(cues, [true, false]);
    endCue(); assert.equal((await finishing).length, 32044); assert.equal(fixture.contexts[0].closed, true);
    assert.equal(fixture.tracks[0].stopped, true);
    const cancelled = fixture.capture.start(() => {}, () => {});
    await until(() => cues.length === 3); fixture.capture.cancel(); assert.equal(await cancelled, false);
    endCue(); assert.equal(fixture.contexts[1].closed, true); assert.deepEqual(cues, [true, false, true]);
  } finally { fixture.restore(); }
});


test('stalled cue playback has a 500 ms cleanup deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { voiceCue } = load('../src/app/prototypes/voice-input/voiceCue.ts');
  let disconnected = 0, resolved = false;
  const parameter = { setValueAtTime() {}, linearRampToValueAtTime() {} };
  const oscillator = { frequency: parameter, connect() {}, start() {}, stop() {}, disconnect() { disconnected++; } };
  const gain = { gain: parameter, connect() {}, disconnect() { disconnected++; } };
  const context = { state: 'running', currentTime: 0, destination: {}, createOscillator: () => oscillator, createGain: () => gain };
  const events = [];
  const pending = voiceCue(context, false, event => events.push(event)).then(() => { resolved = true; });
  t.mock.timers.tick(499); await Promise.resolve(); assert.equal(resolved, false);
  t.mock.timers.tick(1); await pending;
  assert.equal(disconnected, 2); assert.equal(oscillator.onended, null);
  assert.deepEqual(events, ['scheduled', 'timeout']);
});
test('audio diagnostics retain cue outcomes and bounded timing evidence without stale callbacks or remote work', async () => {
  const observers = [];
  const fixture = safariCapture({ cue: async (context, opening, observe) => {
    observers.push(observe);
    observe('scheduled');
    context.currentTime = (context.currentTime || 0) + .065;
    context.getOutputTimestamp = () => ({ contextTime: context.currentTime - .01 });
    observe('ended');
  } });
  try {
    assert.equal(fixture.capture.diagnostics.openingCue, 'idle');
    assert.equal(fixture.capture.diagnostics.audioTrace, '');
    assert.equal(await fixture.capture.start(() => {}, () => {}), true);
    const first = fixture.capture.diagnostics;
    assert.equal(first.openingCue, 'ended'); assert.equal(first.closingCue, 'idle');
    assert.match(first.audioTrace, /Context created · 16000Hz/);
    assert.match(first.audioTrace, /Mic acquired[\s\S]*Opening scheduled[\s\S]*Opening ended[\s\S]*Mic connected/);
    assert.match(first.audioTrace, /audio 65ms · output 55ms/);
    fixture.nodes[0].port.onmessage({ data: { type: 'samples', samples: new Float32Array(16000).fill(.1) } });
    assert.equal((await fixture.capture.finish()).length, 32044);
    assert.equal(fixture.capture.diagnostics.closingCue, 'ended');
    assert.match(fixture.capture.diagnostics.audioTrace, /Capture drained[\s\S]*Closing scheduled[\s\S]*Closing ended[\s\S]*Releasing audio/);
    assert.equal(await fixture.capture.start(() => {}, () => {}), true);
    assert.equal(fixture.capture.diagnostics.closingCue, 'idle', 'Each attempt resets previous outcomes.');
    assert.doesNotMatch(fixture.capture.diagnostics.audioTrace, /Closing ended/);
    const before = fixture.capture.diagnostics.audioTrace;
    observers[0]('failed');
    assert.equal(fixture.capture.diagnostics.audioTrace, before, 'Previous attempts cannot overwrite diagnostics.');
    for (let i = 0; i < 100; i++) fixture.contexts[1].onstatechange();
    assert.equal(fixture.capture.diagnostics.audioTrace.split('\n').length, 16);
    assert.match(fixture.capture.diagnostics.audioTrace, /Opening scheduled/);
    fixture.capture.cancel();
    observers.at(-1)('timeout');
    assert.equal(fixture.capture.diagnostics.openingCue, 'ended');
    assert.equal(fixture.contexts.every(context => context.closed), true);
    assert.equal(fixture.tracks.every(track => track.stopped), true);
  } finally { fixture.restore(); }
});
test('interrupting closing feedback releases mic immediately without discarding finished audio', async () => {
  let endCue;
  const fixture = safariCapture({ cue: async (_context, opening) => {
    if (!opening) await new Promise(resolve => { endCue = resolve; });
  } });
  try {
    assert.equal(await fixture.capture.start(() => {}, () => {}), true);
    fixture.nodes[0].port.onmessage({ data: { type: 'samples', samples: new Float32Array(16000).fill(.1) } });
    const pending = fixture.capture.finish();
    await until(() => endCue);
    assert.equal(fixture.tracks[0].stopped, false);
    fixture.capture.silenceClosingCue();
    assert.equal(fixture.tracks[0].stopped, true); assert.equal(fixture.contexts[0].closed, true);
    endCue(); assert.equal((await pending).length, 32044);
  } finally { fixture.restore(); }
});
test('page interruption during submission silences closing feedback without resetting the request', async () => {
  let silence = 0;
  // Pause at capture completion to model the closing cue's lifetime.
  let finish;
  const fixture = client(undefined, { finish: () => new Promise(resolve => { finish = resolve; }), silenceClosingCue: () => { silence++; } });
  await fixture.service.press(); const pending = fixture.service.release();
  fixture.service.cancel(); assert.equal(silence, 1); assert.equal(fixture.service.phase, 'sending');
  finish(wav()); await pending; assert.equal(fixture.calls.length, 1); assert.equal(fixture.service.phase, 'saved');
  fixture.service.ngOnDestroy();
});


test('touch, mouse and pen switch to push-to-talk at exactly 600 ms', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const pointerType of ['touch', 'mouse', 'pen']) {
    for (const duration of [599, 600, 900]) {
      const { service, component, calls } = componentFixture();
      component.pointerDown(pointer({ pointerType }));
      t.mock.timers.tick(Math.min(duration, 120)); await new Promise(setImmediate);
      assert.equal(service.phase, 'recording', pointerType);
      t.mock.timers.tick(duration - 120);
      component.pointerUp(pointer({ pointerType })); await new Promise(setImmediate);
      assert.equal(calls.length, duration >= 600 ? 1 : 0, `${pointerType} at ${duration} ms`);
      assert.equal(service.phase, duration >= 600 ? 'saved' : 'recording');
      component.pointerUp(pointer({ pointerType }));
      assert.equal(calls.length, duration >= 600 ? 1 : 0);
      component.ngOnDestroy(); service.ngOnDestroy();
    }
  }
});
test('release of a long press cancels pending permission and ignores a late grant', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let grant;
  const { service, component, calls } = componentFixture(client(undefined, {
    start: () => new Promise(resolve => { grant = resolve; })
  }));
  component.pointerDown(pointer()); t.mock.timers.tick(600);
  assert.equal(service.phase, 'requesting'); component.pointerUp(pointer());
  assert.equal(service.phase, 'idle'); grant(true); await new Promise(setImmediate);
  assert.equal(service.phase, 'idle'); assert.equal(calls.length, 0);
  component.ngOnDestroy(); service.ngOnDestroy();
});
test('holding a press that stops latched recording never reopens it on release', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const pointerType of ['touch', 'mouse']) {
    const { service, component, calls } = componentFixture();
    await service.press(); component.pointerDown(pointer({ pointerType }));
    t.mock.timers.tick(600); await new Promise(setImmediate);
    assert.equal(calls.length, 1); assert.equal(service.phase, 'saved');
    component.pointerUp(pointer({ pointerType })); await new Promise(setImmediate);
    assert.equal(calls.length, 1); assert.equal(service.phase, 'saved');
    component.ngOnDestroy(); service.ngOnDestroy();
  }
});
test('movement, pointer cancellation, lost capture and interruption cancel held capture without submission', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const action of ['move', 'cancel', 'lost capture', 'blur', 'hidden', 'pagehide']) {
    const { service, component, calls } = componentFixture();
    component.pointerDown(pointer()); t.mock.timers.tick(120); await new Promise(setImmediate);
    t.mock.timers.tick(480);
    if (action === 'move') component.pointerMove(pointer({ clientX: 31 }));
    else if (action === 'cancel' || action === 'lost capture') component.pointerCancel(pointer());
    else component.interrupt();
    component.pointerUp(pointer()); await new Promise(setImmediate);
    assert.equal(service.phase, 'idle', action); assert.equal(calls.length, 0, action);
    component.ngOnDestroy(); service.ngOnDestroy();
  }
});
test('an account change clears the old hold before another capture', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { service, component, auth, calls } = componentFixture();
  component.pointerDown(pointer()); t.mock.timers.tick(120); await new Promise(setImmediate);
  t.mock.timers.tick(480); auth.authState.next({ uid: 'bob' });
  await service.press(); component.pointerUp(pointer()); await new Promise(setImmediate);
  assert.equal(service.phase, 'recording'); assert.equal(calls.length, 0);
  component.ngOnDestroy(); service.ngOnDestroy();
});
test('automatic completion clears the hold so releasing cannot affect a later recording', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { service, component, calls } = componentFixture();
  component.pointerDown(pointer()); t.mock.timers.tick(120); await new Promise(setImmediate);
  t.mock.timers.tick(30000); await new Promise(setImmediate);
  assert.equal(calls.length, 1); assert.equal(service.phase, 'saved');
  await service.press(); component.pointerUp(pointer()); await new Promise(setImmediate);
  assert.equal(service.phase, 'recording'); assert.equal(calls.length, 1);
  component.ngOnDestroy(); service.ngOnDestroy();
});

test('revoked or mismatched participant access cancels capture and prevents further recording', async () => {
  const { service, calls } = client(); await service.press(); assert.equal(service.phase, 'recording');
  service.setAccess(false); assert.equal(service.phase, 'idle'); assert.equal(service.canRecord, false);
  await service.release(); await service.press(); assert.equal(calls.length, 0);
  service.setAccess(true, 'different-account'); assert.equal(service.canRecord, false);
  service.setAccess(true, 'alice'); assert.equal(service.canRecord, true); service.ngOnDestroy();
});

test('shared completion removes the pending local row instead of duplicating the shared transcript', async () => {
  const response = new Subject();
  const { service } = client(() => response);
  await service.press(); const releasing = service.release();
  await until(() => service.queue.items.length === 1);
  const id = service.queue.items[0].id;
  service.queue.completed.next({ id, transcript: 'Shared', conversationId: 'pilot' });
  assert.equal(service.replies.length, 0);
  // The account boundary also suppresses an outstanding upload/capture result.
  service.ngOnDestroy(); response.next({ transcript: 'Shared' }); response.complete(); await releasing;
});
