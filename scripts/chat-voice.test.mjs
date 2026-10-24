import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { Subject, of } from 'rxjs';
const require = createRequire(import.meta.url);
function load(file) {
  const exports = {}, core = { Injectable: () => x => x, Component: () => x => x, Input: () => () => {}, Output: () => () => {}, HostListener: () => () => {}, EventEmitter: class { emit() {} }, runInInjectionContext: (_, fn) => fn() };
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  new Function('exports', 'require', code)(exports, name => name === '@angular/core' ? core : require(name)); return exports;
}
const { ChatVoiceService } = load('../src/app/chat/chatVoice.service.ts');
const { VoiceComposerComponent } = load('../src/app/voice/voice-composer/voice-composer.component.ts');
const tick = () => new Promise(setImmediate);
function fixture(t) {
  const saved = { document: globalThis.document, window: globalThis.window };
  const document = { hidden: false, hasFocus: () => true, addEventListener() {}, removeEventListener() {}, createElement: () => ({ click() {} }) };
  globalThis.document = document; globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const nodes = [], calls = [], changed = new Subject();
  const input = { changed, busy: false, destination: '', access: false, uid: 'bob',
    setDestination(value) { this.destination = value; }, setAccess(value) { this.access = value; }, cancel() { this.busy = false; } };
  const context = { state: 'running', destination: {}, resume: async () => {},
    decodeAudioData: async () => ({}), createBufferSource() { const node = { connect() {}, disconnect() {}, stop() {}, start() {}, onended: null }; nodes.push(node); return node; } };
  const session = { current: context, acquire: () => context, resume: async () => {}, release() { this.current = undefined; } };
  let respond = () => of({ audio: Buffer.alloc(32044).toString('base64'), expiresAt: Date.now() + 60000 });
  const functions = { httpsCallable: (name, settings) => data => { assert.equal(name, 'voicePlayback'); assert.equal(settings.timeout, 20000); calls.push(data); return respond(); } };
  const voice = new ChatVoiceService(input, session, functions, {}, { run: fn => fn() });
  t.after(() => { voice.ngOnDestroy(); Object.assign(globalThis, saved); });
  const message = (id, overrides = {}) => ({ id, own: false, verified: true, timestamp: Date.now() + 1000,
    voice: { eventId: id, durationMs: 1000, expiresAt: Date.now() + 60000, transcription: 'completed' }, ...overrides });
  const configure = messages => voice.configure('engineering', 'voice', 'bob', ['alice', 'bob'], messages);
  return { voice, input, context, session, document, nodes, calls, message, configure, respond: fn => { respond = fn; } };
}
test('voice input requires a current participant and updates on participant, account and mode changes', t => {
  const f = fixture(t); assert.equal(f.voice.mode, 'text');
  f.voice.configure('engineering', 'voice', 'outsider', ['alice'], []);
  assert.equal(f.input.access, false); assert.equal(f.input.destination, 'chat:engineering'); assert.equal(f.voice.canListen, false);
  f.voice.configure('engineering', 'voice', 'alice', ['alice'], []); assert.equal(f.input.access, true);
  f.voice.useKeyboard();
  f.voice.configure('engineering', 'voice', 'alice', [], []); assert.equal(f.input.access, false);
  assert.equal(f.voice.keyboard, true); // Keyboard preference cannot restore recording access.
  f.voice.configure('engineering', 'voice', 'alice', ['alice'], []); assert.equal(f.input.access, true);
  f.voice.configure('engineering', 'text', 'alice', ['alice'], []); assert.equal(f.input.access, false);
  f.voice.configure('engineering', 'voice', '', ['alice'], []); assert.equal(f.input.access, false);
});
test('autoplay ignores entry history, older loaded history, own messages and duplicate updates', async t => {
  const f = fixture(t), history = f.message('history'); f.configure([history]); await tick(); assert.equal(f.calls.length, 0);
  const old = f.message('old', { timestamp: 1 }); f.configure([old, history]); assert.equal(f.calls.length, 0);
  const incoming = f.message('fresh'); f.configure([old, history, incoming]); await tick(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].automatic, true);
  f.configure([old, history, incoming, f.message('own', { own: true })]); assert.equal(f.calls.length, 1);
});
test('automatic playback waits for verification, is sequential, and never prefetches unbounded history', async t => {
  const f = fixture(t); f.configure([]);
  const a = f.message('a', { verified: false }); f.configure([a]); assert.equal(f.calls.length, 0);
  const b = f.message('b'); f.configure([{ ...a, verified: true }, b]); await tick(); assert.equal(f.calls.length, 1); assert.equal(f.voice.active, 'a');
  f.nodes[0].onended(); await tick(); assert.equal(f.calls.length, 2); assert.equal(f.voice.active, 'b');
});
test('foreground visit limits autoplay to 100 downloads and a ten-recording backlog', async t => {
  const f = fixture(t); f.configure([]); const rows = [];
  for (let n = 0; n < 105; n++) { rows.push(f.message(String(n))); f.configure([...rows]); await tick(); f.nodes.at(-1)?.onended?.(); await tick(); }
  assert.equal(f.calls.length, 100);
  f.voice.configure('next', 'voice', 'bob', ['bob'], []);
  f.voice.configure('next', 'voice', 'bob', ['bob'], Array.from({ length: 40 }, (_, n) => f.message('next-' + n)));
  await tick(); assert.ok(f.voice.queue.length <= 10); assert.equal(f.calls.length, 101);
});
test('each manual replay requests fresh authorization; capture and recipient removal stop playback', async t => {
  const f = fixture(t), message = f.message('audio'); f.configure([message]);
  f.voice.toggle(message); await tick(); assert.equal(f.calls.length, 1); f.nodes[0].onended();
  f.voice.toggle(message); await tick(); assert.equal(f.calls.length, 2);
  f.input.busy = true; f.input.changed.next(); assert.equal(f.voice.active, '');
  f.input.busy = false; f.voice.configure('engineering', 'voice', 'bob', ['alice'], [message]);
  f.voice.toggle(message); await tick(); assert.equal(f.calls.length, 2); assert.equal(f.voice.canListen, false);
});
test('navigation and account changes discard late audio responses and reset the local keyboard choice', async t => {
  const f = fixture(t), response = new Subject(); f.respond(() => response); f.configure([]);
  f.voice.toggle(f.message('a')); assert.equal(f.calls.length, 1); f.voice.useKeyboard(); assert.equal(f.voice.keyboard, true);
  f.voice.configure('next', 'text', 'carol', ['carol'], []);
  response.next({ audio: 'AAAA', expiresAt: Date.now() + 1000 }); response.complete(); await tick();
  assert.equal(f.voice.active, ''); assert.equal(f.nodes.length, 0); assert.equal(f.voice.keyboard, false);
});
test('background, locked audio and expired messages trigger no automatic downloads', async t => {
  const f = fixture(t); f.configure([]); f.document.hidden = true; f.configure([f.message('hidden')]);
  f.document.hidden = false; f.context.state = 'suspended'; f.configure([f.message('locked')]);
  f.context.state = 'running'; f.configure([f.message('expired', { voice: { eventId: 'expired', expiresAt: 1 } })]);
  await tick(); assert.equal(f.calls.length, 0);
});
test('production composer toggles immediately and supports held release without accepting editable shortcuts', () => {
  let presses = 0, releases = 0;
  const voice = { changed: new Subject(), uid: 'alice', phase: 'idle', canRecord: true, canToggle: true, press() { presses++; this.phase = 'recording'; this.canRecord = false; }, release() { releases++; this.phase = 'idle'; }, cancel() {} };
  const component = new VoiceComposerComponent(voice, { markForCheck() {} });
  const event = { isPrimary: true, button: 0, pointerId: 1, preventDefault() {}, currentTarget: { setPointerCapture() {} } };
  component.pointerDown(event); assert.equal(presses, 1); component.pointer.at -= 650; component.pointerUp(event); assert.equal(releases, 1);
  component.shortcutDown({ key: 'p', code: 'KeyP', target: { closest: () => ({}) } }); assert.equal(presses, 1);
  component.ngOnDestroy();
});

const { ChatInputSettingsComponent } = load('../src/app/chat/chat-input-settings/chat-input-settings.component.ts');
test('admin switch waits for verified state, confirms asynchronously, and retains a failed command for retry', async () => {
  const calls = [], busy = [], zone = { run: fn => fn() }, permissions = { current: { isAdmin: true } };
  const data = { updateInputMode: async (...args) => calls.push(args) };
  const component = new ChatInputSettingsComponent(permissions, data, zone); component.chain = 'engineering';
  component.busyChange.emit = value => busy.push(value);
  await component.toggle(); assert.equal(component.saving, true); await component.toggle(); assert.equal(calls.length, 1);
  component.mode = 'voice'; component.ngOnChanges(); await tick(); assert.equal(component.saving, false); assert.equal(busy.at(-1), false);
  data.updateInputMode = async () => { throw Error('Offline'); };
  await component.toggle(); assert.match(component.error, /couldn’t save/); assert.equal(component.saving, false);
  permissions.current.isAdmin = false; const error = component.error; await component.toggle(); assert.equal(component.error, error);
  component.ngOnDestroy();
});
test('admin confirmation has a single 30-second deadline and navigation ignores late failures', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const component = new ChatInputSettingsComponent({ current: { isAdmin: true } }, { updateInputMode: async () => {} }, { run: fn => fn() });
  component.chain = 'engineering'; await component.toggle(); t.mock.timers.tick(30000);
  assert.equal(component.saving, false); assert.match(component.error, /wasn’t confirmed/);
  let reject;
  component.data.updateInputMode = () => new Promise((_, fail) => { reject = fail; });
  const work = component.toggle(); component.chain = 'design'; component.ngOnChanges(); reject(Error('Old failure')); await work;
  assert.equal(component.error, ''); assert.equal(component.saving, false); component.ngOnDestroy();
});
test('composer emits coalesced status changes and refreshes when asynchronous capture or queue state changes', () => {
  const changes = new Subject(), states = []; let marks = 0;
  const input = { changed: changes, phase: 'idle', pendingCount: 0, queue: { storageError: '' }, replies: [], cancel() {} };
  const component = new VoiceComposerComponent(input, { markForCheck() { marks++; } });
  component.statusChange.emit = status => states.push(status);
  changes.next(); changes.next(); input.phase = 'recording'; changes.next(); input.pendingCount = 1; changes.next();
  assert.equal(states.length, 3); assert.equal(marks, 4); assert.equal(states[2].pending, 1);
  component.ngOnDestroy(); changes.next(); assert.equal(marks, 4);
});
test('playback failures expose a recording-specific error and require an explicit retry', async t => {
  const f = fixture(t), message = f.message('audio'); f.configure([message]);
  f.respond(() => of({ audio: 'bad', expiresAt: 1 })); f.voice.toggle(message); await tick();
  assert.equal(f.voice.errorId, 'audio'); assert.ok(f.voice.error); assert.equal(f.calls.length, 1);
  await tick(); assert.equal(f.calls.length, 1); f.voice.toggle(message); await tick(); assert.equal(f.calls.length, 2);
});

test('loading feedback notifies immediately and pressing again cancels without another fetch', async t => {
  const f = fixture(t), response = new Subject(), states = [];
  f.respond(() => response); const message = f.message('audio'); f.configure([message]);
  f.voice.changed.subscribe(() => states.push({loading:f.voice.loading,active:f.voice.active}));
  f.voice.toggle(message);
  assert.equal(states.at(-1).loading, 'audio'); assert.equal(f.calls.length, 1);
  f.voice.toggle(message); assert.equal(states.at(-1).loading, ''); assert.equal(f.calls.length, 1);
  response.next({audio:'AAAA',expiresAt:Date.now()+60000}); response.complete(); await tick();
  assert.equal(f.nodes.length, 0); assert.equal(f.voice.error, '');
});
