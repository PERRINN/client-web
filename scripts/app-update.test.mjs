import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import '@angular/compiler';
import * as routerModule from '@angular/router';
import { Subject } from 'rxjs';

const require = createRequire(import.meta.url), exports = {};
const source = ts.transpileModule(readFileSync(new URL('../src/app/appUpdate.service.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true }
}).outputText;
new Function('exports', 'require', source)(exports, name => name === '@angular/core'
  ? { Injectable: () => value => value } : name === '@angular/router' ? routerModule : require(name));
const { AppUpdateService } = exports;
const { NavigationStart, NavigationEnd, NavigationCancel, NavigationError, DefaultUrlSerializer } = routerModule;
const dashboard = '/424-greenpower-dashboard';
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function fixture(t, { url = '/home', navigated = true, enabled = true, check } = {}) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let reloads = 0, checks = 0, timers = 0;
  const document = Object.assign(new EventTarget(), { hidden: false, location: { reload: () => reloads++ } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  const setInterval = globalThis.setInterval;
  t.mock.method(globalThis, 'setInterval', (...args) => { timers++; return setInterval(...args); });
  const events = new Subject(), versions = new Subject();
  const router = { url, navigated, events, parseUrl: value => new DefaultUrlSerializer().parse(value) };
  const updates = { isEnabled: enabled, versionUpdates: versions,
    checkForUpdate: () => { checks++; return check ? check() : Promise.resolve(false); },
    activateUpdate: () => assert.fail('Must not activate an update in the running app') };
  const service = new AppUpdateService(updates, router);
  service.start();
  t.after(() => {
    service.ngOnDestroy();
    if (original) Object.defineProperty(globalThis, 'document', original);
    else delete globalThis.document;
  });
  return { service, router, document, events, versions,
    get reloads() { return reloads; }, get checks() { return checks; }, get timers() { return timers; },
    ready: () => versions.next({ type: 'VERSION_READY' }),
    start: url => events.next(new NavigationStart(1, url)),
    end: url => { router.url = url; router.navigated = true; events.next(new NavigationEnd(1, url, url)); }
  };
}

for (const url of [dashboard, `${dashboard}/`, `${dashboard}?view=car#speed`, `${dashboard};mode=race`]) {
  test(`defers updates on ${url} and reloads once after leaving`, t => {
    const f = fixture(t, { url });
    f.ready(); f.ready();
    assert.equal(f.reloads, 0);
    f.start('/apps'); assert.equal(f.reloads, 0);
    f.end('/apps'); assert.equal(f.reloads, 1);
    f.ready(); f.end('/home'); assert.equal(f.reloads, 1);
  });
}

test('other pages retain immediate automatic reload', t => {
  const f = fixture(t, { url: '/424-greenpower-telemetry' });
  f.versions.next({ type: 'VERSION_DETECTED' }); assert.equal(f.reloads, 0);
  f.ready(); assert.equal(f.reloads, 1);
});

test('an update during initial navigation waits through the legacy dashboard redirect', t => {
  const f = fixture(t, { url: '/', navigated: false });
  f.ready(); assert.equal(f.reloads, 0);
  f.start('/prototypes/echook-connection');
  f.events.next(new NavigationCancel(1, '/prototypes/echook-connection', 'Redirect'));
  assert.equal(f.reloads, 0);
  f.start(dashboard); f.end(dashboard); assert.equal(f.reloads, 0);
});

test('navigation into dashboard blocks an update before the URL has changed', t => {
  const f = fixture(t);
  f.start(dashboard); f.ready(); assert.equal(f.reloads, 0);
  f.end(dashboard); assert.equal(f.reloads, 0);
});

for (const event of [new NavigationCancel(1, '/apps', 'Guard'), new NavigationError(1, '/apps', new Error('Failed'))]) {
  test(`failed departure keeps the dashboard protected (${event.constructor.name})`, t => {
    const f = fixture(t, { url: dashboard });
    f.start('/apps'); f.ready(); f.events.next(event); f.ready();
    assert.equal(f.reloads, 0);
    f.start('/home'); f.end('/home'); assert.equal(f.reloads, 1);
  });
}

test('checks continue on the dashboard with no overlapping requests and clean up on destroy', async t => {
  let resolve;
  const f = fixture(t, { url: dashboard, check: () => new Promise(done => { resolve = done; }) });
  f.service.start(); assert.equal(f.timers, 1);
  f.document.dispatchEvent(new Event('visibilitychange'));
  f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.checks, 1);
  resolve(false); await flush();
  f.document.dispatchEvent(new Event('visibilitychange')); assert.equal(f.checks, 2);
  resolve(false); await flush();
  f.service.ngOnDestroy();
  f.document.dispatchEvent(new Event('visibilitychange')); f.ready(); f.end('/home');
  assert.equal(f.checks, 2); assert.equal(f.reloads, 0);
  assert.equal(f.events.observed, false); assert.equal(f.versions.observed, false);
});

test('failed checks recover and hidden visibility events do not check', async t => {
  const f = fixture(t, { check: () => Promise.reject(new Error('Offline')) });
  f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.checks, 0);
  f.document.hidden = false; f.document.dispatchEvent(new Event('visibilitychange')); await flush();
  f.document.dispatchEvent(new Event('visibilitychange')); await flush();
  assert.equal(f.checks, 2);
});

test('disabled service workers create no subscriptions or timers', t => {
  const f = fixture(t, { enabled: false });
  f.ready(); f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.reloads, 0); assert.equal(f.checks, 0); assert.equal(f.timers, 0);
  assert.equal(f.events.observed, false); assert.equal(f.versions.observed, false);
});
