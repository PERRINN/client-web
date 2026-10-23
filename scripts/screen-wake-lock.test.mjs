import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url), exports = {};
const source = ts.transpileModule(readFileSync(new URL('../src/app/screenWakeLock.service.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true }
}).outputText;
new Function('exports', 'require', source)(exports, name => name === '@angular/core'
  ? { Injectable: () => value => value } : require(name));
const { ScreenWakeLockService } = exports;
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
class Sentinel extends EventTarget {
  released = false;
  releases = 0;
  async release() { this.releases++; this.released = true; this.dispatchEvent(new Event('release')); }
}
function fixture(t, { mode = 'browser', hidden = false, secure = true, supported = true, request } = {}) {
  const originals = Object.fromEntries(['window', 'document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const window = Object.assign(new EventTarget(), { isSecureContext: secure,
    matchMedia: query => ({ matches: query === `(display-mode: ${mode})` }) });
  const document = Object.assign(new EventTarget(), { hidden });
  const calls = [], locks = [], states = [];
  const navigator = { standalone: mode === 'ios', ...(supported ? { wakeLock: { request: type => {
    calls.push(type);
    if (request) return request();
    const lock = new Sentinel(); locks.push(lock); return Promise.resolve(lock);
  } } } : {}) };
  for (const [key, value] of Object.entries({ window, document, navigator }))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  const service = new ScreenWakeLockService(); service.state$.subscribe(state => states.push(state));
  t.after(() => {
    service.ngOnDestroy();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return { service, window, document, calls, locks, states,
    visible(value) { document.hidden = !value; document.dispatchEvent(new Event('visibilitychange')); } };
}

test('browser tabs opt in; toggling off releases the lock and keeps it off on return', async t => {
  const f = fixture(t); f.service.start(); await flush();
  assert.equal(f.service.enabled, false); assert.equal(f.calls.length, 0); assert.equal(f.states.at(-1), 'off');
  f.service.toggle(); assert.equal(f.states.at(-1), 'requesting'); await flush();
  assert.deepEqual(f.calls, ['screen']); assert.equal(f.states.at(-1), 'active');
  f.service.toggle(); await flush();
  assert.equal(f.locks[0].releases, 1); assert.equal(f.states.at(-1), 'off');
  f.visible(false); f.visible(true); f.window.dispatchEvent(new Event('pageshow')); await flush();
  assert.equal(f.calls.length, 1);
});

for (const mode of ['standalone', 'fullscreen', 'ios']) {
  test(`${mode} app starts automatically and repeated starts/events cannot duplicate locks`, async t => {
    const f = fixture(t, { mode }); f.service.start(); f.service.start(); await flush();
    f.visible(true); f.window.dispatchEvent(new Event('pageshow')); await flush();
    assert.equal(f.service.enabled, true); assert.equal(f.states.at(-1), 'active');
    assert.deepEqual(f.calls, ['screen'], 'Installed apps must request the screen lock that covers idle dimming and locking');
  });
}

test('hidden startup waits; returning reacquires and pagehide releases even before visibility updates', async t => {
  const f = fixture(t, { mode: 'standalone', hidden: true }); f.service.start(); await flush();
  assert.equal(f.calls.length, 0); assert.equal(f.states.at(-1), 'paused');
  f.visible(true); await flush(); assert.equal(f.calls.length, 1);
  f.visible(false); await flush(); assert.equal(f.locks[0].releases, 1);
  f.visible(true); await flush(); assert.equal(f.calls.length, 2);
  f.window.dispatchEvent(new Event('pagehide')); await flush(); assert.equal(f.locks[1].releases, 1);
  f.window.dispatchEvent(new Event('pageshow')); await flush(); assert.equal(f.calls.length, 3);
});

test('pending requests are serialized and stale grants are released before restoring current intent', async t => {
  const pending = [];
  const f = fixture(t, { mode: 'standalone', request: () => new Promise(resolve => pending.push(resolve)) });
  f.service.start(); f.visible(false); f.visible(true);
  f.window.dispatchEvent(new Event('pageshow')); assert.equal(f.calls.length, 1);
  const stale = new Sentinel(); pending.shift()(stale); await flush();
  assert.equal(stale.releases, 1); assert.equal(f.calls.length, 2);
  const current = new Sentinel(); pending.shift()(current); await flush();
  assert.equal(current.releases, 0); assert.equal(f.states.at(-1), 'active');
  f.service.toggle(); assert.equal(current.releases, 1);
});

test('turning off while acquiring releases a late grant without reactivating', async t => {
  let grant;
  const f = fixture(t, { mode: 'standalone', request: () => new Promise(resolve => { grant = resolve; }) });
  f.service.start(); f.service.toggle();
  const lock = new Sentinel(); grant(lock); await flush();
  assert.equal(lock.releases, 1); assert.equal(f.calls.length, 1); assert.equal(f.states.at(-1), 'off');
});

test('denied requests and system releases show inactive state without polling or retry loops', async t => {
  let deny = true;
  const lock = new Sentinel();
  const f = fixture(t, { mode: 'standalone', request: () => deny
    ? Promise.reject(new DOMException('Power saving', 'NotAllowedError')) : Promise.resolve(lock) });
  f.service.start(); await flush();
  assert.equal(f.states.at(-1), 'blocked'); assert.equal(f.calls.length, 1);
  await flush(); assert.equal(f.calls.length, 1);
  deny = false; f.service.toggle(); f.service.toggle(); await flush();
  assert.equal(f.states.at(-1), 'active');
  await lock.release(); await flush();
  assert.equal(f.states.at(-1), 'blocked'); assert.equal(f.calls.length, 2);
});

test('synchronous API failures and already-released grants remain recoverable', async t => {
  let fail = true;
  const lock = new Sentinel(); lock.released = true;
  const f = fixture(t, { mode: 'standalone', request: () => { if (fail) throw Error('Denied'); return Promise.resolve(lock); } });
  f.service.start(); await flush(); assert.equal(f.states.at(-1), 'blocked');
  fail = false; f.service.toggle(); f.service.toggle(); await flush();
  assert.equal(f.calls.length, 2); assert.equal(f.states.at(-1), 'blocked');
});

for (const settings of [{ supported: false }, { secure: false }]) {
  test(`unsupported/insecure contexts never request a lock: ${JSON.stringify(settings)}`, async t => {
    const f = fixture(t, { mode: 'standalone', ...settings }); f.service.start(); f.service.toggle(); await flush();
    assert.equal(f.service.supported, false); assert.equal(f.service.enabled, false);
    assert.equal(f.states.at(-1), 'unsupported'); assert.equal(f.calls.length, 0);
  });
}

test('destroy removes lifecycle listeners and releases both active and late-granted locks', async t => {
  let grant;
  const f = fixture(t, { mode: 'standalone', request: () => new Promise(resolve => { grant = resolve; }) });
  f.service.start(); f.service.ngOnDestroy();
  const lock = new Sentinel(); grant(lock); await flush();
  assert.equal(lock.releases, 1);
  f.visible(false); f.visible(true); f.window.dispatchEvent(new Event('pageshow'));
  await flush(); assert.equal(f.calls.length, 1);
});

test('destroy releases an active lock and lifecycle events cannot reacquire it', async t => {
  const f = fixture(t, { mode: 'standalone' }); f.service.start(); await flush();
  f.service.ngOnDestroy();
  assert.equal(f.locks[0].releases, 1);
  f.visible(true); f.window.dispatchEvent(new Event('pageshow')); await flush();
  assert.equal(f.calls.length, 1);
});
