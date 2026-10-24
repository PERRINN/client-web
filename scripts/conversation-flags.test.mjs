import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { Subscription } from 'rxjs';
import ts from 'typescript';
const core = { Injectable: () => value => value, runInInjectionContext: (_, fn) => fn() };
function load(path) {
  const url = new URL(path, import.meta.url), require = createRequire(url), module = { exports: {} };
  const code = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  runInNewContext(code, { module, exports: module.exports, queueMicrotask, require: name => name === '@angular/core' ? core : name === 'firebase/firestore' ? { serverTimestamp: () => 'server-time' } : name.startsWith('.') ? load(new URL(name + '.ts', url)) : require(name) });
  return module.exports;
}
const { conversationIndicators } = load('../src/app/conversationActivity.ts');
const { ReadCursorSession, ReadCursorService } = load('../src/app/readCursor.service.ts');
const { MessageActivityService } = load('../src/app/messageActivity.service.ts');
const profile = { user: 'viewer', name: 'Alex', createdTimestamp: 1000 };
const message = { id: 'z', chain: 'chat', user: 'author', text: 'Hello ALEX!', serverTimestamp: { seconds: 20 } };
const cursors = { userId: 'viewer', ready: true, unavailable: false, readyChains: { chat: true }, timestamps: {}, messageIds: {}, flags: {} };
const indicator = (changes = {}, state = cursors, person = profile, uid = 'viewer') => conversationIndicators({ ...message, ...changes }, uid, person, state);

function sessionFixture() {
  const calls = [], writes = [];
  let inside = false;
  const zone = { run: fn => { inside = true; try { return fn(); } finally { inside = false; } } };
  const afs = { doc: path => ({ valueChanges: () => ({ subscribe: observer => {
    const call = { path, observer, stopped: false }; calls.push(call);
    return new Subscription(() => call.stopped = true);
  } }), set: async (data, options) => writes.push({ path, data, options }) }) };
  const session = new ReadCursorSession(afs, {}, zone), states = [];
  session.changes.subscribe(state => states.push({ state, inside }));
  return { session, calls, writes, states, afs, zone };
}

test('manual flags remain independent of unread state and missing profile metadata', () => {
  const state = { ...cursors, timestamps: { chat: 20000 }, messageIds: { chat: 'z' }, flags: { chat: true } };
  assert.equal(indicator({}, state).unread, null); assert.equal(indicator({}, state).flagged, true);
  assert.equal(indicator({}, state, null).flagged, true);
  assert.equal(indicator({ user: 'viewer' }, { ...state, timestamps: {} }).unread, null);
});

test('name, recipient and other indicators use the same Unicode-aware mention rules as chat', () => {
  assert.equal(indicator().unread, 'mention');
  assert.equal(indicator({ text: 'Hello Alexis', recipients: { viewer: true } }).unread, 'recipient');
  assert.equal(indicator({ text: 'Hello Alexis' }).unread, 'other');
  assert.equal(indicator({ text: 'Hello ÉLODIE!' }, cursors, { ...profile, name: 'Élodie' }).unread, 'mention');
  assert.equal(indicator({ text: 'undefined' }, cursors, { ...profile, name: '' }).unread, 'other');
  assert.equal(indicator({ serverTimestamp: undefined }).unread, null);
  assert.equal(indicator({ serverTimestamp: { seconds: 1 } }).unread, null);
});

test('read positions respect equal timestamps and message IDs, with legacy timestamp-only compatibility', () => {
  const state = { ...cursors, timestamps: { chat: 20000 }, messageIds: { chat: 'm' } };
  assert.equal(indicator({ id: 'z' }, state).unread, 'mention');
  assert.equal(indicator({ id: 'm' }, state).unread, null);
  assert.equal(indicator({ id: 'a' }, state).unread, null);
  assert.equal(indicator({}, { ...state, messageIds: {} }).unread, null);
});

test('loading or failing one chain cannot suppress another resolved flag', () => {
  const state = { ...cursors, ready: false, unavailable: true, flags: { chat: true, failed: true } };
  assert.equal(indicator({}, state).flagged, true);
  assert.equal(indicator({ chain: 'failed' }, state).flagged, false);
  assert.equal(indicator({}, { ...state, userId: 'different' }).flagged, false);
  assert.equal(indicator({}, state, { ...profile, user: 'different' }).flagged, false);
  assert.equal(indicator({}, state, profile, null).flagged, false);
});

test('cursor emissions enter Angular, reuse listeners and distinguish resolved/missing/error records', () => {
  const f = sessionFixture(); f.session.update('viewer', ['chat', 'chat', 'other']);
  assert.equal(f.calls.length, 2);
  f.calls[0].observer.next({ blueFlag: true, serverTimestamp: { seconds: 20 }, messageId: 'z' });
  let state = f.states.at(-1).state;
  assert.equal(state.ready, false); assert.equal(state.readyChains.chat, true); assert.equal(state.flags.chat, true);
  f.calls[1].observer.next(undefined); state = f.states.at(-1).state;
  assert.equal(state.ready, true); assert.equal(state.readyChains.other, true); assert.equal(state.flags.other, false);
  assert.equal(state.messageIds.chat, 'z');
  f.session.update('viewer', ['chat', 'other']); assert.equal(f.calls.length, 2);
  assert.ok(f.states.slice(1).every(emission => emission.inside));
  f.session.destroy(); assert.ok(f.calls.every(call => call.stopped));
});

test('retry restarts only failed listeners, once per explicit action, and releases removed chains', () => {
  const f = sessionFixture(); f.session.update('viewer', ['chat', 'broken']);
  f.calls[0].observer.next({ blueFlag: true }); f.calls[1].observer.error(Error('offline'));
  assert.equal(f.states.at(-1).state.unavailable, true);
  f.session.retry(); assert.equal(f.calls.length, 3); assert.equal(f.calls[1].stopped, true);
  f.session.retry(); assert.equal(f.calls.length, 3);
  assert.equal(f.calls[2].path, 'lastSeen/viewer/chats/broken');
  f.calls[2].observer.next({}); assert.equal(f.states.at(-1).state.ready, true);
  f.session.update('viewer', ['chat']); assert.equal(f.calls[2].stopped, true);
  f.session.destroy();
});

test('late callbacks cannot restore flags after chain removal/re-add, account change, sign-out or destruction', () => {
  const f = sessionFixture(); f.session.update('viewer', ['chat']);
  f.calls[0].observer.next({ blueFlag: true });
  f.session.update('viewer', []); f.session.update('viewer', ['chat']);
  f.calls[0].observer.next({ blueFlag: true }); assert.equal(f.states.at(-1).state.flags.chat, undefined);
  f.calls[1].observer.next({ blueFlag: false });
  f.session.update('other', ['chat']); f.calls[1].observer.next({ blueFlag: true });
  assert.equal(f.states.at(-1).state.userId, 'other'); assert.equal(f.states.at(-1).state.flags.chat, undefined);
  f.session.update(null, []); f.calls[2].observer.next({ blueFlag: true }); assert.equal(f.states.at(-1).state.flags.chat, undefined);
  const count = f.states.length; f.session.destroy(); f.session.update('viewer', ['chat']);
  assert.equal(f.states.length, count); assert.equal(f.calls.length, 3);
});

test('flag writes merge only flag fields and preserve the existing read-position contract', async () => {
  const f = sessionFixture(), service = new ReadCursorService(f.afs, {}, f.zone);
  await service.setFlag('viewer', 'chat', true);
  assert.equal(f.writes[0].path, 'lastSeen/viewer/chats/chat');
  assert.deepEqual(Object.keys(f.writes[0].data).sort(), ['blueFlag', 'updatedAt']);
  assert.equal(f.writes[0].options.merge, true); assert.equal(f.writes[0].data.blueFlag, true);
  f.session.destroy();
});

test('shell summaries and Home mentions track row classifications and preserve priority independently of flags', async () => {
  const service = new MessageActivityService({ run: fn => fn() });
  let summary, mentions;
  const subscriptions = [service.summary().subscribe(state => summary = state), service.mentions().subscribe(state => mentions = state)];
  const input = { conversations: [message, { ...message, id: 'recipient', chain: 'recipient', text: 'Hello Alexis', recipients: { viewer: true } }],
    userId: 'viewer', profile, timestamps: {}, messageIds: {}, flags: { chat: true }, ready: true, unavailable: false, readyChains: { chat: true, recipient: true } };
  service.updateConversations(input); await new Promise(queueMicrotask);
  assert.equal(summary.mention, true); assert.equal(summary.recipient, false); assert.equal(summary.other, false); assert.equal(summary.flagged, true);
  assert.equal(mentions.chats[0].chain, 'chat');
  service.updateConversations({ ...input, timestamps: { chat: 20000 }, messageIds: { chat: 'z' } }); await new Promise(queueMicrotask);
  assert.equal(summary.mention, false); assert.equal(summary.recipient, true); assert.equal(summary.flagged, true); assert.equal(mentions.chats.length, 0);
  service.updateConversations({ ...input, ready: false, unavailable: true, readyChains: { chat: true } }); await new Promise(queueMicrotask);
  assert.equal(summary.flagged, true); assert.equal(summary.unavailable, true); assert.equal(mentions.status, 'unavailable');
  service.updateConversations({ ...input, conversations: [{ ...message, isBackendMessage: true }] }); await new Promise(queueMicrotask);
  assert.equal(summary.flagged, false); assert.equal(summary.mention, false);
  service.clear(); await new Promise(queueMicrotask); assert.equal(summary.flagged, false); assert.equal(mentions.status, 'signed-out');
  subscriptions.forEach(subscription => subscription.unsubscribe());
});


test('Inbox timestamps use local calendar time, Yesterday, weekday and older dates', () => {
  const { formatConversationTime } = load('../src/app/conversationTime.ts');
  const now = new Date(2026, 9, 24, 15, 30).getTime();
  assert.equal(formatConversationTime(new Date(2026, 9, 24, 9, 5).getTime(), now), '09:05');
  assert.equal(formatConversationTime(new Date(2026, 9, 23, 23, 50).getTime(), now), 'Yesterday');
  assert.equal(formatConversationTime(new Date(2026, 9, 22, 10).getTime(), now), 'Thursday');
  assert.equal(formatConversationTime(new Date(2026, 9, 18, 10).getTime(), now), 'Sunday');
  assert.equal(formatConversationTime(new Date(2026, 9, 17, 10).getTime(), now), '17 Oct');
  assert.equal(formatConversationTime(new Date(2025, 9, 24, 10).getTime(), now), '24 Oct 2025');
  assert.equal(formatConversationTime(0, now), ''); assert.equal(formatConversationTime(NaN, now), '');
  // UK clocks go back on 25 October; yesterday is a calendar boundary, not 24 hours ago.
  const afterDst = new Date(2026, 9, 26, 0, 30).getTime();
  assert.equal(formatConversationTime(new Date(2026, 9, 25, 0, 10).getTime(), afterDst), 'Yesterday');
});
