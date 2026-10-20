import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Subject, combineLatest, merge, of, timer, fromEvent } from 'rxjs';
import * as operators from 'rxjs/operators';
import { Observable } from 'rxjs';
import { data, load } from './load.mjs';
const { GreenpowerLiveService, isGreenpowerLive, GREENPOWER_LIVE_TIMEOUT } = load('../../src/app/greenpower-telemetry/greenpowerLive.service.ts', {
  '@angular/core': { Injectable: () => target => target, runInInjectionContext: (_, callback) => callback() },
  rxjs: { Observable, combineLatest, merge, of, timer, fromEvent },
  'rxjs/operators': operators, './greenpowerData': data
});

test('only recent live phone receipts count, excluding imported, future, invalid and expired samples', () => {
  const now = Date.now(), sample = { source: '424-phone', receivedAt: now };
  assert.equal(isGreenpowerLive(sample, now), true);
  assert.equal(isGreenpowerLive({ ...sample, receivedAt: now - GREENPOWER_LIVE_TIMEOUT + 1 }, now), true);
  for (const candidate of [undefined, { ...sample, receivedAt: now - GREENPOWER_LIVE_TIMEOUT },
    { ...sample, receivedAt: now + 1 }, { ...sample, receivedAt: NaN }, { ...sample, source: 'echook-history' }]) {
    assert.equal(isGreenpowerLive(candidate, now), false);
  }
});

test('shared status fails closed and releases listeners across account changes, midnight and destruction', async () => {
  const originals = { document: globalThis.document, window: globalThis.window, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), now: Date.now };
  const authState = new Subject(), listeners = [], values = [];
  let now = Date.parse('2026-07-01T22:59:59Z');
  globalThis.document = new EventTarget(); globalThis.window = new EventTarget();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  Date.now = () => now;
  const service = new GreenpowerLiveService({ authState }, { firestore: { doc(path) {
    return { onSnapshot(options, next, error) {
      const listener = { path, next, error, active: true }; listeners.push(listener);
      return () => { listener.active = false; };
    } };
  } } }, {});
  const first = service.live$.subscribe(v => values.push(v));
  const second = service.live$.subscribe();
  const settle = () => new Promise(resolve => setTimeout(resolve, 10));
  const send = (listener, sample, metadata = { fromCache: false, hasPendingWrites: false }) => listener.next({ metadata, data: () => ({ latest: sample }) });
  try {
    authState.next(null); await settle(); assert.equal(listeners.length, 0); assert.equal(values.at(-1), false);
    authState.next({ uid: 'one' }); await settle(); assert.equal(listeners.length, 1);
    const sample = { source: '424-phone', receivedAt: now };
    send(listeners[0], sample, { fromCache: true }); assert.equal(values.at(-1), false);
    send(listeners[0], sample); assert.equal(values.at(-1), true);
    const transitions = values.length;
    for (let update = 0; update < 4; update++) {
      // Receipts arrive between local clock ticks, as real three-second feeds do.
      now += 100;
      send(listeners[0], { ...sample, receivedAt: now });
      assert.equal(values.at(-1), true, 'a fresh server receipt must stay live between ticks');
    }
    assert.equal(values.length, transitions, 'fresh receipts must not toggle live status');
    send(listeners[0], sample, { hasPendingWrites: true }); assert.equal(values.at(-1), false);
    send(listeners[0], sample);
    navigator.onLine = false; window.dispatchEvent(new Event('offline')); assert.equal(values.at(-1), false);
    navigator.onLine = true; window.dispatchEvent(new Event('online')); assert.equal(values.at(-1), true);
    now += GREENPOWER_LIVE_TIMEOUT; document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(values.at(-1), false); assert.equal(listeners[0].active, false);
    assert.match(listeners.at(-1).path, /2026-07-02\/live\/latest$/);
    send(listeners.at(-1), { ...sample, receivedAt: now }); assert.equal(values.at(-1), true);
    authState.next({ uid: 'two' }); await settle(); assert.equal(values.at(-1), false);
    const current = listeners.at(-1); current.error(new Error('unavailable')); assert.equal(values.at(-1), false);
    const count = listeners.length; window.dispatchEvent(new Event('online')); await settle(); assert.equal(listeners.length, count, 'no custom retry loop');
    authState.next(null); assert.ok(listeners.every(l => !l.active));
    authState.next({ uid: 'three' }); await settle();
    first.unsubscribe(); assert.equal(listeners.at(-1).active, true);
    second.unsubscribe(); assert.ok(listeners.every(l => !l.active));
  } finally {
    first.unsubscribe(); second.unsubscribe(); Date.now = originals.now;
    globalThis.document = originals.document; globalThis.window = originals.window;
    if (originals.navigator) Object.defineProperty(globalThis, 'navigator', originals.navigator);
    else delete globalThis.navigator;
  }
});
