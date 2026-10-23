import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const exports = {};
new Function('exports', ts.transpileModule(readFileSync(new URL('../src/app/prototypes/voice-input/voiceDiagnostics.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText)(exports);
const { voiceDiagnosticRows: rows, voiceDiagnosticCode: code, VoiceKeyDiagnostics } = exports;
const now = 1800000000000;
function state(changes = {}) {
  const voice = { ready: true, uid: 'private-account-id', phase: 'idle', phaseSince: now, canToggle: true, captureFailure: '', ...changes.voice };
  const queue = { ready: true, total: 0, unsent: 0, unsaved: false, received: 0, storageError: false, storageWork: 0,
    storageSince: 0, storageCode: '', storageRetries: 0, running: false, deadline: 0, nextAt: 0, uploadCode: '',
    listeners: 0, confirmedResults: 0, resultFailures: 0, resultCode: '', resultRetries: 0, resultStatus: '', resultCached: false, ...changes.queue };
  const capture = { supported: true, context: 'Idle', liveTracks: 0, muted: false, permissionPending: false, worklet: false,
    durationMs: 0, connectedAt: 0, lastSampleAt: 0, ...changes.capture };
  const device = { online: true, visible: true, secure: true, gesture: 'Released', gestureSince: 0, ...changes.device };
  return new Map(rows(voice, queue, capture, device, now).map(row => [row.label, row]));
}
test('normal idle diagnostics are green without claiming an unqueried cloud database was tested', () => {
  const s = state(); assert.ok([...s.values()].every(row => row.ok));
  assert.equal(s.get('Button').value, 'Enabled · Start'); assert.equal(s.get('Lock').value, 'None');
  assert.equal(s.get('Cloud DB').value, 'No pending results');
});
test('offline capture remains enabled while the connection is red', () => {
  const s = state({ device: { online: false }, queue: { unsent: 1, total: 1 } });
  assert.equal(s.get('Network').ok, false); assert.equal(s.get('Upload').value, 'Paused'); assert.equal(s.get('Button').ok, true);
});
test('local storage and capacity locks name the actual blocking condition', () => {
  const failed = state({ voice: { canToggle: false }, queue: { storageError: true, storageCode: 'TimeoutError' } });
  assert.equal(failed.get('Lock').value, 'Local DB error'); assert.equal(failed.get('Local DB').value, 'TimeoutError'); assert.equal(failed.get('Button').ok, false);
  assert.equal(state({ voice: { canToggle: false }, queue: { total: 10 } }).get('Lock').value, 'Queue full');
  assert.equal(state({ voice: { canToggle: false }, queue: { unsaved: true } }).get('Lock').value, 'Audio not saved');
});
test('normal recording is green; stalled worklet, ended track and suspended context are separate faults', () => {
  const input = { voice: { phase: 'recording', phaseSince: now - 10000 }, capture: { context: 'running', liveTracks: 1, worklet: true, lastSampleAt: now } };
  assert.ok([...state(input).values()].every(row => row.ok));
  const failed = state({ ...input, capture: { ...input.capture, context: 'suspended', liveTracks: 0, lastSampleAt: now - 4000 } });
  for (const label of ['Microphone', 'Worklet', 'Audio context']) assert.equal(failed.get(label).ok, false, label);
  assert.equal(failed.get('Button').value, 'Enabled · Stop');
});
test('expected preparation is green but a stuck preparation names a red lock', () => {
  const normal = state({ voice: { phase: 'sending', phaseSince: now - 2000, canToggle: false } });
  assert.equal(normal.get('Button').ok, true); assert.equal(normal.get('Lock').value, 'Finishing audio');
  const stuck = state({ voice: { phase: 'sending', phaseSince: now - 12000, canToggle: false } });
  assert.equal(stuck.get('Lock').value, 'Preparation stalled'); assert.equal(stuck.get('Lock').ok, false);
});
test('upload diagnostics show the actual stage and a missed deadline without locking idle capture', () => {
  const s = state({ queue: { running: true, stage: 'Account', startedAt: now - 76000, deadline: now - 1000 } });
  assert.match(s.get('Upload').value, /Account · 76s · Overdue/); assert.equal(s.get('Upload').ok, false); assert.equal(s.get('Button').ok, true);
});
test('cloud status distinguishes listener creation, cache, server confirmation and recovery failure', () => {
  const pending = { received: 1, listeners: 1, total: 1 };
  assert.equal(state({ queue: pending }).get('Cloud DB').ok, false);
  assert.equal(state({ queue: { ...pending, resultStatus: 'queued', resultCached: true } }).get('Cloud DB').ok, false);
  assert.equal(state({ queue: { ...pending, resultStatus: 'processing', confirmedResults: 1 } }).get('Cloud DB').ok, true);
  const failed = state({ queue: { ...pending, resultCode: 'permission-denied', resultFailures: 1 } });
  assert.equal(failed.get('Cloud DB').ok, false); assert.equal(failed.get('Recovery').ok, false); assert.equal(failed.get('Button').ok, true);
  assert.equal(failed.get('Server').ok, false);
  const terminal = state({ queue: { ...pending, resultStatus: 'failed', confirmedResults: 1 } });
  assert.equal(terminal.get('Server').ok, false); assert.equal(terminal.get('Last fault').value, 'Transcription failed');
});
test('stale pointer holds are red while normal push-to-talk holds remain green', () => {
  const device = { gesture: 'Held', gestureSince: now - 10000 };
  assert.equal(state({ device }).get('Gesture').ok, false);
  assert.equal(state({ device, voice: { phase: 'recording' } }).get('Gesture').ok, true);
});
test('diagnostics exclude identities and error messages while preserving useful machine codes', () => {
  assert.equal(JSON.stringify([...state().values()]).includes('private-account-id'), false);
  assert.equal(code({ code: -203, message: 'private transcript' }), 'NG0203');
  assert.equal(code({ code: 'functions/unavailable', message: 'secret' }), 'unavailable');
  assert.equal(code({ code: 22, name: 'QuotaExceededError' }), 'QuotaExceededError');
  assert.equal(code({ code: 25, name: 'DataCloneError' }), 'DataCloneError');
  assert.equal(code({ message: 'private transcript' }), 'Unknown error');
  assert.equal(code({ code: 'private text with spaces', name: 'Error' }), 'Error');
});
test('audio cue rows distinguish render completion from playback failures and exist before recording', () => {
  const idle = state();
  assert.equal(idle.get('Opening cue').value, 'Not observed');
  assert.equal(idle.get('Closing cue').value, 'Not observed');
  assert.equal(idle.get('Audio trace').value, 'Waiting for recording');
  const rendered = state({ capture: { openingCue: 'ended', closingCue: 'cancelled', audioTrace: '+65ms Opening ended' } });
  assert.equal(rendered.get('Opening cue').value, 'Render ended');
  assert.equal(rendered.get('Opening cue').ok, true);
  assert.equal(rendered.get('Closing cue').ok, true);
  assert.equal(rendered.get('Audio trace').value, '+65ms Opening ended');
  for (const failure of ['skipped', 'timeout', 'failed']) {
    const failed = state({ capture: { openingCue: failure, closingCue: 'ended' } });
    assert.equal(failed.get('Opening cue').ok, false);
    assert.equal(failed.get('Audio trace').ok, false);
    assert.equal(failed.get('Closing cue').ok, true);
  }
});

test('an expired worker lease is red independently of a healthy database listener', () => {
  const s = state({ queue: { received: 1, listeners: 1, confirmedResults: 1, resultStatus: 'processing', resultDeadline: now - 6000 } });
  assert.equal(s.get('Cloud DB').ok, true); assert.equal(s.get('Server').ok, false);
  assert.match(s.get('Server').value, /Lease expired/); assert.equal(s.get('Last fault').value, 'Worker lease expired');
  assert.equal(s.get('Button').ok, true);
});

test('keyboard evidence retains both edges of a fast press between renders', () => {
  const keys = new VoiceKeyDiagnostics();
  keys.event({ key: 'p', code: 'KeyP' }, 'down', 'Toggle from idle');
  keys.observePhase('requesting'); keys.observePhase('recording');
  keys.event({ key: 'p', code: '' }, 'up', 'Code mismatch', false);
  const rows = new Map(keys.rows().map(row => [row.label, row]));
  assert.match(rows.get('P keydown').value, /P \/ KeyP/);
  assert.match(rows.get('P keyup').value, /P \/ Empty/);
  assert.match(rows.get('P trace').value, /down:.*\n.*Mic: requesting\n.*Mic: recording\n.*up:.*Code mismatch/);
  assert.equal(rows.get('P trace').ok, false);
});

test('keyboard diagnostics bound trace memory and coalesce repeat floods without losing the initial down', () => {
  const keys = new VoiceKeyDiagnostics();
  keys.event({ key: 'p', code: 'KeyP' }, 'down', 'Toggle from idle');
  for (let i = 0; i < 1000; i++) keys.event({ key: 'p', code: 'KeyP', repeat: true }, 'down', 'Repeat ignored');
  assert.equal(keys.rows().find(row => row.label === 'P trace').value.split('\n').length, 1);
  assert.match(keys.rows().find(row => row.label === 'P repeats').value, /^1000 .*Repeat ignored/);
  for (let i = 0; i < 20; i++) keys.observePhase(i % 2 ? 'recording' : 'idle');
  assert.equal(keys.rows().find(row => row.label === 'P trace').value.split('\n').length, 8);
});

test('unflagged repeats preserve the start trace and rendered waveform evidence survives release', () => {
  const keys = new VoiceKeyDiagnostics();
  keys.observeDock('idle', 18, 4);
  keys.event({ key: 'p', code: 'KeyP' }, 'down', 'Toggle from idle');
  keys.observeDock('requesting', 18, 4); keys.observeDock('recording', 18, 4);
  for (let i = 0; i < 1000; i++) {
    keys.event({ key: 'p', code: 'KeyP' }, 'down', 'Held repeat ignored', true, true);
    keys.observeDock('recording', 18, 24);
  }
  keys.observeDock('sending', 0, 0); keys.observeDock('idle', 18, 4);
  const rows = new Map(keys.rows().map(row => [row.label, row]));
  assert.match(rows.get('P repeats').value, /^1000 .*unflagged repeat/);
  assert.equal(rows.get('Dock DOM').value, 'idle · 18 bars · max 24px');
  assert.equal(rows.get('P trace').value.split('\n').length, 6);
  assert.match(rows.get('P trace').value, /Toggle from idle/);
  assert.match(rows.get('P trace').value, /Waveform rendered: active/);
  keys.observeDock('requesting', 18, 4);
  assert.match(keys.rows().find(row => row.label === 'Dock DOM').value, /max 0px/);
  keys.observeDock('idle', 18, 4); keys.observeDock('recording', 18, 10);
  assert.match(keys.rows().find(row => row.label === 'Dock DOM').value, /max 10px/);
});

test('keyboard evidence recognizes Android unknown/composition events without collecting arbitrary input', () => {
  const keys = new VoiceKeyDiagnostics();
  assert.equal(keys.relevant({ key: 'Unidentified', keyCode: 229 }), true);
  assert.equal(keys.relevant({ key: 'Process' }), true);
  assert.equal(keys.relevant({ key: 'private typed text', code: 'KeyX' }), false);
  keys.event({ key: 'private typed text', code: 'private code', target: { value: 'private content' }, ctrlKey: true,
    keyCode: 229, isComposing: true, isTrusted: false }, 'up', 'Code mismatch');
  const text = JSON.stringify(keys.rows());
  assert.doesNotMatch(text, /private/);
  assert.match(text, /Other \/ Other · 229 · composing, Ctrl, synthetic/);
});
