import assert from 'node:assert/strict';
import test from 'node:test';
import { BehaviorSubject, Subject } from 'rxjs';
import { load, dayData } from './load.mjs';
const { GreenpowerEventContextService } = load('../../src/app/greenpower-telemetry/greenpowerEventContext.service.ts', {
  '@angular/core': { Injectable: () => target => target }, rxjs: { Subject }, './greenpowerDay': dayData,
  'firebase/compat/app': { default: { firestore: { FieldPath: { documentId: () => '__name__' } } } }, 'firebase/compat/firestore': {}
});
const date = '2026-10-22', root = dayData.SESSION_SCOPE + '/days/';
const event = { ...dayData.emptyDay(date), sessionTypeCounts: {} };
function session(index) {
  const at = Date.parse(date + 'T08:00:00Z') + index * 1000;
  return { id: 's' + String(index).padStart(3, '0'), type: index % 2 ? 'practice' : 'race', startAt: at, endAt: null, batteryIds: [], overrides: {},
    ranges: [{ day: date, source: '424-phone', firstChunk: '0000000000', lastChunk: '0000000000', firstIndex: 0, lastIndex: 0,
      firstSampleId: String(index), lastSampleId: String(index), firstAt: at, lastAt: at }],
    schemaVersion: 2, telemetryRoot: dayData.SESSION_SCOPE, revision: 1, updatedBy: 'admin' };
}
function harness(count = 1) {
  const state = new BehaviorSubject({ ready: true, uid: 'viewer' });
  const records = new Map([[root + date, event], ...Array.from({ length: count }, (_, i) => [root + date + '/sessions/' + session(i).id, session(i)])]);
  const listeners = [], requests = [];
  let delayed;
  const snapshot = path => ({ id: path.split('/').at(-1), exists: records.has(path), data: () => records.get(path), metadata: { fromCache: false, hasPendingWrites: false } });
  const ref = (path, spec = { order: [] }) => ({
    path, orderBy: (key, direction) => ref(path, { ...spec, order: [...spec.order, [key, direction]] }),
    limit: limit => ref(path, { ...spec, limit }), startAfter: after => ref(path, { ...spec, after }),
    onSnapshot(options, next, error) {
      if (path.endsWith('/sessions')) assert.equal(spec.limit, 30);
      const listener = { path, spec, next, error, active: true }; listeners.push(listener);
      queueMicrotask(() => { if (listener.active) next(result(path, spec)); });
      return () => listener.active = false;
    },
    async get() {
      assert.equal(spec.limit, 30); requests.push({ path, ...spec });
      if (delayed) { const next = delayed; delayed = undefined; return next; }
      return result(path, spec);
    }
  });
  function result(path, spec) {
    if (!path.endsWith('/sessions')) return snapshot(path);
    let docs = [...records.keys()].filter(key => key.startsWith(path + '/')).map(snapshot).sort((a, b) => b.data().startAt - a.data().startAt || b.id.localeCompare(a.id));
    if (spec.after) docs = docs.slice(docs.findIndex(doc => doc.id === spec.after.id) + 1);
    docs = docs.slice(0, spec.limit);
    return { docs, size: docs.length, metadata: { fromCache: false, hasPendingWrites: false } };
  }
  const service = new GreenpowerEventContextService({ firestore: { doc: ref, collection: ref } }, { state });
  return { service, records, state, listeners, requests, publish(path, value, metadata = {}) {
    records.set(path, value);
    for (const listener of listeners.filter(listener => listener.active && (listener.path === path || path.startsWith(listener.path + '/')))) {
      listener.next({ ...result(listener.path, listener.spec), metadata: { fromCache: false, hasPendingWrites: false, ...metadata } });
    }
  }, delay(promise) { delayed = promise; } };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('displayed live context observes event and session edits independently of History and never loads raw telemetry', async () => {
  const h = harness(); h.service.select(date, true); await flush();
  assert.equal(h.service.event.date, date); assert.equal(h.service.sessions[0].endAt, null);
  assert.equal(h.listeners.filter(listener => listener.active).length, 2); assert.equal(h.requests.length, 0);
  h.service.select(date, true); assert.equal(h.listeners.length, 2, 'telemetry updates do not resubscribe');
  h.publish(root + date, { ...event, eventName: 'Race day', revision: 1 });
  assert.equal(h.service.event.eventName, 'Race day');
  const closed = { ...session(0), endAt: session(0).startAt, revision: 2 };
  h.publish(root + date + '/sessions/' + closed.id, closed);
  assert.equal(h.service.sessions[0].endAt, closed.startAt);
  assert.equal(h.service.sessions[0].revision, 2);
  assert.ok(h.listeners.every(listener => !listener.path.includes('/chunks')));
  h.service.ngOnDestroy(); assert.ok(h.listeners.every(listener => !listener.active));
});

test('live session metadata loads 30 newest records and only continues by explicit action', async () => {
  const h = harness(31); h.service.select(date, true); await flush();
  assert.equal(h.service.sessions.length, 30); assert.equal(h.service.more, true);
  assert.equal(h.service.sessions.at(-1).id, 's030'); assert.equal(h.requests.length, 0);
  await h.service.loadMore(); assert.equal(h.requests.length, 1); assert.equal(h.service.sessions.length, 31); assert.equal(h.service.more, false);
  await flush(); assert.equal(h.requests.length, 1);
  h.service.ngOnDestroy();
});

test('cache-only, pending writes and old-context callbacks cannot change the displayed event', async () => {
  const h = harness(); h.service.select(date, true); await flush();
  h.publish(root + date, { ...event, eventName: 'Untrusted cache' }, { fromCache: true });
  h.publish(root + date, { ...event, eventName: 'Pending' }, { hasPendingWrites: true });
  assert.equal(h.service.event.eventName, '');
  const old = h.listeners[0]; h.service.select('2026-10-21', false);
  old.next({ exists: true, data: () => ({ ...event, eventName: 'Old callback' }), metadata: {} });
  await flush(); assert.equal(h.service.event, undefined); assert.match(h.service.metadataError, /unavailable/);
  assert.equal(old.active, false);
  h.state.next({ ready: true, uid: '' });
  assert.equal(h.service.event, undefined); assert.deepEqual(h.service.sessions, []);
  assert.ok(h.listeners.every(listener => !listener.active)); h.service.ngOnDestroy();
});

test('page results are cancelled on context changes and errors require an explicit retry', async () => {
  const h = harness(31); h.service.select(date, true); await flush();
  let finish; h.delay(new Promise(resolve => finish = resolve));
  const loading = h.service.loadMore(); h.service.clear(); finish({ docs: [], size: 0 }); await loading;
  assert.deepEqual(h.service.sessions, []); assert.equal(h.service.loading, false);
  h.service.select(date, true); await flush();
  h.listeners.at(-1).error(new Error('offline')); assert.match(h.service.error, /Could not load/);
  const count = h.requests.length; await flush(); assert.equal(h.requests.length, count);
  await h.service.loadMore(); await flush(); assert.equal(h.service.error, '');
  assert.equal(h.listeners.filter(listener => listener.active).length, 2); h.service.ngOnDestroy();
});


test('historical context loads one unfiltered page per action and explicit reload refreshes sessions', async () => {
  const h = harness(31); h.service.select(date, false, event); await flush();
  assert.equal(h.service.event.date, date); assert.equal(h.requests.length, 1);
  assert.equal(h.service.sessions.length, 30); assert.equal(h.service.more, true);
  assert.deepEqual([...new Set(h.service.sessions.map(session => session.type))].sort(), ['practice', 'race']);
  assert.equal(h.listeners.filter(listener => listener.active).length, 1);
  await h.service.loadMore(); assert.equal(h.requests.length, 2); assert.equal(h.service.sessions.length, 31);
  h.service.select(date, false, event); await flush();
  assert.equal(h.requests.length, 3); assert.equal(h.service.sessions.length, 30);
  assert.equal(h.listeners.filter(listener => listener.active).length, 1);
  h.service.ngOnDestroy();
});


test('reconnecting after a missing session batch requires explicit pagination from the new boundary', async () => {
  const h = harness(1); h.service.select(date, true); await flush();
  assert.equal(h.service.more, false);
  for (let index = 1; index <= 40; index++) h.records.set(root + date + '/sessions/' + session(index).id, session(index));
  h.publish(root + date + '/sessions/s040', session(40));
  assert.equal(h.service.more, true); assert.equal(h.requests.length, 0);
  await h.service.loadMore();
  assert.equal(h.requests[0].after.id, 's011');
  assert.equal(h.service.sessions.length, 41); assert.equal(h.service.more, false);
  h.service.ngOnDestroy();
});

test('acknowledged deletion removes annotations and prevents stale pages restoring them until context reload', async () => {
  const h = harness(); h.service.select(date, false); await flush();
  const removed = session(0);
  h.service.acknowledge({ ...event, sessionTypeCounts: {} }, undefined, removed.id);
  assert.deepEqual(h.service.sessions, []);
  // A response captured before deletion cannot resurrect the local annotation.
  h.delay(Promise.resolve({ docs: [{ id: removed.id, data: () => removed }], size: 1 }));
  await h.service.loadMore(); assert.deepEqual(h.service.sessions, []);
  h.service.clear(); h.service.select(date, false); await flush();
  assert.equal(h.service.sessions.length, 1, 'a new context loads the server state afresh');
  h.service.ngOnDestroy();
});
