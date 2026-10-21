import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { firstValueFrom, of } from 'rxjs';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const core = { Injectable: () => target => target, Component: () => target => target, runInInjectionContext: (_, fn) => fn() };
function load(path, overrides = {}, globals = {}) {
  const source = read(path);
  const code = path.endsWith('.ts') ? ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true }
  }).outputText : source;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, require: name => overrides[name] || require(name), ...globals });
  return module.exports;
}
const { BuyPrnComponent } = load('../src/app/buy-prn.component.ts', { '@angular/core': core });
const teamModule = load('../src/app/team.service.ts', { '@angular/core': core });
const { TeamService, selectContributors } = teamModule;
const { TeamComponent } = load('../src/app/team.component.ts', { '@angular/core': core, './team.service': teamModule });
const { LoginComponent } = load('../src/app/login.component.ts', { '@angular/core': core });

function funding() {
  const UI = { currentUser: 'person', currentUserLastMessageObj: {}, PERRINNAdminLastMessageObj: { currencyList: { usd: { toCOIN: 2 }, gbp: { toCOIN: 3 } } } };
  return { UI, page: new BuyPrnComponent(null, null, null, null, UI, null, null, null, null) };
}

test('voluntary presets work without membership data and retain currency conversion', () => {
  const { UI, page } = funding();
  page.syncCurrencyAndCredits();
  assert.deepEqual(Array.from(page.creditList), [10, 25, 50, 100, 250]);
  assert.equal(page.amountCharge, 1000);
  assert.equal(page.amountSharesPurchased, 20);
  assert.equal(page.canContribute, true);
  page.creditSelected = 2;
  page.onCurrencySelected('gbp');
  assert.equal(page.amountCharge, 5000);
  assert.equal(page.amountSharesPurchased, 150);
  UI.PERRINNAdminLastMessageObj.membership = { amountRequired: 999999, isMember: false };
  page.syncCurrencyAndCredits();
  assert.equal(page.amountCharge, 5000);
  UI.PERRINNAdminLastMessageObj.currencyList.gbp.toCOIN = 4;
  page.syncCurrencyAndCredits();
  assert.equal(page.amountSharesPurchased, 200);
});

test('signed-out users and unavailable rates cannot start checkout', async () => {
  const { UI, page } = funding();
  page.syncCurrencyAndCredits();
  UI.currentUser = null;
  assert.equal(page.canContribute, false);
  await page.payWithRevolutLink(); // Would access window.open if the guard failed.
  UI.currentUser = 'person';
  for (const rate of [undefined, 0, -1, NaN, Infinity]) {
    UI.PERRINNAdminLastMessageObj.currencyList.usd.toCOIN = rate;
    page.refreshAmountCharge();
    assert.equal(page.canContribute, false);
    assert.equal(page.amountCharge, 0);
    await page.payWithRevolutLink();
  }
});

test('team excludes zero, negative and absent balances and searches positive-balance contributors', async () => {
  const records = [
    { name: 'Alex', nameLowerCase: 'alex', wallet: { balance: 0 } },
    { name: 'Blair', nameLowerCase: 'blair' },
    { name: 'Casey', nameLowerCase: 'casey', wallet: { balance: 100000 } },
    { name: 'Drew', wallet: { balance: -1 } },
    { name: 'Eli', wallet: { balance: 0.00001 } }
  ].map(data => ({ ...data, verified: true, userChain: { nextMessage: 'none' } }));
  const fields = (data, path) => path.split('.').reduce((obj, key) => obj?.[key], data);
  const afs = { collection: (_, build) => {
    let rows = records;
    let limit;
    const query = {
      where: (field, op, value) => { rows = rows.filter(row => op === '==' ? fields(row, field) === value : fields(row, field) > value); return query; },
      orderBy: (field, direction) => { rows = rows.filter(row => fields(row, field) !== undefined).sort((a, b) => (fields(a, field) - fields(b, field)) * (direction === 'desc' ? -1 : 1)); return query; },
      limit: value => { limit = value; return query; }
    };
    build(query);
    assert.equal(limit, 200);
    return { get: () => of({ size: rows.length, docs: rows.slice(0, limit).map((row, id) => ({ id, data: () => row })) }) };
  } };
  const team = new TeamService(afs, null);
  await team.loadMore();
  const page = new TeamComponent({}, team);
  page.ngOnInit();
  assert.deepEqual(Array.from(await firstValueFrom(page.filteredMessages), row => row.values.name), ['Casey', 'Eli']);
  page.searchQuery = 'ELI'; page.onSearchChange();
  assert.equal((await firstValueFrom(page.filteredMessages))[0].values.name, 'Eli');
  page.clearSearch();
  assert.equal((await firstValueFrom(page.filteredMessages)).length, 2);
  const indexes = JSON.parse(read('../firestore.indexes.json')).indexes;
  assert.ok(indexes.some(index => ['userChain.nextMessage', 'verified', 'wallet.balance'].every((field, i) => index.fields[i]?.fieldPath === field)));
});

test('registration creates a profile directly without a purchase or membership field', async () => {
  const writes = [], routes = [];
  const afAuth = { user: of(null), authState: of({ uid: 'new-person' }), createUserWithEmailAndPassword: async () => {} };
  const page = new LoginComponent(afAuth, {}, { navigateByUrl: url => routes.push(url) }, { snapshot: { queryParams: {} } }, { createMessage: message => writes.push(message) });
  page.register('person@example.test', 'test-password', 'test-password', 'Alex');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].chain, 'new-person');
  assert.equal(writes[0].creatingUser, true);
  assert.equal(writes[0].name, 'Alex');
  assert.equal(writes[0].membership, undefined);
  assert.equal(writes[0].purchaseCOIN, undefined);
  assert.equal(routes.length, 0);
});

test('verification preserves accounting with legacy membership ignored', async () => {
  const now = 1800000000000;
  const updates = [];
  const previous = { user: 'person', name: 'Alex', emails: { auth: 'person@example.test' }, verifiedTimestamp: { seconds: now / 1000 - 86400 }, wallet: { balance: 100 }, membership: { isMember: false, amountRequired: 1e9 } };
  const adminData = { interest: { rateYear: 0.1 }, membership: { amountRequired: 1e9 } };
  const doc = (id, data) => ({ id, data: () => data });
  const snapshot = docs => ({ docs, forEach: fn => docs.forEach(fn) });
  const firestore = {
    batch: () => ({ update: (path, fields) => updates.push({ path, fields }), commit: async () => {} }),
    doc: path => path,
    collection: () => {
      const conditions = [];
      const query = {
        where: (...args) => { conditions.push(args); return query; }, orderBy: () => query, limit: () => query,
        get: async () => {
          const user = conditions.find(([field]) => field === 'user')?.[2];
          return snapshot(user === 'FHk0zgOQUja7rsB9jxDISXzHaro2' ? [doc('admin', adminData)] : user === 'person' ? [doc('previous', previous)] : []);
        }
      };
      return query;
    }
  };
  const admin = { firestore: Object.assign(() => firestore, { FieldValue: { arrayUnion: value => [value], serverTimestamp: () => 'server-time' } }) };
  const backend = load('../functions/utils/verifyMessage.js', {
    'firebase-admin': admin, 'firebase-admin/firestore': { getFirestore: () => firestore }, './createMessage': {}
  }, { Date: class extends Date { static now() { return now; } }, console: { log: message => assert.fail(message) } });
  const result = await backend.verifyMessage('new', { user: 'person', chain: 'person', name: 'Alex', serverTimestamp: { seconds: now / 1000 }, text: 'Contributed', purchaseCOIN: { amount: 20 } });
  assert.equal(result.wallet.balance, Math.round(120 * Math.exp(0.1 / 365) * 100000) / 100000);
  assert.equal(result.purchaseCOIN.amount, 20);
  assert.equal(result.contract.amount, 0);
  assert.equal(result.membership, undefined);
  assert.ok(updates.some(({ fields }) => fields.verified === true));
  assert.ok(!updates.some(({ fields }) => 'membership' in fields));
});

// A rendering guard for the cross-screen removal: historical ledger text is intentionally retained.
test('active UI has no membership status, threshold controls or funding gate', () => {
  for (const path of ['app.component.html', 'profile.component.html', 'settings.component.html', 'buy-prn.component.html', 'team.component.html']) {
    assert.doesNotMatch(read(`../src/app/${path}`), /isCurrentUserMember|membership\?|membersCount|participation threshold|nonMember/i, path);
  }
});

for (const pageCount of [1, 3]) for (const costText of ['Cloud cost unavailable.', 'Cloud cost: £2.35 on 2026-10-18 UTC · provisional, after credits.']) test(`daily refresh reads ${pageCount} Authentication page(s) and retains accounting with ${costText}`, async () => {
  const calls = [], queries = [], verified = [], messages = [], errors = [];
  const admin = {
    initializeApp: () => {},
    auth: () => ({ listUsers: async (size, token) => {
      calls.push({ size, token });
      const index = token ? Number(token) : 0;
      return { users: [{ uid: `person-${index}` }], ...(index + 1 < pageCount ? { pageToken: String(index + 1) } : {}) };
    } }),
    firestore: Object.assign(() => ({ collection: () => {
      let user;
      const query = {
        where: (field, op, value) => { queries.push(field); if (field === 'user') user = value; return query; },
        orderBy: () => query, limit: () => query,
        get: async () => ({ docs: [{ id: user, data: () => ({ user }) }] })
      };
      return query;
    } }), { FieldValue: { serverTimestamp: () => 'server-time' } })
  };
  const backend = load('../functions/scheduledDailyMembership.f.js', {
    'firebase-admin': admin,
    'firebase-functions/v2/scheduler': { onSchedule: (_, handler) => handler },
    'firebase-functions/params': { defineString: () => ({ value: () => '' }) },
    './utils/billingCosts': { dailyCloudCostText: async () => costText },
    './utils/verifyMessage': { verifyMessage: async (id, data) => { verified.push(id); return { user: data.user, wallet: { balance: 10 }, membership: { isMember: true } }; } },
    './utils/createMessage': { createMessageAFS: async message => messages.push(message) }
  }, { console: { log: () => {}, error: (...args) => errors.push(args) } });
  await backend.scheduledDailyMembership({});
  assert.equal(errors.length, 0);
  assert.equal(calls.length, pageCount);
  assert.ok(calls.every(call => call.size === 1000));
  assert.equal(verified.length, pageCount);
  assert.equal(queries.length, pageCount); // No extra admin threshold lookup.
  assert.equal(messages.length, 1);
  assert.equal(messages[0].chain, 'Daily-updates');
  assert.equal(messages[0].statistics.userCount, pageCount);
  assert.equal(messages[0].statistics.wallet.balance, pageCount * 10);
  assert.equal(messages[0].statistics.membersCount, undefined);
  assert.equal(messages[0].text, `${pageCount} people. ${pageCount * 10} total PRN balance.\n${costText}`);
  assert.doesNotMatch(messages[0].text, /member|threshold|invested/i);
});

test('team pages beyond 200 with a cursor and retries failures without losing loaded people', async () => {
  const records = Array.from({ length: 201 }, (_, index) => ({ id: String(index), data: () => ({ user: `person-${index}`, name: `Person ${index}`, wallet: { balance: 201 - index } }) }));
  const cursors = [];
  let fail = false;
  const afs = { collection: (_, build) => {
    let offset = 0, limit;
    const query = {
      where: () => query, orderBy: () => query,
      startAfter: cursor => { cursors.push(cursor.id); offset = Number(cursor.id) + 1; return query; },
      limit: value => { limit = value; return query; }
    };
    build(query);
    return { get: () => {
      if (fail) throw new Error('Unavailable');
      const docs = records.slice(offset, offset + limit);
      return of({ docs, size: docs.length });
    } };
  } };
  const team = new TeamService(afs, null);
  await team.loadMore();
  assert.equal((await firstValueFrom(team.people$)).length, 200);
  assert.equal(team.hasMore, true);
  fail = true;
  await team.loadMore();
  assert.equal(team.error, true);
  assert.equal(team.loading, false);
  assert.equal((await firstValueFrom(team.people$)).length, 200);
  fail = false;
  await team.loadMore();
  assert.equal(team.error, false);
  assert.equal(team.hasMore, false);
  assert.equal((await firstValueFrom(team.people$)).length, 201);
  assert.deepEqual(cursors, ['199', '199']);
  assert.deepEqual(Array.from(await firstValueFrom(team.people$), person => person.key), records.map(doc => doc.id));
});

test('team shows loading immediately, prevents concurrent reads and stops after an empty final page', async () => {
  const { Subject } = require('rxjs');
  const pending = new Subject();
  const docs = Array.from({ length: 200 }, (_, id) => ({ id: String(id), data: () => ({ user: String(id), wallet: { balance: 1 } }) }));
  let reads = 0;
  const afs = { collection: (_, build) => {
    const query = {
      where: () => query, orderBy: () => query,
      startAfter: cursor => { assert.equal(cursor, docs[199]); return query; },
      limit: value => { assert.equal(value, 200); return query; }
    };
    build(query);
    return { get: () => ++reads === 1 ? pending : of({ docs: [], size: 0 }) };
  } };
  const team = new TeamService(afs, null);
  const firstPage = team.loadMore();
  assert.equal(team.loading, true);
  assert.equal((await firstValueFrom(team.people$)).length, 0);
  await team.loadMore();
  assert.equal(reads, 1);
  pending.next({ docs, size: docs.length });
  await firstPage;
  assert.equal(team.loading, false);
  assert.equal(team.hasMore, true);
  await team.loadMore();
  assert.equal(team.hasMore, false);
  assert.equal((await firstValueFrom(team.people$)).length, 200);
  await team.loadMore();
  assert.equal(reads, 2);
});

test('team search matches names and bios, trims whitespace, and handles absent profile data', () => {
  const people = [
    { key: 'z', values: { user: 'z', name: 'Zoe', userPresentation: 'Battery engineer', wallet: { balance: 20 } } },
    { key: 'a', values: { user: 'a', name: 'Alex', userPresentation: 'Designer', wallet: { balance: 10 } } },
    { key: 'empty', values: { user: 'empty' } }
  ];
  assert.deepEqual(Array.from(selectContributors(people, '  BATTERY '), p => p.key), ['z']);
  assert.deepEqual(Array.from(selectContributors(people, 'aLeX'), p => p.key), ['a']);
  assert.equal(selectContributors(people, 'not found').length, 0);
  assert.equal(selectContributors(people, '   ').length, 3);
  assert.deepEqual(people.map(p => p.key), ['z', 'a', 'empty']);
});

test('team search preserves page ordering and does not fetch more data', async () => {
  const people = [
    { key: 'b', values: { user: 'b', name: 'Blair', wallet: { balance: 20 } } },
    { key: 'a', values: { user: 'a', name: 'Alex', wallet: { balance: 20 } } },
    { key: 'z', values: { user: 'z', name: 'Zoe', wallet: { balance: 10 } } }
  ];
  const { BehaviorSubject } = require('rxjs');
  const pages = new BehaviorSubject(people);
  let reads = 0;
  const page = new TeamComponent({}, { people$: pages.asObservable(), loadMore: () => reads++ });
  page.ngOnInit();
  const keys = async () => Array.from(await firstValueFrom(page.filteredMessages), person => person.key);
  assert.deepEqual(await keys(), ['b', 'a', 'z']);
  page.searchQuery = 'a'; page.onSearchChange();
  assert.deepEqual(await keys(), ['b', 'a']);
  page.clearSearch();
  pages.next([...people, { key: 'c', values: { user: 'c', name: 'Casey', wallet: { balance: 5 } } }]);
  assert.deepEqual(await keys(), ['b', 'a', 'z', 'c']);
  assert.equal(reads, 1);
  assert.deepEqual(people.map(person => person.key), ['b', 'a', 'z']);
});
