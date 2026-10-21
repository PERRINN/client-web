import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
import { Subject } from 'rxjs';
const require = createRequire(import.meta.url);
function load(path, overrides = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const exports = {}; new Function('exports', 'require', code)(exports, name => overrides[name] || require(name)); return exports;
}
const model = load('../src/app/chat/chat-fund/chatFund.ts');
const { FundFeedService } = load('../src/app/fundFeed.service.ts', { '@angular/core': { Injectable: () => target => target, runInInjectionContext: (_, fn) => fn() }, './chat/chat-fund/chatFund': model });
const item = (id, fund = {}) => ({ payload: { doc: { id, data: () => ({ chain: id, fund: { description: id, amountGBPTarget: 1000, amountGBPRaised: 123.4,
  closesAt: Date.now() + 86400000, cancelled: false, ...fund }, wallet: { balance: 999 } }) } } });
function fixture() {
  const calls = [], streams = [], cursors = [];
  const afs = { collection: (path, build) => {
    const query = { where: (...args) => { calls.push(['where', ...args]); return query; }, orderBy: (...args) => { calls.push(['orderBy', ...args]); return query; },
      limit: n => { calls.push(['limit', n]); return query; }, startAfter: doc => { cursors.push(doc.id); return query; } };
    assert.equal(path, 'PERRINNMessages'); build(query); const stream = new Subject(); streams.push(stream); return { snapshotChanges: () => stream };
  } };
  return { service: new FundFeedService(afs, {}), calls, streams, cursors };
}
test('active funds use indexed closing-date queries and one bounded request per explicit action', () => {
  const f = fixture(), feed = f.service.create(undefined, false, 4);
  try {
    feed.loadMore(); feed.loadMore(); assert.equal(f.streams.length, 1); assert.equal(feed.current.loading, true);
    assert.ok(f.calls.some(call => call[1] === 'fund.cancelled' && call[3] === false));
    assert.ok(f.calls.some(call => call[1] === 'fund.closesAt' && call[2] === '>'));
    assert.deepEqual(f.calls.at(-1), ['limit', 5]);
    f.streams[0].next(Array.from({ length: 5 }, (_, i) => item('row-' + i)));
    assert.equal(feed.current.items.length, 4); assert.equal(feed.current.hasMore, true); assert.equal(f.streams.length, 1);
    assert.equal(feed.current.items[0].wallet, undefined);
    feed.loadMore(); assert.equal(f.streams.length, 2); assert.deepEqual(f.cursors, ['row-3']);
    f.streams[1].next([item('row-4')]); assert.equal(feed.current.items.length, 5); assert.equal(feed.current.hasMore, false);
    feed.loadMore(); assert.equal(f.streams.length, 2);
  } finally { feed.destroy(); }
  assert.ok(f.streams.every(stream => !stream.observed));
});
test('profile scope is queried server-side; history includes ended and cancelled funds', () => {
  const f = fixture(), feed = f.service.create('person', true);
  try {
    feed.loadMore(); assert.ok(f.calls.some(call => call[1] === 'recipientList' && call[2] === 'array-contains' && call[3] === 'person'));
    assert.ok(!f.calls.some(call => call[1] === 'fund.cancelled'));
    assert.ok(f.calls.some(call => call[0] === 'orderBy' && call[2] === 'desc')); assert.deepEqual(f.calls.at(-1), ['limit', 51]);
    f.streams[0].next([item('cancelled', { cancelled: true }), item('ended', { closesAt: Date.now() - 1 })]);
    assert.equal(feed.current.items.length, 2);
  } finally { feed.destroy(); }
});
test('expiry removes a fund locally without another query or daily refresh', async () => {
  const f = fixture(), feed = f.service.create();
  try {
    feed.loadMore(); f.streams[0].next([item('expiring', { closesAt: Date.now() + 35 })]);
    assert.equal(feed.current.items.length, 1);
    await new Promise(resolve => setTimeout(resolve, 70));
    assert.equal(feed.current.items.length, 0); assert.equal(f.streams.length, 1);
  } finally { feed.destroy(); }
});
test('sparse/empty pages never scan automatically and permit explicit continuation', () => {
  const f = fixture(), feed = f.service.create(undefined, false, 2);
  try {
    feed.loadMore(); f.streams[0].next([item('ended', { closesAt: Date.now() - 1 }), item('invalid', { amountGBPTarget: 0 }), item('more')]);
    assert.equal(feed.current.items.length, 0); assert.equal(feed.current.hasMore, true); assert.equal(f.streams.length, 1);
    feed.loadMore(); f.streams[1].next([]); assert.equal(feed.current.hasMore, false);
  } finally { feed.destroy(); }
});
test('failed pages retain loaded rows, retry the cursor and release stale pages after earlier changes', () => {
  const f = fixture(), feed = f.service.create(undefined, false, 2);
  try {
    feed.loadMore(); const first = [item('one'), item('two'), item('three')]; f.streams[0].next(first);
    feed.loadMore(); f.streams[1].error(new Error('offline')); assert.equal(feed.current.items.length, 2); assert.equal(feed.current.error, true);
    feed.loadMore(); assert.deepEqual(f.cursors, ['two', 'two']); f.streams[2].next([item('three')]); assert.equal(feed.current.items.length, 3);
    f.streams[0].next([first[0], item('changed'), first[2]]); assert.equal(f.streams[2].observed, false); assert.equal(feed.current.items.length, 2);
  } finally { feed.destroy(); }
});

test('Home owns its fund session and releases its subscriptions on navigation', () => {
  const { HomeComponent }=load('../src/app/home.component.ts',{'@angular/core':{Component:()=>target=>target},'./chat/chat-fund/chatFund':model,'./image-viewer/imageViewer.service':{recordImage:()=>({})}});
  const f=fixture(),home=new HomeComponent({}, {}, {}, {markForCheck(){}}, {}, {}, {}, f.service);
  home.loadFunds();assert.equal(home.loadingFunds,true);f.streams[0].next([item('one')]);
  assert.equal(home.funds.length,1);assert.equal(home.loadingFunds,false);
  home.ngOnDestroy();assert.equal(f.streams[0].observed,false);
});
