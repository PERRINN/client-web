import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { BehaviorSubject, Subject, firstValueFrom, of, throwError } from 'rxjs';

const require = createRequire(import.meta.url);
const { validateInput, VoiceInputError } = require('../functions/utils/voiceAudio');
const { transcribe } = require('../functions/utils/voiceTranscription');
function load(file, overrides = {}) {
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true }
  }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, name => overrides[name] || overrides[name.replace('../../voice/', './')] || require(name));
  return exports;
}
const diagnosticsModule = load('../src/app/voice/voiceDiagnostics.ts');
const core = { Injectable: () => target => target, Component: () => target => target, HostListener: () => () => {}, ViewChild: () => () => {} };
const audioSessionModule = load('../src/app/voice/voiceAudioSession.service.ts', { '@angular/core': core });
const audio = load('../src/app/voice/voiceAudio.ts');
const captureSettings = load('../src/app/voice/voiceCaptureSettings.ts');
const wav = (seconds = 1, amplitude = .1) => audio.voiceWav(Float32Array.from({ length: seconds * 16000 }, (_, i) => amplitude * Math.sin(i * .2)));
const request = (changes = {}) => ({ requestId: '12345678-1234-1234-1234-123456789abc', sourcePage: '/chat', audio: audio.voiceBase64(wav()), ...changes });
const valid = request();
const rejected = code => error => error.code === code;
async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Expected asynchronous work to start within 500 ms.');
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
  for (const changes of [{ sourcePage: '/prototypes/voice-input' }, { requestId: '../bob' }, { extra: true }, { audio: '!' }, { audio: '='.repeat(1280064) }])
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
      const input = { requestId: id, audio: audio.voiceBase64(bytes), sourcePage: '/chat' };
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
  const { VoiceInputService } = load('../src/app/voice/voiceInput.service.ts', {
    '@angular/core': core, './voiceDiagnostics': diagnosticsModule, '@angular/fire/compat/auth': {},
    './voiceAudio': audio, './voiceAudioSession.service': audioSessionModule, './voiceCaptureSettings': captureSettings, './voiceCapture.service': {}, './voiceQueue.service': {}, './voiceQueueStore.service': {}
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
test('deferred worklet confirms real input once and discards all samples until armed', () => {
  let Processor; const messages = [];
  const scope = { AudioWorkletProcessor: class { port = { postMessage: message => messages.push(message) }; }, Float32Array,
    registerProcessor: (_, processor) => { Processor = processor; } };
  vm.runInNewContext(readFileSync(new URL('../src/assets/voice-input/capture.worklet.js', import.meta.url), 'utf8'), scope);
  const recorder = new Processor({ processorOptions: { deferCapture: true } });
  recorder.process([]); recorder.process([[new Float32Array(0)]]);
  assert.equal(messages.length, 0, 'No readiness without an input block.');
  for (let i = 0; i < 1000; i++) recorder.process([[new Float32Array(128).fill(.9)]]);
  assert.equal(messages.length, 1); assert.equal(messages[0].type, 'ready');
  assert.equal(recorder.total, 0); assert.equal(recorder.offset, 0);
  recorder.port.onmessage({ data: 'start' });
  for (let i = 0; i < 4000; i++) {
    recorder.port.onmessage({ data: 'start' });
    recorder.process([[new Float32Array(128).fill(.1)]]);
  }
  const samples = messages.filter(item => item.type === 'samples');
  assert.equal(samples.reduce((total, item) => total + item.samples.length, 0), 480000);
  assert.ok(samples.every(item => item.samples.every(sample => Math.abs(sample - .1) < .00001)));
  assert.equal(messages.filter(item => item.type === 'limit').length, 1);
  assert.equal(messages.filter(item => item.type === 'ready').length, 1);
  recorder.port.onmessage({ data: 'start' }); recorder.process([[new Float32Array(128)]]);
  assert.equal(recorder.total, 480000, 'Start cannot bypass the hard sample cap.');
  const beforeCancel = messages.length;
  const cancelled = new Processor({ processorOptions: { deferCapture: true } });
  cancelled.port.onmessage({ data: 'stop' }); cancelled.port.onmessage({ data: 'start' });
  cancelled.process([[new Float32Array(128).fill(.9)]]);
  assert.equal(cancelled.total, 0, 'Stop before arming cannot be undone.');
  assert.equal(messages.length, beforeCancel + 1, 'Stopped input must not announce readiness.');
  assert.equal(messages.at(-1).type, 'stopped');
});

test('capture cancels late microphone grants, drains samples on normal release, and stops every track', async () => {
  const originals = Object.fromEntries(['navigator', 'AudioContext', 'AudioWorkletNode'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let grant, stops = 0, closes = 0, node;
  const track = { stop: () => { stops++; } }, stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const connection = () => ({ gain: { value: 1 }, connect() {}, disconnect() {} });
  class Context {
    sampleRate = 16000; state = 'running'; audioWorklet = { addModule: async () => {} };
    resume = async () => {}; close = async () => { closes++; };
    createGain = connection;
    createMediaStreamSource = () => ({ connect: target => queueMicrotask(() => target.port.onmessage?.({ data: { type: 'ready' } })), disconnect() {} });
  }
  class Node {
    constructor() { node = this; }
    connect() {} disconnect() {}
    commands = [];
    port = { close() {}, postMessage: message => {
      this.commands.push(message);
      if (message === 'stop') queueMicrotask(() => this.port.onmessage?.({ data: { type: 'stopped' } }));
    } };
  }
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(resolve => { grant = resolve; }) } } });
    Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
    Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: Node });
    const { VoiceCaptureService } = load('../src/app/voice/voiceCapture.service.ts', { '@angular/core': core, './voiceAudio': audio, './voiceAudioSession.service': audioSessionModule, './voiceCaptureSettings': captureSettings, './voiceCue': { voiceCue: async () => {} } });
    const session = new audioSessionModule.VoiceAudioSessionService();
  const capture = new VoiceCaptureService(session);
    const first = capture.start(() => {}, () => {}); capture.cancel(); grant(stream);
    assert.equal(await first, false); assert.equal(stops, 1); assert.equal(closes, 0);
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
    assert.equal((await capture.finish()).length, 32044); assert.equal(stops, 3); assert.equal(closes, 0);
    assert.ok(levels.at(-1) > 0 && levels.at(-1) < 1);
    assert.equal(capture.node, undefined);
    capture.ngOnDestroy(); session.ngOnDestroy(); assert.equal(closes, 1);
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

function safariCapture({ stalled = false, permissionPending = false, inputPending = false, cue = async () => {}, actualEchoCancellation, settingsError = false, browser = { userAgent: 'iPhone' } } = {}) {
  const originals = Object.fromEntries(['navigator', 'AudioContext', 'AudioWorkletNode'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const contexts = [], tracks = [], nodes = [], sources = [], constraints = [];
  let grant;
  const connection = () => ({ gain: { value: 1 }, connect() {}, disconnect() {} });
  class Context {
    sampleRate = 16000; state = 'suspended'; resumes = 0; closed = false;
    workletLoads = 0;
    audioWorklet = { addModule: async () => { this.workletLoads++; } };
    constructor() { contexts.push(this); }
    resume() {
      this.resumes++;
      // Reopening the microphone can leave the gesture's resume unresolved.
      if (stalled || this.resumes === 2) return new Promise(() => {});
      this.state = 'running'; return Promise.resolve();
    }
    async close() { this.closed = true; this.state = 'closed'; }
    createGain = connection;
    createMediaStreamSource() {
      const source = { connected: false, connect(target) {
        this.connected = true;
        if (!inputPending) queueMicrotask(() => target.port.onmessage?.({ data: { type: 'ready' } }));
      }, disconnect() { this.connected = false; } };
      sources.push(source); return source;
    }
  }
  class Node {
    constructor() { nodes.push(this); }
    connect() {} disconnect() {}
    commands = [];
    port = { close() {}, postMessage: message => {
      this.commands.push(message);
      if (message === 'stop') queueMicrotask(() => this.port.onmessage?.({ data: { type: 'stopped' } }));
    } };
  }
  const stream = () => {
    const track = { stopped: false, stop() { this.stopped = true; }, getSettings() { if (settingsError) throw Error('SECRET ERROR'); return { echoCancellation: actualEchoCancellation, deviceId: 'SECRET_DEVICE' }; } }; tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { ...browser, mediaDevices: { getUserMedia: request => { constraints.push(request); return permissionPending
    ? new Promise(resolve => { grant = () => resolve(stream()); }) : Promise.resolve(stream()); } } } });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: Node });
  const { VoiceCaptureService } = load('../src/app/voice/voiceCapture.service.ts', { '@angular/core': core, './voiceAudio': audio, './voiceAudioSession.service': audioSessionModule, './voiceCaptureSettings': captureSettings, './voiceCue': { voiceCue: cue } });
  const session = new audioSessionModule.VoiceAudioSessionService();
  const capture = new VoiceCaptureService(session);
  return { capture, session, contexts, tracks, nodes, sources, constraints, grant: () => grant(), restore() {
    capture.ngOnDestroy(); session.ngOnDestroy();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  } };
}

test('capture keeps recording mode through both cues and returns to media playback after releasing tracks', async () => {
  const session = { type: 'auto' }, modes = [];
  const fixture = safariCapture({ browser: { userAgent: 'iPhone', audioSession: session }, cue: async (_context, opening) => {
    modes.push(opening);
    assert.equal(session.type, 'play-and-record');
    assert.equal(fixture.tracks.at(-1).stopped, false);
  } });
  try {
    fixture.session.acquire(); assert.equal(session.type, 'playback');
    for (let i = 0; i < 2; i++) {
      assert.equal(await fixture.capture.start(() => {}, () => {}), true);
      fixture.nodes.at(-1).port.onmessage({ data: { type: 'samples', samples: new Float32Array(16000).fill(.1) } });
      await fixture.capture.finish();
      assert.equal(fixture.tracks.at(-1).stopped, true);
      assert.equal(session.type, 'playback');
    }
    assert.deepEqual(modes, [true, false, true, false]);
    fixture.session.ngOnDestroy(); assert.equal(session.type, 'auto');
  } finally { fixture.restore(); }
});
test('cancelling pending microphone permission returns to playback and stops a late grant', async () => {
  const session = { type: 'auto' };
  const fixture = safariCapture({ permissionPending: true, browser: { userAgent: 'iPhone', audioSession: session } });
  try {
    const starting = fixture.capture.start(() => {}, () => {});
    assert.equal(session.type, 'play-and-record');
    fixture.capture.cancel();
    assert.equal(await starting, false); assert.equal(session.type, 'playback');
    fixture.grant(); await until(() => fixture.tracks[0]?.stopped);
    assert.equal(session.type, 'playback');
  } finally { fixture.restore(); }
});

test('second recording resumes again after microphone acquisition without waiting on a stalled first resume', { timeout: 1000 }, async () => {
  const fixture = safariCapture();
  try {
    for (let recording = 0; recording < 2; recording++) {
      assert.equal(await fixture.capture.start(() => {}, () => {}), true);
      const node = fixture.nodes.at(-1);
      node.port.onmessage({ data: { type: 'samples', samples: new Float32Array(16000).fill(.1) } });
      assert.equal((await fixture.capture.finish()).length, 32044);
      assert.ok(fixture.tracks.at(-1).stopped); assert.equal(fixture.contexts.at(-1).closed, false);
      fixture.contexts[0].state = 'suspended';
    }
    assert.equal(fixture.contexts.length, 1); assert.equal(fixture.contexts[0].resumes, 3);
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
test('opening cue waits for a connected input graph, with immediate cancellation and the existing startup deadline', async () => {
  let cues = 0;
  const fixture = safariCapture({ inputPending: true, cue: async () => { cues++; } });
  const originalTimeout = globalThis.setTimeout;
  let expire;
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay !== 5000) return originalTimeout(callback, delay, ...args);
    expire = callback; return undefined;
  };
  try {
    const starting = fixture.capture.start(() => {}, () => {});
    await until(() => fixture.sources[0]?.connected);
    assert.equal(cues, 0); assert.deepEqual(fixture.nodes[0].commands, []);
    fixture.nodes[0].port.onmessage({ data: { type: 'ready' } });
    assert.equal(await starting, true); assert.equal(cues, 1);
    assert.deepEqual(fixture.nodes[0].commands, ['start']);
    fixture.capture.cancel();
    const cancelled = fixture.capture.start(() => {}, () => {});
    await until(() => fixture.sources[1]?.connected);
    const lateReady = fixture.nodes[1].port.onmessage;
    fixture.capture.cancel(); assert.equal(await cancelled, false);
    lateReady({ data: { type: 'ready' } });
    assert.equal(cues, 1); assert.equal(fixture.contexts[0].closed, false); assert.ok(fixture.tracks[1].stopped);
    const stalled = fixture.capture.start(() => {}, () => {});
    const rejected = assert.rejects(stalled, /startup timed out/);
    await until(() => fixture.sources[2]?.connected);
    expire(); await rejected;
    assert.equal(cues, 1); assert.ok(fixture.contexts[0].closed); assert.ok(fixture.tracks[2].stopped);
  } finally { globalThis.setTimeout = originalTimeout; fixture.restore(); }
});

test('radio cues use distinct quiet pitches, fade cleanly and release their audio nodes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { voiceCue } = load('../src/app/voice/voiceCue.ts');
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
test('opening cue follows input readiness and finishes before capture is armed; closing follows drained capture', async () => {
  const cues = [];
  let endCue;
  const fixture = safariCapture({ cue: async (_context, opening) => {
    cues.push(opening);
    assert.equal(fixture.sources.at(-1).connected, opening);
    if (opening) assert.deepEqual(fixture.nodes.at(-1).commands, []);
    if (!opening) { assert.equal(fixture.tracks.at(-1).stopped, false); assert.equal(fixture.capture.node, undefined); }
    await new Promise(resolve => { endCue = resolve; });
  } });
  try {
    const starting = fixture.capture.start(() => {}, () => {});
    await until(() => cues.length === 1); assert.equal(fixture.sources[0].connected, true);
    fixture.nodes[0].port.onmessage({ data: { type: 'samples', samples: new Float32Array(16000).fill(.9) } });
    assert.equal(fixture.capture.diagnostics.durationMs, 0, 'Never retain cue-time samples.');
    assert.deepEqual(fixture.nodes[0].commands, []);
    endCue(); assert.equal(await starting, true); assert.equal(fixture.sources[0].connected, true);
    assert.deepEqual(fixture.nodes[0].commands, ['start']);
    fixture.nodes[0].port.onmessage({ data: { type: 'samples', samples: new Float32Array(16000).fill(.1) } });
    const finishing = fixture.capture.finish();
    await until(() => cues.length === 2); assert.deepEqual(cues, [true, false]);
    endCue(); assert.equal((await finishing).length, 32044); assert.equal(fixture.contexts[0].closed, false);
    assert.equal(fixture.tracks[0].stopped, true);
    const cancelled = fixture.capture.start(() => {}, () => {});
    await until(() => cues.length === 3); fixture.capture.cancel(); assert.equal(await cancelled, false);
    endCue(); assert.equal(fixture.contexts[0].closed, false); assert.deepEqual(cues, [true, false, true]);
  } finally { fixture.restore(); }
});


test('stalled cue playback has a 500 ms cleanup deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { voiceCue } = load('../src/app/voice/voiceCue.ts');
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
    assert.match(first.audioTrace, /Context acquired · 16000Hz/);
    assert.match(first.audioTrace, /Mic acquired[\s\S]*Mic connected[\s\S]*Input ready[\s\S]*Opening scheduled[\s\S]*Opening ended[\s\S]*Capture armed/);
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
    for (let i = 0; i < 100; i++) fixture.contexts[0].onstatechange();
    assert.equal(fixture.capture.diagnostics.audioTrace.split('\n').length, 16);
    assert.match(fixture.capture.diagnostics.audioTrace, /Opening scheduled/);
    fixture.capture.cancel();
    observers.at(-1)('timeout');
    assert.equal(fixture.capture.diagnostics.openingCue, 'ended');
    fixture.session.ngOnDestroy();
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
    assert.equal(fixture.tracks[0].stopped, true); assert.equal(fixture.contexts[0].closed, false);
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
  service.queue.completed.next({ id, transcript: 'Shared', conversationId: 'chat:engineering' });
  assert.equal(service.replies.length, 0);
  // The account boundary also suppresses an outstanding upload/capture result.
  service.ngOnDestroy(); response.next({ transcript: 'Shared' }); response.complete(); await releasing;
});


test('echo cancellation diagnostic requests change only the selected constraint and report the observed boolean safely', async () => {
  const fixture = safariCapture({ actualEchoCancellation: false });
  try {
    await fixture.capture.start(() => {}, () => {});
    assert.deepEqual(fixture.constraints[0], { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    assert.equal(fixture.capture.diagnostics.echoCancellation, 'Requested on · actual off', 'Ignored constraints must remain apparent.');
    fixture.capture.cancel();
    await fixture.capture.start(() => {}, () => {}, undefined, false);
    assert.deepEqual(fixture.constraints[1], { audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true } });
    assert.equal(fixture.capture.diagnostics.echoCancellation, 'Requested off · actual off');
    assert.doesNotMatch(JSON.stringify(fixture.capture.diagnostics), /SECRET_DEVICE/);
    assert.equal(fixture.contexts.length, 1); assert.equal(fixture.constraints.length, 2);
  } finally { fixture.restore(); }
  for (const settingsError of [false, true]) {
    const unsupported = safariCapture({ settingsError });
    try {
      await unsupported.capture.start(() => {}, () => {}, undefined, false);
      assert.equal(unsupported.capture.diagnostics.echoCancellation, 'Requested off · actual unknown');
      assert.doesNotMatch(JSON.stringify(unsupported.capture.diagnostics), /SECRET/);
    } finally { unsupported.restore(); }
  }
});

test('echo cancellation default is Android-only, with client hints preferred and unknown platforms preserved', () => {
  const cases = [
    [{ userAgent: 'Mozilla/5.0 (Linux; Android 15; Redmi Note 14) Chrome/140.0 Mobile Safari/537.36' }, false],
    [{ userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/140.0 Safari/537.36' }, false],
    [{ userAgent: 'android' }, false],
    [{ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)' }, true],
    [{ userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X)' }, true],
    [{ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)' }, true],
    [{ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, true],
    [{ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }, true],
    [{ userAgentData: { platform: 'Android' }, userAgent: 'Reduced UA' }, false],
    [{ userAgentData: { platform: 'Windows' }, userAgent: 'Android' }, true],
    [{ userAgentData: { platform: '' }, userAgent: 'Android' }, false],
    [{}, true]
  ];
  for (const [browser, expected] of cases) assert.equal(captureSettings.defaultVoiceEchoCancellation(browser), expected, JSON.stringify(browser));
});
test('audio-only delivery clears the local receipt without creating a transcript or error bubble', async () => {
  const response = new Subject(), { service } = client(() => response);
  await service.press(); const releasing = service.release();
  await until(() => service.queue.items.length === 1);
  service.queue.completed.next({ id: service.queue.items[0].id, transcript: '', conversationId: 'chat:engineering' });
  assert.equal(service.replies.length, 0);
  service.ngOnDestroy(); response.next({ transcript: '' }); response.complete(); await releasing;
});

test('backgrounded submission drains its last audio block before releasing the shared session', async () => {
  const system = { type: 'auto' }, cues = [];
  const f = safariCapture({ browser: { userAgent: 'iPhone', audioSession: system }, cue: async (_context, opening) => { cues.push(opening); } });
  try {
    assert.equal(await f.capture.start(() => {}, () => {}), true);
    const context = f.session.current, node = f.nodes.at(-1);
    node.port.onmessage({ data: { type: 'samples', samples: new Float32Array(16000).fill(.1) } });
    node.port.postMessage = () => {};
    const finishing = f.capture.finish();
    f.capture.silenceClosingCue(); f.session.release();
    assert.equal(context.closed, false, 'Keep the submitted audio graph until its stop acknowledgement.');
    node.port.onmessage({ data: { type: 'stopped' } });
    assert.equal((await finishing).length, 32044);
    assert.equal(context.closed, true); assert.equal(f.session.current, undefined);
    assert.equal(f.tracks.at(-1).stopped, true); assert.equal(system.type, 'auto');
    assert.deepEqual(cues, [true], 'Do not start a closing cue after the page has already left.');
  } finally { f.restore(); }
});

test('production capture submits its configured destination and changing chats cancels draining old audio', async () => {
  let finish;
  const f = client(undefined, { finish: () => new Promise(resolve => { finish = resolve; }) }), submitted = [];
  f.service.queue.enqueue = async (_audio, destination) => submitted.push(destination);
  f.service.setDestination('chat:engineering'); await f.service.press();
  const draining = f.service.release();
  f.service.setDestination('chat:design'); finish(wav()); await draining;
  assert.deepEqual(submitted, []); assert.equal(f.service.phase, 'idle');
  f.capture.finish = async () => wav(); await f.service.press(); await f.service.release();
  assert.deepEqual(submitted, ['chat:design']); f.service.ngOnDestroy();
});

test('limit bops occur once at five and two seconds left, reset per recording and leave samples intact', async () => {
  const tones = [], f = safariCapture({ cue: async (_context, opening) => tones.push(opening) });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      tones.length = 0;
      await f.capture.start(() => {}, () => {});
      const samples = count => f.nodes.at(-1).port.onmessage({ data: { type: 'samples', samples: new Float32Array(count).fill(.1) } });
      samples(24 * 16000); assert.deepEqual(tones, [true]);
      samples(16000); assert.deepEqual(tones, [true, false]);
      samples(1600); assert.deepEqual(tones, [true, false]);
      samples(3 * 16000 - 1600); assert.deepEqual(tones, [true, false, false]);
      samples(2 * 16000); assert.deepEqual(tones, [true, false, false]);
      assert.equal((await f.capture.finish()).length, 960044);
      assert.deepEqual(tones, [true, false, false, false]);
      assert.equal(f.tracks.at(-1).stopped, true);
    }
  } finally { f.restore(); }
});

test('delayed input coalesces warning thresholds and stale input cannot play after cancel', async () => {
  const tones = [], f = safariCapture({ cue: async (_context, opening) => tones.push(opening) });
  try {
    await f.capture.start(() => {}, () => {});
    const message = f.nodes.at(-1).port.onmessage;
    message({ data: { type: 'samples', samples: new Float32Array(29 * 16000).fill(.1) } });
    assert.deepEqual(tones, [true, false]);
    f.capture.cancel();
    message({ data: { type: 'samples', samples: new Float32Array(16000).fill(.1) } });
    assert.deepEqual(tones, [true, false]);
    await f.capture.start(() => {}, () => {});
    f.nodes.at(-1).port.onmessage({ data: { type: 'samples', samples: new Float32Array(30 * 16000).fill(.1) } });
    assert.deepEqual(tones, [true, false, true], 'A delayed full recording must not play obsolete warnings.');
  } finally { f.restore(); }
});

test('manual stop does not play a warning when the final drained batch crosses its threshold', async () => {
  const tones = [], f = safariCapture({ cue: async (_context, opening) => tones.push(opening) });
  try {
    await f.capture.start(() => {}, () => {});
    const node = f.nodes.at(-1);
    node.port.onmessage({ data: { type: 'samples', samples: new Float32Array(24 * 16000).fill(.1) } });
    node.port.postMessage = message => {
      if (message !== 'stop') return;
      node.port.onmessage({ data: { type: 'samples', samples: new Float32Array(16000).fill(.1) } });
      node.port.onmessage({ data: { type: 'stopped' } });
    };
    assert.equal((await f.capture.finish()).length, 800044);
    assert.deepEqual(tones, [true, false], 'Only the opening and closing cues play.');
  } finally { f.restore(); }
});
