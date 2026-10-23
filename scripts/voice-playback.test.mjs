import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Subject, of } from 'rxjs';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL('../src/app/prototypes/voice-input/voicePlayback.service.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true }
}).outputText;
const exports = {};
new Function('exports', 'require', code)(exports, name => name === '@angular/core' ? {
  Injectable: () => value => value, runInInjectionContext: (_injector, fn) => fn()
} : name === 'rxjs' ? require(name) : {});
const { VoicePlaybackService } = exports;
const tick = () => new Promise(setImmediate);
function fixture(t) {
  const originalDocument = globalThis.document, originalAudio = globalThis.AudioContext;
  const listeners = new Map(), nodes = [], calls = [];
  const document = { hidden: false, hasFocus: () => true, addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) };
  globalThis.document = document;
  globalThis.AudioContext = class {
    state = 'suspended'; destination = {}; currentTime = 0;
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    decodeAudioData() { return Promise.resolve({ duration: 1, sampleRate: 16000, getChannelData: () => new Float32Array(16000).fill(.1) }); }
    createBufferSource() { const node = { connect() {}, disconnect() {}, start() {}, stop() {}, onended: null }; nodes.push(node); return node; }
  };
  const conversation = { changed: new Subject(), incoming: new Subject(), allowed: true, uid: 'recipient' };
  const voice = { changed: new Subject(), busy: false };
  let response = () => of({ audio: Buffer.alloc(32044).toString('base64'), expiresAt: Date.now() + 60000 });
  const functions = { httpsCallable: (_name, options) => data => { calls.push(data); assert.equal(options.timeout, 20000); return response(); } };
  const service = new VoicePlaybackService(functions, {}, conversation, voice);
  t.after(() => { service.ngOnDestroy(); globalThis.document = originalDocument; globalThis.AudioContext = originalAudio; });
  const message = id => ({ id, userId: 'sender', source: 'voice', audioExpiresAt: Date.now() + 60000 });
  return { service, conversation, voice, calls, nodes, document, listeners, message, respond: fn => { response = fn; } };
}
test('automatic playback requires foreground audio activation; sequential delivery and replay reuse cache', async t => {
  const f = fixture(t);
  f.conversation.incoming.next(f.message('locked')); await tick(); assert.equal(f.calls.length, 0);
  f.service.unlock();
  f.conversation.incoming.next(f.message('a')); f.conversation.incoming.next(f.message('b'));
  await tick(); assert.equal(f.service.active, 'a'); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].automatic, true);
  f.nodes[0].onended(); await tick(); assert.equal(f.service.active, 'b'); assert.equal(f.calls.length, 2);
  f.nodes[1].onended(); await tick();
  f.service.toggle(f.message('a')); await tick(); assert.equal(f.service.active, 'a'); assert.equal(f.calls.length, 2);
  f.service.toggle(f.message('a')); assert.equal(f.service.active, '');
});
test('background, expired and busy messages never play; capture stops current playback', async t => {
  const f = fixture(t); f.service.unlock(); f.document.hidden = true;
  f.conversation.incoming.next(f.message('background')); await tick(); assert.equal(f.calls.length, 0);
  f.document.hidden = false;
  f.conversation.incoming.next({ ...f.message('expired'), audioExpiresAt: 1 }); assert.equal(f.calls.length, 0);
  f.voice.busy = true; f.conversation.incoming.next(f.message('wait')); await tick(); assert.equal(f.calls.length, 0);
  f.voice.busy = false; f.voice.changed.next(); await tick(); assert.equal(f.service.active, 'wait');
  f.voice.busy = true; f.voice.changed.next(); assert.equal(f.service.active, '');
});
test('account switch cancels late private results and clears cached audio', async t => {
  const f = fixture(t), result = new Subject(); f.respond(() => result); f.service.unlock();
  f.service.toggle(f.message('late')); assert.equal(f.calls.length, 1);
  f.conversation.uid = 'other'; f.conversation.changed.next();
  result.next({ audio: Buffer.alloc(32044).toString('base64'), expiresAt: Date.now() + 60000 }); await tick();
  assert.equal(f.service.active, ''); assert.equal(f.service.loading, ''); assert.equal(f.nodes.length, 0); assert.equal(f.service.cache.size, 0);
});
test('failed downloads require explicit retry and automatic backlog is capped at ten', async t => {
  const f = fixture(t); f.service.unlock(); const pending = new Subject(); f.respond(() => pending);
  for (let i = 0; i < 40; i++) f.conversation.incoming.next(f.message(String(i)));
  assert.equal(f.calls.length, 1); assert.equal(f.service.queue.length, 10);
  f.document.hidden = true; f.listeners.get('visibilitychange')();
  pending.error(Error('Offline')); await tick(); assert.equal(f.calls.length, 1); assert.ok(f.service.error);
  f.document.hidden = false; f.respond(() => of({ skipped: true }));
  f.service.toggle(f.message('0')); await tick(); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].automatic, false);
});
test('cache evicts at ten recordings, expires and is released on navigation', async t => {
  const f = fixture(t); f.service.unlock();
  for (let i = 0; i < 12; i++) {
    f.service.toggle(f.message(String(i))); await tick(); f.nodes.at(-1).onended(); await tick();
  }
  assert.equal(f.service.cache.size, 10); assert.equal(f.service.cache.has('0'), false);
  f.service.cache.get('11').expiresAt = 1;
  f.service.toggle(f.message('11')); await tick(); assert.equal(f.calls.length, 13);
  f.service.ngOnDestroy(); assert.equal(f.service.cache.size, 0); assert.equal(f.service.active, '');
});

test('idle waveform has a fixed sound shape; playback follows decoded samples and releases its timer on stop', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const f = fixture(t), idle = [...f.service.idleLevels];
  assert.ok(new Set(idle).size > 1); assert.ok(idle.some(level => level > .5));
  t.mock.timers.tick(1000); assert.deepEqual(f.service.levels, idle);
  f.service.toggle(f.message('wave')); await tick();
  const calls = f.calls.length;
  t.mock.timers.tick(80);
  assert.ok(Math.abs(f.service.levels.at(-1) - .5) < .00001);
  assert.notDeepEqual(f.service.levels, idle); assert.equal(f.calls.length, calls, 'Waveform uses local audio only.');
  f.service.toggle(f.message('wave'));
  assert.deepEqual(f.service.levels, idle); assert.equal(f.service.waveformTimer, undefined);
  t.mock.timers.tick(1000); assert.deepEqual(f.service.levels, idle);
});
test('reduced-motion playback keeps the waveform static and avoids a sampling timer', async t => {
  const original = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true });
  t.after(() => { globalThis.matchMedia = original; });
  const f = fixture(t); f.service.toggle(f.message('still')); await tick();
  assert.equal(f.service.active, 'still'); assert.equal(f.service.waveformTimer, undefined);
  assert.deepEqual(f.service.levels, Array(9).fill(.35));
});
