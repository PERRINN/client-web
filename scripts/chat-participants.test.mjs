import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { BehaviorSubject, of } from 'rxjs';
const require = createRequire(import.meta.url);
const { validateParticipantChange, resolveParticipants } = require('../functions/utils/chatParticipants');
const command = (action = 'add', userId = 'alex') => ({ user: 'admin', chain: 'engineering', participantChange: { action, userId } });

test('server rejects malformed commands before Auth or Firestore work', async () => {
  let reads = 0;
  const auth = { getUser: async () => { reads++; return {}; } };
  await validateParticipantChange({ user: 'ordinary' }, auth);
  for (const change of [null, [], {}, { action: 'clear', userId: 'alex' }, { action: 'add', userId: 'a.b' },
    { action: 'add', userId: '' }, { action: 'add', userId: 'a'.repeat(129) }, { action: 'add', userId: 'alex', extra: true }]) {
    await assert.rejects(validateParticipantChange({ ...command(), participantChange: change }, auth), /Invalid/);
  }
  await assert.rejects(validateParticipantChange({ ...command(), chain: '../x' }, auth));
  assert.equal(reads, 0);
});
test('server requires the current enabled admin claim; add checks target with a fixed Auth budget', async () => {
  for (const actor of [{}, { customClaims: { perrinnAdmin: 'true' } }, { disabled: true, customClaims: { perrinnAdmin: true } }]) {
    await assert.rejects(validateParticipantChange(command(), { getUser: async () => actor }), /Admin/);
  }
  const calls = [], auth = { getUser: async id => { calls.push(id); return { customClaims: { perrinnAdmin: true } }; } };
  await validateParticipantChange(command(), auth); assert.deepEqual(calls, ['admin', 'alex']);
  calls.length = 0;
  await validateParticipantChange(command('remove'), auth); assert.deepEqual(calls, ['admin']);
  await assert.rejects(validateParticipantChange(command(), { getUser: async id => ({ disabled: id === 'alex', customClaims: { perrinnAdmin: true } }) }), /unavailable/);
  await assert.rejects(validateParticipantChange(command(), { getUser: async () => { throw Error('missing account'); } }), /missing/);
});
test('deltas preserve other participants, reject supplied replacement lists, allow self-removal and rejoining', () => {
  const previous = { recipientList: ['admin', 'alex', 'bob'] };
  const removed = resolveParticipants(command('remove'), previous);
  assert.deepEqual(removed, ['admin', 'bob']);
  assert.deepEqual(resolveParticipants(command('remove', 'admin'), previous), ['alex', 'bob']);
  assert.deepEqual(resolveParticipants({ user: 'alex' }, { recipientList: removed }), ['alex', 'admin', 'bob']);
  assert.deepEqual(resolveParticipants({ ...command(), recipientList: ['injected'] }, previous), ['admin', 'alex', 'bob']);
  assert.deepEqual(resolveParticipants(command('add', 'new'), previous), ['admin', 'alex', 'bob', 'new']);
  assert.deepEqual(resolveParticipants(command('remove', 'missing'), previous), ['admin', 'alex', 'bob']);
  assert.deepEqual(resolveParticipants({ user: 'author', recipientList: ['invited'], transactionOut: { user: 'payee' } }, previous), ['author', 'payee', 'invited', 'admin', 'alex', 'bob']);
  assert.deepEqual(resolveParticipants({ ...command('remove'), verified: true, recipientList: removed }, previous, true), removed);
});

function load(file, overrides = {}) {
  const core = { Injectable: () => x => x, Component: () => x => x, Input: () => () => {}, Output: () => () => {}, ViewChild: () => () => {},
    EventEmitter: class { values = []; emit(v) { this.values.push(v); } }, runInInjectionContext: (_, fn) => fn() };
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, name => overrides[name] || (name === '@angular/core' ? core : require(name)));
  return exports;
}
const { ChatParticipantsService } = load('../src/app/chat/chat-participants/chatParticipants.service.ts');
const { ChatParticipantsComponent } = load('../src/app/chat/chat-participants/chat-participants.component.ts');
const { ChatDataService } = load('../src/app/chat/chatData.service.ts', { '../userInterface.service': {}, './chat-event/chatEvent': {}, './chat-fund/chatFund': {}, './chatData': {} });
const admin = { uid: 'admin', ready: true, isAdmin: true };
const member = { id: 'alex', name: 'Alex', avatarName: 'Alex', avatar: '' };
const tick = () => new Promise(setImmediate);
globalThis.requestAnimationFrame = fn => fn();
function fixture() {
  const state = new BehaviorSubject(admin), writes = [];
  const permissions = { current: admin, state };
  const component = new ChatParticipantsComponent(permissions, { search: async () => ({ people: [member], hasMore: false }) },
    { changeParticipant: async (...args) => { writes.push(args); return 'command-id'; } }, { run: fn => fn() });
  component.chain = 'engineering'; component.ngOnChanges();
  return { component, permissions, state, writes };
}
test('client writes only as the real admin with validated commands and emits the saved message ID', async () => {
  const writes = [], user = { uid: 'admin', getIdTokenResult: async () => ({ claims: { sub: 'admin', perrinnAdmin: true } }) };
  const data = new ChatDataService({}, { currentUser: user }, {}, {}, { currentUser: 'admin', createMessage: async value => { writes.push(value); return { id: 'saved' }; } });
  const acknowledgements = []; data.submitted.subscribe(value => acknowledgements.push(value));
  assert.equal(await data.changeParticipant('engineering', 'add', member), 'saved');
  assert.deepEqual(writes[0].participantChange, { action: 'add', userId: 'alex' });
  assert.equal(acknowledgements[0].messageId, 'saved');
  user.getIdTokenResult = async () => ({ claims: { sub: 'different', perrinnAdmin: true } });
  await assert.rejects(data.changeParticipant('engineering', 'remove', member), /Admin/);
  assert.equal(writes.length, 1);
});
test('picker performs exactly one limit-20 server request per action, with cursor and no balance gate', async () => {
  const calls = [], cursor = {}, permissions = { current: admin };
  const query = new Proxy({}, { get: (_, name) => (...args) => { calls.push([name, ...args]); return query; } });
  const afs = { collection: (name, callback) => { assert.equal(name, 'PERRINNMessages'); callback(query); return { get: options => {
    calls.push(['get', options]); return of({ size: 20, docs: [{ data: () => ({ user: 'alex', name: 'Alex', wallet: { balance: 42.5 } }) }] });
  } }; } };
  const service = new ChatParticipantsService(afs, {}, permissions);
  const result = await service.search(' Alex ', cursor);
  assert.equal(result.people[0].id, 'alex'); assert.equal(result.people[0].balance, 42.5); assert.equal(result.hasMore, true);
  assert.deepEqual(calls.filter(call => call[0] === 'limit'), [['limit', 20]]);
  assert.deepEqual(calls.find(call => call[0] === 'startAfter'), ['startAfter', cursor]);
  assert.deepEqual(calls.find(call => call[0] === 'startAt'), ['startAt', 'alex']);
  assert.equal(calls.filter(call => call[0] === 'get').length, 1);
  assert.ok(!JSON.stringify(calls).includes('wallet'));
  permissions.current = { ...admin, isAdmin: false };
  await assert.rejects(service.search('alex'), /Admin/);
  assert.equal(calls.filter(call => call[0] === 'get').length, 1);
});
test('verification, not submission, confirms a change; role loss discards picker and late results', async () => {
  const f = fixture();
  await f.component.change('add', member);
  assert.equal(f.component.saving, true); assert.equal(f.component.members.length, 0);
  f.component.messages = [{ id: 'command-id', verified: false }]; f.component.ngOnChanges();
  assert.equal(f.component.saving, true);
  f.component.messages = [{ id: 'command-id', verified: true }]; f.component.ngOnChanges();
  assert.equal(f.component.saving, false); assert.equal(f.component.notice, 'Participants updated');
  f.component.openPicker();
  let finish;
  f.component.directory = { search: () => new Promise(resolve => { finish = resolve; }) };
  f.component.query = 'alex'; const request = f.component.search();
  f.permissions.current = { ...admin, isAdmin: false }; f.state.next(f.permissions.current);
  finish({ people: [member], hasMore: true }); await request;
  assert.equal(f.component.picker, false); assert.deepEqual(f.component.results, []);
  await f.component.change('add', member); assert.equal(f.writes.length, 1);
  f.component.ngOnDestroy();
});
test('failed drafts remain retryable, existing members are filtered, paging stops at ten explicit pages', async () => {
  const f = fixture(); f.component.query = 'alex';
  f.component.directory = { search: async () => { throw Error('offline'); } };
  await f.component.search(); assert.equal(f.component.query, 'alex'); assert.match(f.component.error, /couldn’t load/);
  let calls = 0;
  f.component.directory = { search: async () => { calls++; return { people: [member], hasMore: true }; } };
  await f.component.search(); f.component.members = [member]; assert.deepEqual(f.component.available, []);
  for (let i = 0; i < 15; i++) await f.component.search(true);
  assert.equal(calls, 10); assert.equal(f.component.canLoadMore, false);
  f.component.data = { changeParticipant: async () => { throw Error('offline'); } };
  f.component.confirmRemoval(member); await f.component.change('remove', member);
  assert.equal(f.component.removing, member); assert.equal(f.component.saving, false); assert.match(f.component.error, /couldn’t save/);
  f.component.ngOnDestroy(); await tick();
});

test('participant balances use the shared viewer-currency formatter and preserve zero and missing values', () => {
  const calls = [], UI = { currency: 'GBP', convertAndFormatPRNToPRNCurrency(currency, amount) { calls.push([currency, amount]); return `PRN ${this.currency} ${amount}`; } };
  const data = new ChatDataService({}, {}, {}, {}, UI);
  for (const amount of [0, 42.5, -1]) assert.equal(data.participantBalance(amount), `PRN GBP ${amount}`);
  UI.currency = 'EUR'; assert.equal(data.participantBalance(42.5), 'PRN EUR 42.5');
  for (const amount of [undefined, null, NaN, Infinity, '42']) assert.equal(data.participantBalance(amount), 'PRN —');
  assert.deepEqual(calls, [[null, 0], [null, 42.5], [null, -1], [null, 42.5]]);
});
