import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
import { BehaviorSubject, of } from 'rxjs';
const require = createRequire(import.meta.url);
function load(path, overrides = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, name => overrides[name] || (name.startsWith('../voice/') || name === './chatVoice.service' ? {} : require(name)));
  return exports;
}
class Emitter { values = []; emit(value) { this.values.push(value); } }
const core = { Injectable: () => target => target, Component: () => target => target, Input: () => () => {}, Output: () => () => {}, ViewChild: () => () => {}, EventEmitter: Emitter, runInInjectionContext: (_, fn) => fn() };
const model = load('../src/app/chat/prn-send-manager/prnTransfer.ts');
const mentions = load('../src/app/chat/chatMention.ts');
const credits = load('../src/app/chat/chatTimeCredits.ts');
const context = { userId: 'owner', name: 'Nico', avatar: '', balance: 50, currency: 'gbp', rate: 10 };
const members = [{ id: 'owner', name: 'You' }, { id: 'other', name: 'Alex' }];
const draft = { mode: 'direct', amount: 2, recipient: 'other', code: '', reference: '  Team work  ' };
const makeReview = changes => ({ ...model.reviewTransfer('chat', { ...draft, ...changes }, context, members), messageId: 'transfer' });
const zone = { run: fn => fn() };
globalThis.requestAnimationFrame = fn => fn();

test('latest-message visibility stays stable during rendering and refreshes after scroll, resize and history restoration', () => {
  const { ChatComponent } = load('../src/app/chat/chat.component.ts', {
    '@angular/core': core, './chatRead.service': { ChatReadService: class {} },
    './chat-composer/chat-composer.component': { ChatComposerComponent: class {} },
    './chatData': { messageDateLabel: () => '', continuesMessageGroup: () => false }
  });
  const frames = [], previousFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = fn => frames.push(fn);
  const flush = () => { while (frames.length) frames.shift()(); };
  try {
    const component = new ChatComponent({ paramMap: of({ get: () => null }), snapshot: { queryParamMap: { get: () => null } } }, {}, {},
      { latestHuman: of({ status: 'loading' }) }, zone, { reset() {} }, undefined, { configure() {} });
    const list = { clientHeight: 500, scrollHeight: 1500, top: 0,
      get scrollTop() { return this.top; }, set scrollTop(value) { this.top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); } };
    component.messageList = { nativeElement: list };
    assert.equal(component.showLatest, false); // Assigning the view or laying out messages cannot change a binding.
    component.onScroll(); assert.equal(component.showLatest, true); assert.equal(component.awayFromLatest, true);
    list.scrollHeight = 600;
    assert.equal(component.showLatest, true); // A second template check still sees the same value.
    component.onImageLoad(); assert.equal(component.showLatest, true);
    flush(); assert.equal(component.showLatest, false);
    list.scrollHeight = 2000; component.onScroll(); assert.equal(component.showLatest, true);
    component.pendingAnchor = { top: 0, height: 1500 }; component.onImageLoad();
    assert.equal(list.scrollTop, 500); assert.equal(component.showLatest, true);
    list.scrollTop = 1000; component.onScroll(); assert.equal(component.showLatest, false); // Exact one-viewport threshold.
    list.scrollTop = 999; component.onScroll(); assert.equal(component.showLatest, true);
    component.jumpToLatest(); flush();
    assert.equal(list.scrollTop, 1500); assert.equal(component.showLatest, false); assert.equal(component.awayFromLatest, false);
    component.ngOnDestroy();
  } finally { globalThis.requestAnimationFrame = previousFrame; }
});

test('mentions match full Unicode names and case without substring or regex false positives', () => {
  for (const [text, name, expected] of [
    ['Hello NICOLAS PERRIN!', 'Nicolas Perrin', true], ['@Nicolas Perrin, thanks', 'Nicolas Perrin', true],
    ['Hello Nicolas Perrinsson', 'Nicolas Perrin', false], ['xNicolas Perrin', 'Nicolas Perrin', false],
    ['Jean-Luc O’Neil, hello', 'Jean-Luc O’Neil', true], ['Hi ÉLODIE MARTIN!', 'Élodie Martin', true],
    ['Hi 李 明!', '李 明', true], ['Hi 李 明月', '李 明', false], ['Anything', '  ', false],
    ['A.*B', 'A.*B', true], ['AXYZB', 'A.*B', false], ['Nicolas\nPerrin', 'Nicolas Perrin', true]
  ]) assert.equal(mentions.containsMention(text, name), expected, `${text} / ${name}`);
});

test('message rows highlight incoming mentions only, and clear on sign-out or name change', () => {
  const { ChatMessageComponent } = load('../src/app/chat/chat-message/chat-message.component.ts', { '@angular/core': core, '../chatMention': mentions, '../chatTimeCredits': credits });
  const row = new ChatMessageComponent();
  Object.assign(row, { signedIn: true, viewerName: 'Nico', message: { own: false, text: 'Hi NICO!' } });
  row.ngOnChanges(); assert.equal(row.mentioned, true);
  row.message = { ...row.message, own: true }; row.ngOnChanges(); assert.equal(row.mentioned, false);
  row.message = { ...row.message, own: false }; row.signedIn = false; row.ngOnChanges(); assert.equal(row.mentioned, false);
  row.signedIn = true; row.viewerName = 'Someone Else'; row.ngOnChanges(); assert.equal(row.mentioned, false);
});

test('transfer validation compares PRN against PRN balance and preserves direct/pending contracts', () => {
  const direct = makeReview();
  assert.equal(direct.prnAmount, 20); assert.equal(direct.reference, 'Team work');
  assert.deepEqual(model.transferMessage(direct).transactionOut, { user: 'other', amount: 20, code: null, reference: 'Team work' });
  const pending = makeReview({ mode: 'pending', recipient: 'irrelevant', code: ' token ' });
  assert.deepEqual(model.transferMessage(pending).transactionPending, { amount: 20, code: 'token', reference: 'Team work' });
  assert.equal(pending.recipient, null);
  assert.equal('transactionOut' in model.transferMessage(pending), false);
  assert.throws(() => makeReview({ amount: 6 }), /balance/); // Local amount 6 is below PRN balance 50, but costs 60 PRN.
  assert.equal(makeReview({ amount: 5 }).prnAmount, 50);
  assert.throws(() => makeReview({ recipient: 'owner' }), /yourself/);
  assert.equal(makeReview({ recipient: 'owner', code: 'ok' }).recipient, 'owner');
});

test('invalid amounts, recipients, currency rates and references cannot create a transfer', () => {
  for (const amount of [null, 0, -1, NaN, Infinity, 0.001, 1.001, 1e30]) assert.throws(() => makeReview({ amount }));
  for (const changes of [{ recipient: 'stranger' }, { reference: ' ' }, { reference: 'x'.repeat(501) }, { code: 'x'.repeat(501) }, { mode: 'invalid' }]) assert.throws(() => makeReview(changes));
  for (const changes of [{ rate: 0 }, { rate: NaN }, { balance: NaN }, { currency: '' }, { userId: '' }]) assert.throws(() => model.reviewTransfer('chat', draft, { ...context, ...changes }, members));
  const long = makeReview({ reference: 'x'.repeat(500), code: 'x'.repeat(500) });
  assert.equal(model.transferMessage(long).text.length, 500);
  assert.equal(model.transferMessage(long).transactionOut.reference.length, 500);
});

const { PrnTransferService } = load('../src/app/chat/prn-send-manager/prnTransfer.service.ts', {
  '@angular/core': core, './prnTransfer': model, 'firebase/firestore': { serverTimestamp: () => 'server-time' }
});
function fixture() {
  const profile = { user: 'owner', name: 'Nico', verified: true, wallet: { balance: 50 }, userCurrency: 'gbp' };
  const chat = { verified: true, recipientList: ['owner', 'other'], recipients: { other: { name: 'Alex' } } };
  const writes = [], queries = [], acknowledgements = [], records = new Map();
  const auth = { currentUser: Promise.resolve({ uid: 'owner' }) };
  const UI = { currentUser: 'owner', currentUserLastMessageObj: profile, PERRINNAdminLastMessageObj: { currencyList: { gbp: { toCOIN: 10 } } } };
  let failAfterWrite = false, failBeforeWrite = false, queryHook;
  const afs = {
    collection: (_path, build) => {
      const clauses = [];
      const query = { where: (...args) => { clauses.push(['where', ...args]); return query; }, orderBy: (...args) => { clauses.push(['orderBy', ...args]); return query; }, limit: n => { clauses.push(['limit', n]); return query; } };
      build(query); queries.push(clauses);
      const record = clauses[0][1] === 'user' ? profile : chat;
      queryHook?.();
      return { get: () => of({ docs: [{ data: () => record }] }) };
    },
    firestore: {
      collection: () => ({ doc: () => ({ id: 'transfer' }) }),
      doc: path => ({
        get: async () => ({ exists: records.has(path), data: () => records.get(path) }),
        set: async value => {
          if (failBeforeWrite) throw Object.assign(Error('network'), { code: 'unavailable' });
          writes.push({ path, value }); records.set(path, value);
          if (failAfterWrite) throw Object.assign(Error('network'), { code: 'unavailable' });
        }
      })
    }
  };
  const service = new PrnTransferService(afs, auth, {}, UI, { acknowledgeSubmission: (...args) => acknowledgements.push(args) });
  return { service, profile, chat, UI, auth, writes, queries, records, acknowledgements,
    failAfter: value => failAfterWrite = value, failBefore: value => failBeforeWrite = value, hook: fn => queryHook = fn };
}

test('review and submission refresh bounded balance/participant queries and use existing message fields', async () => {
  const f = fixture(), review = await f.service.prepare('chat', draft);
  assert.equal(f.writes.length, 0);
  await f.service.submit(review);
  assert.equal(f.writes.length, 1);
  assert.equal(f.queries.length, 4);
  assert.ok(f.queries.every(query => query.at(-1)[0] === 'limit' && query.at(-1)[1] === 1));
  const { path, value } = f.writes[0];
  assert.equal(path, 'PERRINNMessages/transfer'); assert.equal(value.user, 'owner'); assert.equal(value.serverTimestamp, 'server-time');
  assert.deepEqual(value.transactionOut, { user: 'other', amount: 20, code: null, reference: 'Team work' });
  assert.deepEqual(f.acknowledgements, [['chat', 'owner', 'transfer']]);
});

test('pending transfer submits the existing command without recipient or new schema fields', async () => {
  const f = fixture(); await f.service.submit(await f.service.prepare('chat', { ...draft, mode: 'pending', recipient: '' }));
  const value = f.writes[0].value;
  assert.deepEqual(value.transactionPending, { amount: 20, code: null, reference: 'Team work' });
  assert.equal('transactionOut' in value, false);
});

test('changed account, balance, rate or participants invalidate a reviewed transfer before writing', async () => {
  for (const change of [f => f.UI.currentUser = 'different', f => f.profile.wallet.balance = 1,
    f => f.UI.PERRINNAdminLastMessageObj.currencyList.gbp.toCOIN = 11, f => f.chat.recipientList = ['owner'],
    f => f.chat.verified = false]) {
    const f = fixture(), review = await f.service.prepare('chat', draft); change(f);
    await assert.rejects(f.service.submit(review)); assert.equal(f.writes.length, 0);
  }
  const f = fixture(); f.auth.currentUser = Promise.resolve(null);
  await assert.rejects(f.service.prepare('chat', draft), /Sign in/);
  assert.equal(f.queries.length, 0);
});

test('retry after an uncertain acknowledgement reuses the same message and cannot duplicate a debit', async () => {
  const f = fixture(), review = await f.service.prepare('chat', draft); f.failAfter(true);
  await assert.rejects(f.service.submit(review)); assert.equal(f.writes.length, 1);
  await f.service.submit(review); assert.equal(f.writes.length, 1);
  assert.deepEqual(f.acknowledgements, [['chat', 'owner', 'transfer']]);
  f.records.get('PERRINNMessages/transfer').transactionOut.reference = 'different';
  await assert.rejects(f.service.submit(review), /status/); assert.equal(f.writes.length, 1);
});

test('failed writes can retry and account changes during refresh are rejected', async () => {
  const f = fixture(), review = await f.service.prepare('chat', draft); f.failBefore(true);
  await assert.rejects(f.service.submit(review)); assert.equal(f.writes.length, 0);
  f.failBefore(false); await f.service.submit(review); assert.equal(f.writes.length, 1);
  const changed = fixture(); changed.hook(() => changed.auth.currentUser = Promise.resolve({ uid: 'other' }));
  await assert.rejects(changed.service.prepare('chat', draft)); assert.equal(changed.writes.length, 0);
});

const { PrnSendManagerComponent } = load('../src/app/chat/prn-send-manager/prn-send-manager.component.ts', { '@angular/core': core, './prnTransfer': model });
function manager(transfers) {
  const authState = new BehaviorSubject({ uid: 'owner' });
  const component = new PrnSendManagerComponent(transfers, { authState }, zone);
  Object.assign(component, { chain: 'chat', signedIn: true }); component.ngOnChanges(); component.open(); component.draft = { ...draft };
  return { component, authState };
}

test('manager requires review, preserves failures, and guards duplicate confirmation', async () => {
  let writes = 0, finish;
  const transfers = { context, prepare: async () => makeReview(), submit: () => { writes++; return new Promise(resolve => finish = resolve); } };
  const { component } = manager(transfers);
  await component.confirm(); assert.equal(writes, 0);
  await component.prepare(); assert.equal(component.review.recipient, 'other');
  const first = component.confirm(); await component.confirm(); assert.equal(writes, 1);
  finish(); await first; assert.equal(component.notice, 'Transfer submitted'); assert.equal(component.editing, false);
  component.open(); component.draft = { ...draft }; await component.prepare();
  transfers.submit = async () => { throw Object.assign(Error('offline'), { code: 'unavailable' }); };
  await component.confirm(); assert.ok(component.review); assert.equal(component.draft.amount, 2); assert.match(component.error, /Retry/);
  component.ngOnDestroy();
});

test('manager discards old completions on account/chain changes and resets drafts on sign-out', async () => {
  let finish;
  const { component, authState } = manager({ context, prepare: () => new Promise(resolve => finish = resolve) });
  const work = component.prepare(); authState.next({ uid: 'other' }); finish(makeReview()); await work;
  assert.equal(component.review, null); assert.equal(component.draft.amount, null); assert.equal(component.busy, false);
  component.open(); const work2 = component.prepare(); component.chain = 'next'; component.ngOnChanges(); finish(makeReview()); await work2;
  assert.equal(component.review, null); component.ngOnDestroy();
});

test('flag control shares owner cursors, handles failure and ignores stale chat completions', async () => {
  const { ChatFlagComponent } = load('../src/app/chat/chat-flag/chat-flag.component.ts', { '@angular/core': core });
  const states = new BehaviorSubject({ flags: { chat: true }, ready: true, unavailable: false });
  const updates = [], writes = []; let finish, destroyed = false;
  const component = new ChatFlagComponent({ createSession: () => ({ changes: states, update: (...args) => updates.push(args), destroy: () => destroyed = true }),
    setFlag: (...args) => { writes.push(args); return new Promise((_, reject) => finish = reject); } }, { authState: new BehaviorSubject({ uid: 'owner' }) }, zone);
  component.chain = 'chat'; component.ngOnChanges(); states.next({ flags: { chat: true }, ready: true, unavailable: false });
  const work = component.toggle(); assert.deepEqual(writes[0], ['owner', 'chat', false]);
  component.chain = 'next'; component.ngOnChanges(); finish(Error('offline')); await work;
  assert.equal(component.error, ''); assert.equal(component.saving, false);
  states.next({ flags: {}, ready: false, unavailable: true }); await component.toggle(); assert.equal(writes.length, 1);
  component.retry(); assert.deepEqual(updates.at(-2), [null, []]);
  component.ngOnDestroy(); assert.equal(destroyed, true);
});
