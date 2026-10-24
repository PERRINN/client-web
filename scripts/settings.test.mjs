import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { BehaviorSubject } from 'rxjs';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const core = { Injectable: () => target => target, runInInjectionContext: (_, fn) => fn() };
function load(path, overrides = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, name => overrides[name] || require(name));
  return exports;
}
const model = load('../src/app/settings/settingsModel.ts');
const { SettingsDataService } = load('../src/app/settings/settingsData.service.ts', { '@angular/core': core, '../userAvatar': load('../src/app/userAvatar.ts'), './settingsModel': model, '../imageUpload.service': { imageUploadState: () => ({ busy: false }) } });
function setup(createMessage = async () => {}) {
  const record = { name: 'Alex', userPresentation: 'Engineering', publicLink: 'https://example.test', userCurrency: 'usd', contract: { level: 3 } };
  const rows = new BehaviorSubject([record]), authState = new BehaviorSubject({ uid: 'owner' }), writes = [];
  const auth = { authState, get currentUser() { return Promise.resolve(authState.value); } };
  const UI = { currentUser: 'owner', currentUserLastMessageObj: record, PERRINNAdminLastMessageObj: { currencyList: { usd: { designation: 'US Dollar' }, gbp: { designation: 'British Pound' } } }, async createMessage(message) { writes.push(message); await createMessage(message); } };
  const service = new SettingsDataService(auth, { collection: () => ({ valueChanges: () => rows }) }, {}, UI, {}, { run: fn => fn() });
  service.start();
  return { service, rows, authState, UI, record, writes };
}
test('profile form batches only changed, trimmed fields; Cancel and incoming records preserve drafts', async () => {
  const { service: s, rows, record, writes } = setup();
  s.edit('name', ' Sam '); s.edit('publicLink', 'https://perrinn.test');
  rows.next([{ ...record, userPresentation: 'Updated remotely' }]);
  assert.equal(s.draft.name, ' Sam '); assert.equal(s.draft.userPresentation, 'Updated remotely');
  await s.saveProfile();
  assert.deepEqual(writes, [{ chain: 'owner', text: 'Updating my profile.', name: 'Sam', publicLink: 'https://perrinn.test' }]);
  assert.equal(s.dirty, false); assert.equal(s.saved, true);
  s.edit('name', 'Other'); s.cancel(); assert.equal(s.draft.name, 'Sam'); assert.equal(s.dirty, false);
  s.ngOnDestroy(); assert.equal(rows.observed, false);
});
test('invalid or unsupported clearing never writes; failed saves retain the editable draft', async () => {
  const { service: s, writes } = setup(async () => { throw Error('offline'); });
  s.edit('name', ''); s.edit('publicLink', 'javascript:alert(1)'); s.edit('userPresentation', '');
  await s.saveProfile(); assert.equal(writes.length, 0); assert.equal(Object.keys(s.errors).length, 3);
  s.cancel(); s.edit('name', 'Sam'); await s.saveProfile();
  assert.equal(s.draft.name, 'Sam'); assert.equal(s.dirty, true); assert.equal(s.saving, false); assert.match(s.saveError, /couldn’t save/);
});
test('immediate preferences and contract preserve message contracts and roll back failures', async () => {
  let fail = false;
  const { service: s, writes } = setup(async () => { if (fail) throw Error('offline'); });
  await s.setCurrency('bad'); assert.equal(writes.length, 0);
  await s.setCurrency('gbp'); assert.equal(s.currency, 'gbp'); assert.equal(writes[0].userCurrency, 'gbp');
  fail = true; await s.setCurrency('usd'); assert.equal(s.currency, 'gbp'); assert.match(s.currencyError, /couldn’t save/);
  fail = false; s.editContract('11'); await s.saveContract(); assert.equal(writes.length, 2);
  s.editContract('7'); await s.saveContract(); assert.deepEqual(writes[2].contract, { level: 7 }); assert.equal(s.contractChanged, false);
});
test('concurrent commands, simulator writes and stale account completions are blocked', async () => {
  let finish;
  const { service: s, UI, writes, authState } = setup(() => new Promise(resolve => finish = resolve));
  UI.currentUser = null; s.edit('name', 'Sam'); await s.saveProfile(); assert.equal(writes.length, 0);
  UI.currentUser = 'owner'; const saving = s.saveProfile(); await Promise.resolve();
  await s.setCurrency('gbp'); assert.equal(writes.length, 1);
  UI.currentUser = 'other'; authState.next({ uid: 'other' }); finish(); await saving;
  assert.equal(s.saved, false); assert.equal(s.draft.name, 'Alex'); assert.equal(UI.currentUserLastMessageObj.name, 'Alex');
  s.ngOnDestroy();
});
test('retry recovers a failed latest-record listener without multiplying subscriptions', () => {
  const { service: s, rows } = setup();
  rows.error(Error('offline')); assert.equal(s.unavailable, true); assert.equal(s.loading, false);
  const recovery = new BehaviorSubject([{ name: 'Recovered' }]);
  s.afs = { collection: () => ({ valueChanges: () => recovery }) };
  s.retry(); assert.equal(s.unavailable, false); assert.equal(s.draft.name, 'Recovered');
  s.ngOnDestroy(); assert.equal(recovery.observed, false);
});
