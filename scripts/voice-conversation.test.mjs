import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { BehaviorSubject, Subject, Observable, of } from 'rxjs';
import ts from 'typescript';
const require = createRequire(import.meta.url), exports = {};
const source = ts.transpileModule(readFileSync(new URL('../src/app/prototypes/voice-input/voiceConversation.service.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true }
}).outputText;
let inContext = false;
new Function('exports', 'require', source)(exports, name => name === '@angular/core'
  ? { Injectable: () => value => value, runInInjectionContext: (_injector, fn) => { inContext = true; try { return fn(); } finally { inContext = false; } } }
  : name === 'rxjs' ? require(name) : {});
const { VoiceConversationService, VOICE_ADMIN, VOICE_PARTICIPANT } = exports;
function document(id, createdAt = Number(id), userId = VOICE_PARTICIPANT) {
  return { id, data: () => ({ userId, requestId: 'request-' + id, text: 'Message ' + id, authorName: 'Participant', createdAt: { toMillis: () => createdAt } }) };
}
function fixture(t, initial = { uid: VOICE_PARTICIPANT, ready: true, isAdmin: false }) {
  const state = new BehaviorSubject(initial), calls = [], listeners = [];
  let response = () => of({ docs: [], size: 0 }), active = 0;
  const firestore = { collection(path, query) {
    assert.equal(inContext, true);
    const constraints = [], ref = { orderBy: (...args) => { constraints.push(['orderBy', ...args]); return ref; },
      limit: value => { constraints.push(['limit', value]); return ref; }, startAfter: doc => { constraints.push(['startAfter', doc.id]); return ref; } };
    query(ref); assert.equal(path, 'VoiceConversations/pilot/messages'); assert.deepEqual(constraints.at(-1), ['limit', 50]);
    return { snapshotChanges: () => {
      calls.push({ kind: 'listen', constraints }); const subject = new Subject(); listeners.push(subject);
      return new Observable(observer => { active++; const sub = subject.subscribe(observer); return () => { active--; sub.unsubscribe(); }; });
    }, get: options => { assert.equal(options.source, 'server'); calls.push({ kind: 'get', constraints }); return response(); } };
  } };
  const service = new VoiceConversationService(firestore, {}, { state });
  t.after(() => service.ngOnDestroy());
  return { service, state, calls, listeners, active: () => active, respond: fn => { response = fn; },
    emit: docs => listeners.at(-1).next(docs.map(doc => ({ payload: { doc } }))) };
}
test('pilot identity is consistent across the client, trusted handler and security rules', () => {
  const backend = require('../functions/utils/voiceConversation');
  assert.equal(VOICE_ADMIN, backend.VOICE_ADMIN); assert.equal(VOICE_PARTICIPANT, backend.VOICE_PARTICIPANT);
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.ok(rules.includes(VOICE_ADMIN)); assert.ok(rules.includes(VOICE_PARTICIPANT));
});
test('only the two participants open a single listener; permission changes clear history and unsubscribe', t => {
  const f = fixture(t, { uid: 'outsider', ready: true, isAdmin: true });
  assert.equal(f.service.allowed, false); assert.equal(f.calls.length, 0);
  f.state.next({ uid: VOICE_ADMIN, ready: true, isAdmin: false }); assert.equal(f.calls.length, 0);
  f.state.next({ uid: VOICE_ADMIN, ready: true, isAdmin: true }); assert.equal(f.active(), 1);
  f.emit([document('1')]); assert.equal(f.service.messages.length, 1);
  f.state.next({ uid: VOICE_ADMIN, ready: true, isAdmin: false });
  assert.equal(f.active(), 0); assert.deepEqual(f.service.messages, []); assert.equal(f.service.allowed, false);
  f.listeners[0].next([{ payload: { doc: document('2') } }]); assert.deepEqual(f.service.messages, []);
  f.state.next({ uid: VOICE_PARTICIPANT, ready: true, isAdmin: false }); assert.equal(f.active(), 1);
  f.state.next({ uid: VOICE_PARTICIPANT, ready: true, isAdmin: false }); assert.equal(f.active(), 1); assert.equal(f.calls.length, 2);
});
test('history makes one fifty-record request per action and ignores concurrent clicks and stale account results', async t => {
  const f = fixture(t); f.emit(Array.from({ length: 50 }, (_, i) => document(String(100 - i))));
  assert.equal(f.service.canLoadEarlier, true); assert.equal(f.service.messages[0].id, '51');
  const pending = new Subject(); f.respond(() => pending);
  const loading = f.service.loadEarlier(); await f.service.loadEarlier();
  assert.equal(f.calls.filter(c => c.kind === 'get').length, 1);
  assert.deepEqual(f.calls.at(-1).constraints, [['orderBy', 'createdAt', 'desc'], ['startAfter', '51'], ['limit', 50]]);
  pending.next({ docs: [document('50')], size: 1 }); await loading;
  assert.equal(f.service.messages[0].id, '50'); assert.equal(f.service.canLoadEarlier, false);
  await f.service.loadEarlier(); assert.equal(f.calls.length, 2);
  f.emit(Array.from({ length: 50 }, (_, i) => document(String(300 - i))));
  assert.equal(f.service.messages.length, 50, 'A gap resets history instead of silently omitting messages.');
  const late = new Subject(); f.respond(() => late); const request = f.service.loadEarlier();
  f.state.next({ uid: '', ready: true, isAdmin: false }); late.next({ docs: [document('200')], size: 1 }); await request;
  assert.deepEqual(f.service.messages, []); assert.equal(f.active(), 0); assert.equal(f.service.loadingEarlier, false);
});
test('a fuller server window corrects a partial cached window and live updates deduplicate loaded messages', t => {
  const f = fixture(t); f.emit([document('99'), document('98')]); assert.equal(f.service.canLoadEarlier, false);
  f.emit(Array.from({ length: 50 }, (_, i) => document(String(100 - i))));
  assert.equal(f.service.canLoadEarlier, true); assert.equal(f.service.messages.length, 50);
  f.emit(Array.from({ length: 50 }, (_, i) => document(String(101 - i))));
  assert.equal(f.service.messages.length, 51); assert.equal(f.service.messages.at(-1).id, '101');
});
test('listener and history failures support explicit retry without automatic queries', async t => {
  const f = fixture(t); f.listeners[0].error(Error('Unavailable'));
  assert.equal(f.service.loading, false); assert.ok(f.service.error); assert.equal(f.active(), 0); assert.equal(f.calls.length, 1);
  f.service.retry(); assert.equal(f.active(), 1); assert.equal(f.calls.length, 2);
  f.emit(Array.from({ length: 50 }, (_, i) => document(String(100 - i))));
  f.respond(() => new Observable(subscriber => subscriber.error(Error('Unavailable'))));
  await f.service.loadEarlier(); assert.ok(f.service.error); assert.equal(f.service.loadingEarlier, false);
  f.respond(() => of({ docs: [], size: 0 })); f.service.retry(); await new Promise(setImmediate);
  assert.equal(f.calls.filter(c => c.kind === 'listen').length, 2); assert.equal(f.calls.filter(c => c.kind === 'get').length, 2);
  assert.equal(f.service.error, ''); assert.equal(f.service.canLoadEarlier, false);
});
