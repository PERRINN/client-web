import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Subject, of } from 'rxjs';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(file, overrides = {}) {
  const exports = {}, code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true }
  }).outputText;
  new Function('exports', 'require', code)(exports, name => overrides[name] || require(name)); return exports;
}
const admin = 'admin', participant = 'participant', added = 'added';
const { VoiceAuthorService } = load('../src/app/prototypes/voice-input/voiceAuthor.service.ts', {
  '@angular/core': { Injectable: () => value => value, runInInjectionContext: (_injector, fn) => fn() },
  '@angular/fire/compat/firestore': {}, '../../userInterface.service': {},
  '../../userAvatar': load('../src/app/userAvatar.ts'),
  './voiceConversation.service': { VOICE_ADMIN: admin, VOICE_PARTICIPANTS: [participant, added] }
});
const tick = () => new Promise(setImmediate);
function fixture(t, cached) {
  const conversation = { changed: new Subject(), allowed: true, uid: admin }, calls = [];
  let result = uid => of({ docs: [{ data: () => ({ user: uid, name: 'Actual name', imageUrlThumbUser: 'thumb', imageUrlMedium: 'medium', secret: 'never retained' }) }] });
  const ui = { PERRINNAdminLastMessageObj: cached };
  const firestore = { collection(path, query) {
    const filters = [], ref = { where: (...args) => { filters.push(['where', ...args]); return ref; },
      orderBy: (...args) => { filters.push(['orderBy', ...args]); return ref; }, limit: count => { filters.push(['limit', count]); return ref; } };
    query(ref); calls.push({ path, filters }); return { get: () => result(filters[0][3]) };
  } };
  const service = new VoiceAuthorService(firestore, {}, conversation, ui); t.after(() => service.ngOnDestroy());
  return { service, conversation, calls, ui, result: fn => { result = fn; } };
}
test('two limit-one verified profile queries supply production name/photos for all messages and reuses photo-array identity', async t => {
  const f = fixture(t); await tick(); const message = { userId: participant, authorName: 'Fallback' };
  assert.equal(f.service.name(message), 'Actual name'); assert.deepEqual(f.service.sources(message), ['thumb', 'medium']);
  const photos = f.service.sources(message); assert.equal(f.service.sources(message), photos);
  for (let i = 0; i < 100; i++) f.conversation.changed.next();
  assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[0], { path: 'PERRINNMessages', filters: [
    ['where', 'user', '==', participant], ['where', 'verified', '==', true], ['orderBy', 'serverTimestamp', 'desc'], ['limit', 1] ] });
  assert.equal(f.service.profiles.get(participant).secret, undefined);
});
test('already loaded profile prevents a second fetch and account changes suppress stale results', async t => {
  const f = fixture(t); await tick();
  f.conversation.allowed = false; f.conversation.changed.next();
  f.ui.PERRINNAdminLastMessageObj = { user: admin, name: 'Loaded admin', imageUrlThumbUser: 'existing-thumb' };
  f.conversation.allowed = true; f.conversation.uid = participant; f.conversation.changed.next();
  assert.equal(f.calls.length, 3); assert.deepEqual(f.service.sources({ userId: admin }), ['existing-thumb']);
  assert.equal(f.service.name({ userId: admin }), 'Loaded admin');
  const pending = new Subject(); f.result(() => pending);
  f.conversation.uid = admin; f.conversation.changed.next();
  f.conversation.allowed = false; f.conversation.changed.next();
  pending.next({ docs: [{ data: () => ({ user: participant, imageUrlThumbUser: 'late' }) }] }); await tick();
  assert.equal(f.service.profiles.size, 0); assert.deepEqual(f.service.sources({ userId: participant }), []);
});
test('failed profile reads use the production initials fallback and do not retry on waveform updates', async t => {
  const f = fixture(t); await tick();
  f.conversation.allowed = false; f.conversation.changed.next();
  f.result(() => { throw Error('Offline'); }); f.conversation.allowed = true; f.conversation.changed.next();
  await tick();
  assert.equal(f.service.name({ userId: participant, authorName: 'Fallback name' }), 'Fallback name');
  assert.deepEqual(f.service.sources({ userId: participant }), []);
  const count = f.calls.length; for (let i = 0; i < 20; i++) f.conversation.changed.next(); assert.equal(f.calls.length, count);
});

test('both other participants have independent cached photos and names', async t => {
  const f = fixture(t); await tick();
  for (const uid of [participant, added]) {
    assert.equal(f.service.name({ userId: uid, authorName: 'Fallback' }), 'Actual name');
    assert.deepEqual(f.service.sources({ userId: uid }), ['thumb', 'medium']);
  }
  assert.equal(f.calls.length, 2);
});
