import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { BehaviorSubject, Subject, Subscription } from 'rxjs';
import ts from 'typescript';

class Emitter extends Subject { emit(value) { this.next(value); } }
const core = { Output: () => () => {}, EventEmitter: Emitter, Injectable: () => target => target, Component: () => target => target, runInInjectionContext: (_, fn) => fn() };
function load(path, globals = {}) {
  const url = new URL(path, import.meta.url), require = createRequire(url), module = { exports: {} };
  const code = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  runInNewContext(code, { module, exports: module.exports, require: name => name === '@angular/core' ? core : name.startsWith('.') ? load(new URL(name + '.ts', url), globals) : require(name), ...globals });
  return module.exports;
}
const { ProfilePageSession, ProfileFeedService } = load('../src/app/profile/profileFeed.service.ts');
const { ledgerRows, illustration } = load('../src/app/profile/profileModel.ts');
const { ProfileComponent } = load('../src/app/profile.component.ts');
const { ProfileActionsService } = load('../src/app/profile/profileActions.service.ts');
const { SidebarConversationsComponent } = load('../src/app/sidebar-conversations/sidebar-conversations.component.ts');
const doc = number => ({ id: `record-${number}`, data: () => ({ user: 'person', serverTimestamp: { seconds: 1000 - number }, wallet: { balance: number } }) });
function pages() {
  const calls = [];
  const session = new ProfilePageSession((cursor, next, error) => {
    const call = { cursor, next, error, stopped: false };
    calls.push(call);
    return new Subscription(() => call.stopped = true);
  });
  return { session, calls };
}

test('profile pages issue one bounded request per action and stop at exhaustion', () => {
  const { session, calls } = pages();
  session.loadMore(); session.loadMore();
  assert.equal(calls.length, 1);
  calls[0].next(Array.from({ length: 31 }, (_, index) => doc(index)));
  assert.equal(session.current.items.length, 30);
  session.loadMore();
  assert.equal(calls[1].cursor.id, 'record-29');
  // An earlier live emission cannot unlock a concurrent third request.
  calls[0].next(Array.from({ length: 31 }, (_, index) => doc(index)));
  session.loadMore(); assert.equal(calls.length, 2);
  calls[1].next([doc(30), doc(31)]);
  assert.equal(session.current.items.length, 32);
  assert.equal(session.current.hasMore, false);
  session.loadMore(); assert.equal(calls.length, 2);
  session.destroy(); assert.ok(calls.every(call => call.stopped));
  calls[0].next([]); assert.equal(session.current.items.length, 32);
});

test('live page boundaries discard stale later pages without automatic refetching', () => {
  const { session, calls } = pages();
  session.loadMore(); calls[0].next(Array.from({ length: 31 }, (_, i) => doc(i)));
  session.loadMore(); calls[1].next([doc(30)]);
  calls[0].next(Array.from({ length: 31 }, (_, i) => doc(i - 1)));
  assert.ok(calls[1].stopped);
  assert.equal(session.current.items.length, 30);
  assert.equal(calls.length, 2);
  session.loadMore(); assert.equal(calls[2].cursor.id, 'record-28');
  session.destroy();
});

test('empty pages stop and failures retain records with explicit retry', () => {
  const { session, calls } = pages();
  session.loadMore(); calls[0].error();
  assert.ok(session.current.error);
  session.loadMore(); calls[1].next(Array.from({ length: 31 }, (_, i) => doc(i)));
  session.loadMore(); calls[2].error();
  assert.equal(session.current.items.length, 30);
  assert.ok(session.current.error);
  session.loadMore(); assert.equal(calls[3].cursor.id, 'record-29');
  calls[3].next([]);
  assert.equal(session.current.error, false); assert.equal(session.current.hasMore, false);
  session.destroy();
});

test('all profile queries preserve their predicates and use explicit limits', () => {
  const calls = [];
  const afs = { collection: (_, build) => {
    const ops = [], query = Object.fromEntries(['where', 'orderBy', 'limit', 'startAfter'].map(name => [name, (...args) => { ops.push([name, ...args]); return query; }]));
    build(query); calls.push(ops);
    return { valueChanges: () => new BehaviorSubject([]), snapshotChanges: () => new Subject() };
  } };
  const service = new ProfileFeedService(afs, null);
  service.user('person').subscribe().unsubscribe();
  assert.ok(calls[0].some(op => op[0] === 'limit' && op[1] === 1));
  for (const feed of ['inbox', 'history', 'chain']) { const session = service.create('person', feed); session.loadMore(); session.destroy(); }
  calls.slice(1).forEach((ops, index) => assert.ok(ops.some(op => op[0] === 'limit' && op[1] === (index === 1 ? 121 : 31))));
  assert.ok(calls[1].some(op => op[1] === 'recipientList' && op[2] === 'array-contains-any' && op[3][0] === 'person'));
  assert.ok(calls[2].some(op => op[1] === 'userChain.newMonth' && op[3] === true));
  assert.ok(calls[3].some(op => op[1] === 'user' && op[3] === 'person'));
  const indexes = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url))).indexes;
  for (const fields of [['user', 'verified', 'serverTimestamp'], ['user', 'userChain.newMonth', 'serverTimestamp'], ['lastMessage', 'recipientList', 'serverTimestamp'], ['lastMessage', 'verified', 'serverTimestamp']]) {
    assert.ok(indexes.some(index => fields.every(field => index.fields.some(entry => entry.fieldPath === field))), `index for ${fields}`);
  }
});

test('ledger deltas use chronological adjacent records, leave the unknown baseline blank, and never mutate source', () => {
  const older = { id: 'old', verifiedTimestamp: { seconds: 86400 }, wallet: { balance: 10 }, userChain: { index: 1 }, purchaseCOIN: { amountCummulate: 4 } };
  const newer = { id: 'new', verifiedTimestamp: { seconds: 172800 }, wallet: { balance: 25 }, userChain: { index: 4 }, purchaseCOIN: { amountCummulate: 9 }, transactionIn: { amountCummulate: 3 }, transactionOut: { amountCummulate: 1 } };
  const records = [newer, older], original = JSON.stringify(records), rows = ledgerRows(records);
  assert.equal(rows[0].change, null); assert.equal(rows[1].change, 15);
  assert.equal(rows[1].funding, 5); assert.equal(rows[1].transfers, 2);
  assert.equal(rows[1].days, 1); assert.equal(rows[1].messages, 3);
  assert.equal(JSON.stringify(records), original);
  assert.equal(illustration({ wallet: { balance: 100 } }, 0)[20].balance, 100);
  assert.equal(illustration({}, 0.1)[20].balance, 0);
});

test('profile defaults to Overview, starts no feed until selected, releases listeners on tab and user changes', () => {
  const params = new BehaviorSubject({ id: 'first' }), auth = new BehaviorSubject({ uid: 'viewer' });
  const sources = [], sessions = [], cursorUpdates = [], navigation = [];
  const feeds = { user: id => { const subject = new BehaviorSubject({ user: id }); let stopped = false;
    sources.push({ id, subject, get stopped() { return stopped; } });
    // A tracked observable supports checking old profile listeners are released.
    return { subscribe: observer => { const subscription = subject.subscribe(observer); subscription.add(() => stopped = true); return subscription; } };
  }, create: (id, feed) => { const session = pages().session; sessions.push({ id, feed, session }); return session; } };
  const cursor = { changes: new BehaviorSubject({ timestamps: {}, flags: {}, ready: true }), update: (...args) => cursorUpdates.push(args), destroy() {} };
  const page = new ProfileComponent({ currentUser: 'viewer' }, { navigate: (...args) => navigation.push(args) }, { params }, feeds,
    { lastActiveAt: () => new BehaviorSubject(0) }, {}, { createSession: () => cursor }, { authState: auth }, { markForCheck() {} });
  page.ngOnInit(); assert.equal(page.tab, 'overview'); assert.equal(sessions.length, 0);
  page.selectTab('inbox'); assert.equal(sessions.length, 1);
  page.selectTab('inbox'); assert.equal(sessions.length, 1);
  page.selectTab('chain'); assert.equal(sessions[0].session.closed, true);
  params.next({ id: 'second' }); assert.equal(sources[0].stopped, true);
  assert.equal(sessions[1].session.closed, true); assert.equal(page.tab, 'overview');
  params.next({ id: 'all' }); assert.equal(navigation[0][0][0], '/home');
  page.ngOnDestroy(); assert.equal(sources[1].stopped, true);
});

test('message action retains existing payload and contract signature keeps its legacy identity', async () => {
  const writes = [], UI = { currentUser: 'viewer', newId: () => 'chat-id', createMessage: async payload => writes.push(payload) };
  const actions = new ProfileActionsService(UI);
  assert.equal(await actions.startChat({ user: 'person' }), 'chat-id');
  assert.equal(writes[0].recipientList[0], 'person');
  assert.equal(await actions.startChat({ user: 'viewer' }), null);
  assert.equal(actions.canSign({ contract: { createdTimestamp: 1 } }), false);
  UI.currentUser = null; assert.equal(await actions.startChat({ user: 'person' }), null);
});


test('dedicated sidebar preserves human-feed limits, cursor activity, canonical routing and teardown', () => {
  const rows = new BehaviorSubject([{ payload: { doc: { id: 'message', data: () => ({ chain: 'conversation', text: 'Hello', serverTimestamp: { seconds: 100 } }) } } }]);
  const cursors = new BehaviorSubject({ timestamps: { conversation: 50000 }, flags: { conversation: true }, ready: true, unavailable: false });
  const auth = new BehaviorSubject({ uid: 'viewer' }), stable = new Subject(), limits = [], updates = [], summaries = [], navigation = [];
  let destroyed = false, cleared = false;
  const session = { changes: cursors, update: (...args) => updates.push(args), destroy: () => destroyed = true };
  const UI = { currentUser: 'viewer', currentUserLastMessageObj: { user: 'viewer', name: 'Alex' } };
  const sidebar = new SidebarConversationsComponent({ human: limit => { limits.push(limit); return rows; } },
    { createSession: () => session }, { authState: auth }, { updateConversations: value => summaries.push(value), clear: () => cleared = true },
    UI, { url: '/chat/conversation', navigate: (...args) => navigation.push(args) }, { onStable: stable, run: fn => fn() }, { markForCheck() {} });
  sidebar.ngOnInit(); sidebar.ngDoCheck();
  assert.deepEqual(limits, [30]); assert.equal(sidebar.activeChain, 'conversation');
  assert.equal(updates.at(-1)[1][0], 'conversation');
  assert.equal(summaries.at(-1).ready, true); assert.equal(summaries.at(-1).flags.conversation, true);
  sidebar.loadMore(); assert.deepEqual(limits, [30, 45]);
  sidebar.open('conversation'); assert.equal(navigation[0][0][0], '/chat');
  auth.next(null); sidebar.ngDoCheck(); assert.equal(summaries.at(-1).ready, false);
  sidebar.ngOnDestroy(); assert.equal(destroyed, true); assert.equal(cleared, true);
  assert.equal(rows.observed, false); assert.equal(auth.observed, false); assert.equal(cursors.observed, false);
});


test('a shortened live page clears an obsolete paging failure without restarting from the beginning', () => {
  const { session, calls } = pages();
  session.loadMore(); calls[0].next(Array.from({ length: 31 }, (_, i) => doc(i)));
  session.loadMore(); calls[1].error(); assert.equal(session.current.error, true);
  calls[0].next([doc(0)]);
  assert.equal(session.current.error, false); assert.equal(session.current.hasMore, false);
  session.loadMore(); assert.equal(calls.length, 2);
  session.destroy();
});


test('profile charts use distinct solid engineering traces and one formatter for tooltips and Y labels', () => {
  const { profileChart, profileChartValue } = load('../src/app/profile/profileCharts.ts', {
    document: { documentElement: {} }, getComputedStyle: () => ({ fontFamily: 'Segoe UI', getPropertyValue: token => token })
  });
  const record = { wallet: { balance: 12345 } };
  for (const forecast of [false, true]) {
    const chart = profileChart(record, [{ ...record, serverTimestamp: { seconds: 100 } }], forecast, 0.1, value => value, 'GBP');
    assert.equal(new Set(chart.series.map(series => series.stroke)).size, chart.series.length);
    for (const series of chart.series) {
      assert.equal(series.lineDash.length, 0); assert.equal(series.strokeWidth, 2);
      for (const value of [0, 0.00123, 0.000001, -42.123, 123.456, 12345, 1234567]) {
        const datum = { [series.xKey]: forecast ? 2 : 1700000000000, [series.yKey]: value };
        const tooltip = series.tooltip.renderer({ datum, xKey: series.xKey, yKey: series.yKey });
        const label = chart.axes[1].label.formatter({ value });
        assert.equal(chart.axes[1].label.formatter({ value: String(value) }), label);
        assert.ok(tooltip.content.endsWith(label + ' GBP'), `${value}: matching tooltip and axis`);
      }
    }
  }
  assert.equal(profileChartValue(12345), '12.3K'); assert.equal(profileChartValue(1234567), '1.2M');
  assert.equal(profileChartValue('1234'), '1.2K'); assert.equal(profileChartValue('0'), '0'); assert.equal(profileChartValue(-1234), '-1.2K'); assert.equal(profileChartValue(NaN), '—');
});


test('History pages retain 120 records, use the matching cursor and reject unbounded sizes', () => {
  const calls = [];
  const session = new ProfilePageSession((cursor, next) => { calls.push({ cursor, next }); return new Subscription(); }, 120);
  session.loadMore(); calls[0].next(Array.from({ length: 121 }, (_, i) => doc(i)));
  assert.equal(session.current.items.length, 120); assert.equal(session.current.hasMore, true);
  session.loadMore(); assert.equal(calls[1].cursor.id, 'record-119');
  calls[1].next([doc(120)]); assert.equal(session.current.items.length, 121); assert.equal(session.current.hasMore, false);
  session.destroy();
  for (const size of [0, 121, Infinity]) assert.throws(() => new ProfilePageSession(() => new Subscription(), size));
});
