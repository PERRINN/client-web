import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
const require = createRequire(import.meta.url);
function load(path, overrides = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, name => overrides[name] || require(name));
  return exports;
}
const funds = load('../src/app/chat/chat-fund/chatFund.ts');
const core = { Injectable: () => target => target, Component: () => target => target, runInInjectionContext: (_, fn) => fn() };
const { HomeFeedService } = load('../src/app/homeFeed.service.ts', { '@angular/core': core, './chat/chat-fund/chatFund': funds });
const record = (id, fund = {}) => ({ payload: { doc: { id, data: () => ({ chain: id, chatSubject: id, fund: { description: id, amountGBPTarget: 1000, amountGBPRaised: 123.4, daysLeft: 10, ...fund }, wallet: { balance: 999 } }) } } });
function fixture(pages) {
  const queries = [];
  const afs = { collection: (path, build) => {
    const calls = []; let page = 0;
    const query = { where: (...args) => { calls.push(['where', ...args]); return query; }, orderBy: (...args) => { calls.push(['orderBy', ...args]); return query; }, limit: value => { calls.push(['limit', value]); return query; }, startAfter: cursor => { calls.push(['startAfter', cursor.id]); page = Number(cursor.id.split('-').at(-1)) + 1; return query; } };
    build(query); queries.push({ path, calls });
    return { snapshotChanges: () => of(pages[page] || []) };
  } };
  return { service: new HomeFeedService(afs, {}), queries };
}
test('Home funds reuses the active-fund index, reads bounded pages and projects only display fields', async () => {
  const f = fixture([[record('fund')]]);
  const rows = await firstValueFrom(f.service.funds());
  assert.deepEqual(f.queries[0], { path: 'PERRINNMessages', calls: [ ['where', 'lastMessage', '==', true], ['where', 'verified', '==', true], ['where', 'fund.active', '==', true], ['orderBy', 'fund.daysLeft', 'asc'], ['limit', 50] ] });
  assert.deepEqual(Object.keys(rows[0]).sort(), ['chain', 'fund', 'id', 'image', 'title']);
  assert.equal(rows[0].fund.amountGBPRaised, 123.4);
  assert.equal(funds.fundAmount(rows[0].fund.amountGBPRaised, { code: 'gbp', perGBP: 1 }), '£123');
});
test('cancelled markers cannot hide valid funds on a later page, and requests stop at enough results', async () => {
  const cancelled = Array.from({ length: 50 }, (_, n) => record(`cancelled-${n}`, { amountGBPTarget: 0.0001, daysLeft: 0.1 }));
  const pages = [cancelled]; pages[50] = Array.from({ length: 12 }, (_, n) => record(`valid-${n}`));
  const f = fixture(pages);
  assert.equal((await firstValueFrom(f.service.funds(5))).length, 5);
  assert.equal(f.queries.length, 2);
  assert.deepEqual(f.queries[1].calls.at(-1), ['startAfter', 'cancelled-49']);
  const enough = fixture([Array.from({ length: 50 }, (_, n) => record(`valid-${n}`))]);
  assert.equal((await firstValueFrom(enough.service.funds(9))).length, 9);
  assert.equal(enough.queries.length, 1);
});
test('Home excludes ended or invalid funds and terminates on an empty final page', async () => {
  const f = fixture([[record('ended', { daysLeft: 0 }), record('invalid', { amountGBPTarget: NaN })]]);
  assert.deepEqual(await firstValueFrom(f.service.funds()), []);
  assert.deepEqual(await firstValueFrom(fixture([]).service.funds()), []);
});
const lastSeen = load('../src/app/lastSeen.ts');
const { HomeComponent } = load('../src/app/home.component.ts', { '@angular/core': core, './chat/chat-fund/chatFund': funds, './lastSeen': lastSeen });
test('Home retains loaded funds on errors, retries, loads more and unsubscribes on leave', () => {
  const responses = [], limits = [], chats = [];
  const feed = { funds: limit => { limits.push(limit); const response = responses.shift(); return response || of([]); } };
  const first = new Subject(); responses.push(first);
  const home = new HomeComponent(feed, {}, {}, { markForCheck() {} }, { navigate: path => chats.push(path) }, {});
  home.loadFunds(); assert.equal(home.loadingFunds, true);
  first.next([{ chain: 'fund' }]); assert.equal(home.funds.length, 1);
  responses.push(throwError(() => Error('offline'))); home.loadFunds(true);
  assert.equal(home.fundError, true); assert.equal(home.funds.length, 1); assert.deepEqual(limits, [5, 9]);
  const retry = new Subject(); responses.push(retry); home.loadFunds();
  assert.equal(home.fundError, false); retry.next([]); assert.deepEqual(home.funds, []);
  home.openChat('fund'); assert.deepEqual(chats, [['/chat', 'fund']]);
  home.ngOnDestroy(); assert.equal(retry.observed, false); assert.equal(first.observed, false);
});
