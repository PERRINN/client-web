import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Subject } from 'rxjs';
import { data, load, sample, recordings } from './load.mjs';
import { recording } from './eventFixtures.mjs';
const { GreenpowerTelemetryService } = load('../../src/app/greenpower-telemetry/greenpowerTelemetry.service.ts', {
  '@angular/core': { Injectable: () => target => target, runInInjectionContext: (_, callback) => callback() },
  'firebase/compat/app': { default: { firestore: { FieldPath: { documentId: () => '__name__' } } } },
  'firebase/compat/firestore': {}, rxjs: { Subject }, './greenpowerData': data, './greenpowerRecording': recordings
});

function harness() {
  const authState = new Subject(), records = new Map(), calls = [], listeners = [];
  let offCount = 0, delayed;
  const snapshot = docs => ({ docs, size: docs.length, metadata: { fromCache: false }, docChanges: () => docs.map(doc => ({ type: 'added', doc })) });
  function ref(path, options = {}) {
    return { path,
      collection: name => ref(`${path}/${name}`), doc: id => ref(`${path}/${id}`),
      orderBy: (field, direction) => ref(path, { ...options, field, direction }), limit: limit => ref(path, { ...options, limit }),
      startAt: cursor => ref(path, { ...options, cursor: typeof cursor === 'string' ? cursor : cursor.id, inclusive: true }),
      startAfter: cursor => ref(path, { ...options, cursor: typeof cursor === 'string' ? cursor : cursor.id, inclusive: false }),
      endAt: end => ref(path, { ...options, end }),
      async get(source) {
        assert.equal(source.source, 'server');
        calls.push({ path, ...options });
        if (delayed) { const callback = delayed; delayed = undefined; return callback(); }
        if (path.split('/').length % 2 === 0) return { data: () => records.get(path) };
        assert.ok(options.limit > 0 && options.limit <= 100);
        let entries = [...records].filter(([key]) => key.startsWith(`${path}/`) && key.slice(path.length + 1).indexOf('/') < 0).sort(([a], [b]) => a.localeCompare(b));
        if (options.direction === 'desc') entries.reverse();
        entries = entries.filter(([key]) => !options.cursor || (options.direction === 'desc' ? key.split('/').at(-1) < options.cursor : options.inclusive ? key.split('/').at(-1) >= options.cursor : key.split('/').at(-1) > options.cursor));
        if (options.end) entries = entries.filter(([key]) => key.split('/').at(-1) <= options.end);
        return snapshot(entries.slice(0, options.limit).map(([key, value]) => ({ id: key.split('/').at(-1), data: () => value })));
      },
      onSnapshot(optionsOrNext, nextOrError, error) {
        const next = typeof optionsOrNext === 'function' ? optionsOrNext : nextOrError;
        const listener = { path, options, next, error: error || nextOrError, active: true };
        listeners.push(listener); return () => { listener.active = false; offCount++; };
      }
    };
  }
  const root = 'GreenpowerTelemetry/424/days';
  const service = new GreenpowerTelemetryService({ authState }, { firestore: { collection: name => ref(name) } }, {});
  function seed(day, count) {
    records.set(`${root}/${day}`, { date: day, count, latest: sample(count) });
    for (let i = 0; i < count; i++) records.set(`${root}/${day}/chunks/${String(i).padStart(10, '0')}`, { samples: [sample(i)], bytes: 200 });
  }
  return { service, authState, records, calls, listeners, root, seed, snapshot, get offCount() { return offCount; }, delay: callback => { delayed = callback; } };
}
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };

test('clearing a selector preserves matching authorized chunks but an account change always rereads', async () => {
  const h = harness(), fixture = recording('2026-06-14', '424-phone');
  fixture.records.forEach(([path, value]) => h.records.set(path, value));
  h.records.get(h.root + '/2026-06-14').latest = fixture.samples.at(-1);
  h.authState.next({ uid: 'first' }); await settle(); await h.service.select('2026-06-14');
  const reads = h.calls.length;
  h.service.clearRecording('2026-06-14', 'event:manual'); assert.deepEqual(h.service.channels, []);
  await h.service.selectRecording('run-1', [fixture.segment(0, 1)]);
  assert.equal(h.service.error, ''); assert.equal(h.calls.length, reads); assert.equal(h.service.latest.id, fixture.samples[1].id);
  h.authState.next({ uid: 'second' }); await settle(); const newAccountReads = h.calls.length;
  await h.service.selectRecording('run-1', [fixture.segment(0, 1)]);
  assert.equal(h.service.error, ''); assert.ok(h.calls.length > newAccountReads, 'old-account chunks were released');
  h.service.ngOnDestroy();
});

test('signed-out state performs no reads; sign-in starts today; logout clears data and listeners', async () => {
  const h = harness(); h.authState.next(null); await settle();
  assert.equal(h.calls.length, 0); assert.equal(h.service.access, 'signed-out');
  h.authState.next({ uid: 'first' }); await settle();
  assert.equal(h.service.access, 'signed-in'); assert.equal(h.calls.length, 1);
  h.authState.next(null);
  assert.equal(h.service.access, 'signed-out'); assert.deepEqual(h.service.channels, []);
  assert.equal(h.listeners.filter(l => l.active).length, 0);
  h.service.ngOnDestroy();
});
test('full-day pagination preserves all chunks and history uses its latest sample', async () => {
  const h = harness(); h.authState.next({ uid: 'first' }); await settle();
  h.seed('2026-10-17', 250); h.calls.length = 0;
  await h.service.select('2026-10-17');
  assert.equal(h.calls.length, 4); // metadata plus three limited chunk queries
  assert.equal(h.service.channels.find(c => c.label === 'Vehicle speed').points.length, 250);
  assert.equal(h.service.more, false);
  assert.equal(h.service.latest.id, '250');
  assert.equal(h.listeners.filter(l => l.active).length, 0);
  h.service.ngOnDestroy();
});
test('each loading action stops at 50 pages and offers continuation without dropping boundary samples', async () => {
  const h = harness(); h.authState.next({ uid: 'first' }); await settle();
  h.seed('2026-10-17', 5001); h.calls.length = 0;
  await h.service.select('2026-10-17');
  assert.equal(h.calls.length, 51); assert.equal(h.service.more, true);
  assert.equal(h.service.channels.find(c => c.label === 'Vehicle speed').points.length, 4951);
  await h.service.loadMore();
  assert.equal(h.service.channels.find(c => c.label === 'Vehicle speed').points.length, 5001);
  assert.equal(h.service.more, false); h.service.ngOnDestroy();
});
test('late responses from a previously selected date or signed-out account are ignored', async () => {
  const h = harness(); h.authState.next({ uid: 'first' }); await settle();
  let resolve; h.delay(() => new Promise(done => { resolve = done; }));
  const loading = h.service.select('2026-10-17');
  await h.service.select('2026-10-18');
  resolve({ data: () => ({ latest: sample(17) }) }); await loading;
  assert.equal(h.service.day, '2026-10-18'); assert.equal(h.service.latest, undefined);
  h.seed('2026-10-18', 1);
  h.delay(() => new Promise(done => { resolve = done; }));
  const privateLoad = h.service.select('2026-10-18');
  h.authState.next(null); resolve({ data: () => ({ latest: sample(18) }) }); await privateLoad;
  assert.equal(h.service.latest, undefined); assert.deepEqual(h.service.channels, []);
  h.service.ngOnDestroy();
});
test('available dates load 30 at a time and each action makes one query', async () => {
  const h = harness(); h.authState.next({ uid: 'first' }); await settle();
  for (let i = 1; i <= 31; i++) h.seed(`2026-08-${String(i).padStart(2, '0')}`, 0);
  h.calls.length = 0; await h.service.loadDates();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].field, 'date'); assert.equal(h.service.dates.length, 30); assert.equal(h.service.moreDates, true);
  await h.service.loadDates(); assert.equal(h.calls.length, 2); assert.equal(h.service.dates.length, 31); assert.equal(h.service.moreDates, false);
  h.service.ngOnDestroy();
});
test('live boundary updates replace the mutable chunk and cached metadata never exposes values', async () => {
  const h = harness(); h.authState.next({ uid: 'first' }); await settle();
  const metadata = h.listeners.find(l => l.active && !l.path.endsWith('/chunks'));
  metadata.next({ metadata: { fromCache: true }, data: () => ({ latest: sample(1) }) });
  assert.equal(h.service.latest, undefined);
  metadata.next({ metadata: { fromCache: false }, data: () => ({ latest: sample(2) }) });
  const tail = h.listeners.find(l => l.active && l.path.endsWith('/chunks'));
  const chunk = samples => h.snapshot([{ id: '0000000000', data: () => ({ samples, bytes: 200 }) }]);
  tail.next(chunk([sample(1)])); tail.next(chunk([sample(1), sample(2)]));
  assert.equal(h.service.channels.find(c => c.label === 'Vehicle speed').points.length, 2);
  assert.equal(h.service.connected, true);
  h.service.ngOnDestroy(); assert.equal(h.listeners.filter(l => l.active).length, 0);
});
test('a full live tail rebases within a fixed budget instead of stopping an ordinary day', async () => {
  const h = harness(); h.authState.next({ uid: 'first' }); await settle();
  const tail = h.listeners.find(l => l.active && l.path.endsWith('/chunks'));
  tail.next(h.snapshot(Array.from({ length: 100 }, (_, i) => ({ id: String(i).padStart(10, '0'), data: () => ({ samples: [sample(i)], bytes: 200 }) }))));
  await settle();
  assert.equal(tail.active, false);
  const current = h.listeners.find(l => l.active && l.path.endsWith('/chunks'));
  assert.equal(current.options.cursor, '0000000099');
  assert.equal(h.service.more, false);
  assert.equal(h.service.channels.find(c => c.label === 'Vehicle speed').points.length, 100);
  h.service.ngOnDestroy();
});
test('load errors surface without automatic request loops and can be retried explicitly', async () => {
  const h = harness(); h.authState.next({ uid: 'first' }); await settle();
  h.calls.length = 0; h.delay(() => { throw new Error('synthetic unavailable'); });
  await h.service.select('2026-10-17');
  assert.ok(h.service.error); assert.equal(h.calls.length, 1);
  h.seed('2026-10-17', 1); await h.service.select('2026-10-17');
  assert.equal(h.service.error, ''); assert.equal(h.service.channels.length, 8);
  h.service.ngOnDestroy();
});
test('UK midnight rolls live onto the next day and closes previous listeners', async () => {
  const h = harness(), original = Date.now;
  try {
    Date.now = () => Date.parse('2026-07-01T22:59:59Z');
    h.authState.next({ uid: 'first' }); await settle();
    assert.equal(h.service.day, '2026-07-01');
    const old = h.listeners.filter(l => l.active);
    Date.now = () => Date.parse('2026-07-01T23:00:00Z');
    h.service.tick(); await settle();
    assert.equal(h.service.day, '2026-07-02'); assert.ok(old.every(l => !l.active));
  } finally { Date.now = original; h.service.ngOnDestroy(); }
});
