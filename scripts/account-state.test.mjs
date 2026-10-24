import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { BehaviorSubject, Observable } from 'rxjs';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const core = { Injectable: () => target => target, Component: () => target => target, HostListener: () => () => {},
  isDevMode: () => true, runInInjectionContext: (_, fn) => fn() };
function load(path, imports = {}, globals = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true }
  }).outputText;
  const exports = {};
  runInNewContext(code, { exports, require: name => name === '@angular/core' ? core : imports[name] || require(name), ...globals });
  return exports;
}
function profiles() {
  const active = new Map(), queries = [];
  const afs = { collection: (_, build) => {
    let uid, limit;
    const query = { where: (field, operator, value) => { if (field === 'user') uid = value; return query; },
      orderBy: () => query, limit: value => { limit = value; return query; } };
    build(query); assert.equal(limit, 1); queries.push(uid);
    return { valueChanges: () => new Observable(subscriber => {
      active.set(uid, (active.get(uid) || 0) + 1);
      subscriber.next([{ user: uid, name: uid, emails: { auth: 'historical@example.test' } }]);
      return () => active.set(uid, active.get(uid) - 1);
    }) };
  } };
  return { afs, active, queries };
}

test('Auth refresh updates checkout email without multiplying private profile listeners', () => {
  const { UserInterfaceService } = load('../src/app/userInterface.service.ts', {
    '../environments/environment': { environment: { production: false } },
    '@angular/common': {}, './image-viewer/imageViewer.service': {}
  }, { location: { hostname: 'localhost' }, navigator: {}, window: { navigator: {}, matchMedia: () => ({ matches: false }) }, setInterval: () => {} });
  const user = new BehaviorSubject({ uid: 'alice', email: 'auth@example.test' });
  const { afs, active, queries } = profiles();
  const UI = new UserInterfaceService({ user }, {}, afs, {}, {});
  assert.equal(active.get('alice'), 1);
  user.next({ uid: 'alice', email: 'verified@example.test' }); user.next({ uid: 'alice', email: 'verified@example.test' });
  assert.equal(active.get('alice'), 1); assert.equal(queries.filter(uid => uid === 'alice').length, 1);
  assert.equal(UI.currentUserEmail, 'verified@example.test');
  user.next({ uid: 'bob', email: 'bob@example.test' });
  assert.equal(active.get('alice'), 0); assert.equal(active.get('bob'), 1);
  assert.equal(UI.currentUserLastMessageObj.user, 'bob');
  user.next(null);
  assert.equal(active.get('bob'), 0); assert.equal(UI.currentUserLastMessageObj, null);
  assert.equal(UI.currentUserEmail, null);
});

test('Settings keeps one private profile listener, cancels on account changes and releases on navigation', () => {
  const model = load('../src/app/settings/settingsModel.ts', {}, { URL });
  const { SettingsDataService } = load('../src/app/settings/settingsData.service.ts', {
    '../userAvatar': load('../src/app/userAvatar.ts'), './settingsModel': model, '../imageUpload.service': { imageUploadState: () => ({}) }
  });
  const authState = new BehaviorSubject({ uid: 'alice' }), { afs, active, queries } = profiles();
  const page = new SettingsDataService({ authState }, afs, {}, {}, {}, { run: fn => fn() });
  page.start(); assert.equal(active.get('alice'), 1);
  authState.next({ uid: 'alice' }); assert.equal(queries.length, 1);
  authState.next({ uid: 'bob' }); assert.equal(active.get('alice'), 0); assert.equal(active.get('bob'), 1);
  assert.equal(page.draft.name, 'bob');
  authState.next(null); assert.equal(active.get('bob'), 0); assert.equal(page.draft.name, '');
  authState.next({ uid: 'alice' }); assert.equal(active.get('alice'), 1);
  page.ngOnDestroy(); assert.equal(active.get('alice'), 0); assert.equal(authState.observed, false);
});
