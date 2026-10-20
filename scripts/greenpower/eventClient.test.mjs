import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BehaviorSubject, Subject, firstValueFrom, defer } from 'rxjs';
import { load, eventData, recordings, data, dayData, tracks } from './load.mjs';
import { memoryDb, editMetadata, event, eventChange, request, recording, session, sessionChange, adminAuth, options, ROOT } from './eventFixtures.mjs';
const core = { Injectable: () => target => target };
const firebase = { default: { firestore: { FieldPath: { documentId: () => '__name__' }, FieldValue: { serverTimestamp: () => 'server-time' } } } };
const { GreenpowerEventsService } = load('../../src/app/greenpower-telemetry/greenpowerEvents.service.ts', {
  '@angular/core': core, 'firebase/compat/app': firebase, 'firebase/compat/firestore': {}, rxjs: { Subject }, './greenpowerEvents': eventData, './greenpowerDay': dayData, './greenpowerTracks': tracks
});
const { GreenpowerEventEditService } = load('../../src/app/greenpower-telemetry/greenpowerEventEdit.service.ts', {
  '@angular/core': core, rxjs: { firstValueFrom, Subject }, './greenpowerDay': dayData, './greenpowerDay': dayData, './greenpowerTracks': tracks
});
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const savedEvent = (id, date = '2026-06-14') => ({ ...event(id), id, date, revision: 1, sessionCount: 0, updatedBy: 'test-admin' });

function client(records = new Map()) {
  const state = new BehaviorSubject({ ready: true, uid: 'test-admin', isAdmin: true });
  const permissions = { state, get current() { return state.value; } };
  const calls = [], listeners = [];
  let pending, fail = false;
  const snapshot = (path, metadata = {}) => ({ id: path.split('/').at(-1), exists: records.has(path), ref: { path },
    data: () => structuredClone(records.get(path)), metadata: { fromCache: false, hasPendingWrites: false, ...metadata } });
  function ref(path, spec = { order: [], filters: [] }) {
    return { path, doc: (id = 'new-track') => ({ ...ref(path + '/' + id), id }), collection: name => ref(path + '/' + name),
      where: (field, op, value) => ref(path, { ...spec, filters: [...spec.filters, [field, op, value]] }),
      orderBy: (field, direction = 'asc') => ref(path, { ...spec, order: [...spec.order, [field, direction]] }),
      limit: limit => ref(path, { ...spec, limit }), startAt: first => ref(path, { ...spec, first }), endAt: end => ref(path, { ...spec, end }),
      startAfter: cursor => ref(path, { ...spec, after: typeof cursor === 'string' ? cursor : cursor.id }),
      async get(source) {
        assert.equal(source.source, 'server');
        if (path.split('/').length % 2 === 0) { calls.push({ path, direct: true }); return snapshot(path); }
        assert.ok(spec.limit > 0 && spec.limit <= 367); calls.push({ path, ...spec });
        if (pending) { const callback = pending; pending = undefined; return callback(); }
        if (fail) throw new Error('synthetic read failure');
        const field = (record, key) => key === '__name__' ? record.id : record.data()?.[key];
        const docs = [...records.keys()].filter(key => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/')).map(key => snapshot(key))
          .filter(doc => spec.filters.every(([key, op, value]) => op === 'in' ? value.includes(field(doc, key)) : op === '==' ? field(doc, key) === value : op === '>=' ? field(doc, key) >= value : field(doc, key) <= value))
          .sort((a, b) => { for (const [key, direction] of spec.order) { const x = field(a, key), y = field(b, key); if (x !== y) return (x < y ? -1 : 1) * (direction === 'desc' ? -1 : 1); } return 0; });
        let start = spec.after ? docs.findIndex(doc => doc.id === spec.after) + 1 : 0;
        const selected = docs.slice(start).filter(doc => (!spec.first || doc.id >= spec.first) && (!spec.end || doc.id <= spec.end)).slice(0, spec.limit);
        return { docs: selected, size: selected.length };
      },
      onSnapshot(settings, next, error) {
        const listener = { path, next, error, active: true }; listeners.push(listener);
        queueMicrotask(() => { if (listener.active) next(snapshot(path)); });
        return () => { listener.active = false; };
      }
    };
  }
  const db = { doc: ref, collection: ref, async runTransaction(callback) {
    const pending = []; await callback({ get: async target => snapshot(target.path), set: (target, value) => pending.push([target.path, value]) });
    pending.forEach(([path, value]) => records.set(path, value));
  } };
  const service = new GreenpowerEventsService(permissions, { firestore: db });
  return { service, db, state, records, calls, listeners, delay(callback) { pending = callback; }, fail(value) { fail = value; },
    publish(path, value, metadata = {}) { records.set(path, value); listeners.filter(l => l.active && l.path === path).forEach(l => l.next(snapshot(path, metadata))); } };
}

function wireRecording(day, chunks) {
  const map = new Map(), all = [];
  for (let i = 0; i < chunks; i++) {
    const chunk = String(i).padStart(10, '0'), sample = { id: day + '-' + i, receivedAt: Date.parse(day + 'T08:00:00Z') + i * 1000, source: '424-phone', raw: '{"Vt":24}' };
    map.set(ROOT + '/days/' + day + '/chunks/' + chunk, { bytes: 150, samples: [sample] }); all.push({ day, chunk, index: 0, sample, lastInChunk: true });
  }
  return { map, all, segment: { day, source: '424-phone', firstChunk: all[0].chunk, lastChunk: all.at(-1).chunk,
    firstIndex: 0, lastIndex: 0, firstSampleId: all[0].sample.id, lastSampleId: all.at(-1).sample.id, firstAt: all[0].sample.receivedAt, lastAt: all.at(-1).sample.receivedAt } };
}

test('recording load budgets span days, support continuation and never load outside chunk ranges', async () => {
  const a = wireRecording('2026-06-14', 3000), b = wireRecording('2026-06-15', 3000);
  const h = client(new Map([...a.map, ...b.map]));
  const reader = new recordings.RecordingReader(h.db.collection(ROOT + '/days'), [a.segment, b.segment]);
  await reader.load(() => true); assert.equal(h.calls.length, data.MAX_PAGES); assert.equal(reader.more, true); assert.equal(reader.entries.length, 5000);
  await reader.load(() => true); assert.equal(reader.more, false); assert.equal(reader.entries.length, 6000); assert.equal(h.calls.length, 60);
  assert.ok(h.calls.every(call => call.limit <= 100 && call.end === '0000002999'));
  h.service.ngOnDestroy();
});

test('cached boundary chunks serve separate ranges without rereads; cancellation and missing boundaries fail closed', async () => {
  const rec = recording(), h = client(new Map(rec.records));
  const reader = new recordings.RecordingReader(h.db.collection(ROOT + '/days'), [rec.segment(0, 1), rec.segment(2, 3)]);
  await reader.load(() => true); assert.equal(h.calls.length, 1); assert.equal(reader.entries.length, 4);
  const reused = new recordings.RecordingReader(h.db.collection(ROOT + '/days'), [rec.segment()], reader.cachedChunks());
  await reused.load(() => true); assert.equal(h.calls.length, 1);
  const invalid = new recordings.RecordingReader(h.db.collection(ROOT + '/days'), [{ ...rec.segment(), lastSampleId: 'missing' }]);
  await assert.rejects(invalid.load(() => true), /boundaries/);
  let release, active = true; h.delay(() => new Promise(resolve => release = resolve));
  const cancelled = new recordings.RecordingReader(h.db.collection(ROOT + '/days'), [rec.segment()]);
  const loading = cancelled.load(() => active); active = false; release({ docs: [], size: 0 }); await loading;
  assert.equal(cancelled.entries.length, 0); h.service.ngOnDestroy();
});

test('zoom capture preserves exact positions, splits disjoint samples and derives documented import IDs only', () => {
  const day = '2026-06-14', raw = Array.from({ length: 4 }, (_, i) => ({ day, chunk: '0000000000', index: i,
    lastInChunk: i === 3, sample: { id: 'echook:car:' + i, source: 'echook-history', receivedAt: 1, eventAt: Date.parse(day + 'T08:00:00Z') + [0, 2000, 1000, 3000][i], raw: '{}' } }));
  const result = recordings.recordingRange(raw, raw[0].sample.eventAt, raw[2].sample.eventAt);
  assert.equal(result.length, 2); assert.equal(result[0].firstIndex, 0); assert.equal(result[1].firstIndex, 2); assert.equal(result[0].importId, 'echook-car-' + day);
  assert.throws(() => recordings.recordingRange([{ ...raw[0], sample: { ...raw[0].sample, source: 'synthetic' } }], 0, Infinity), /unsupported/);
  assert.throws(() => recordings.recordingRange([], 0, 1), /Choose a range/);
});

const day = '2026-06-14';
const filters = (type = '', location = '') => ({ type, location, from: '2026-01-01', to: '2026-12-31' });
const { editDayMetadata } = (await import('node:module')).createRequire(import.meta.url)('../../functions/utils/greenpowerDayMetadata.js');
function migrated() {
  const rec = recording(), value = dayData.emptyDay(day), segment = rec.segment();
  value.eventName = 'Workshop'; value.defaults = { driver: 'Alex', motorGearTeeth: 12, wheelGearTeeth: 60 };
  const session = { id: 'practice', type: 'practice', startAt: segment.firstAt, endAt: segment.lastAt, batteryIds: [], overrides: {}, ranges: [segment], schemaVersion: 2, telemetryRoot: ROOT, revision: 1, updatedBy: 'admin' };
  return { rec, value, session };

}
test('all 366 event summaries load in one query; track filters are server-side', async () => {
  const h = client();
  for (let i = 0; i < 366; i++) {
    const date = new Date(Date.UTC(2028, 0, 1 + i)).toISOString().slice(0, 10);
    h.records.set(ROOT + '/days/' + date, { ...dayData.emptyDay(date), trackId: i === 0 ? 'track' : null });
  }
  await h.service.loadEvents(true, { ...filters(), from: '2028-01-01', to: '2028-12-31' });
  assert.equal(h.service.events.length, 366); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].limit, 367);
  await h.service.loadEvents(true, { ...filters('', 'track'), from: '2028-01-01', to: '2028-12-31' });
  assert.equal(h.service.events.length, 1); assert.equal(h.calls.length, 2);
  assert.ok(h.calls[1].filters.some(filter => filter[0] === 'trackId' && filter[2] === 'track'));
  await h.service.loadEvents(true, { ...filters(), to: '2027-01-01' }); assert.equal(h.calls.length, 2);
  h.service.ngOnDestroy();
});
test('event selection loads one session page; session selection listens to metadata without raw reads', async () => {
  const { value, session } = migrated(), h = client(new Map([[ROOT + '/days/' + day, value], [ROOT + '/days/' + day + '/sessions/practice', session]]));
  await h.service.loadEvents(true, filters()); const reads = h.calls.length;
  h.service.selectEvent(day); await flush(); h.service.selectSession('practice'); await flush();
  assert.equal(h.service.eventReady, true); assert.equal(h.service.selectedSession.type, 'practice');
  assert.equal(h.calls.length, reads + 1); assert.ok(h.calls.every(call => !call.path.includes('/chunks/'))); assert.equal(h.listeners.length, 2); assert.equal(h.listeners[0].path, ROOT + '/days/' + day);
  const original = h.service.selectedEvent;
  h.publish(ROOT + '/days/' + day, { ...value, eventName: 'Cached secret' }, { fromCache: true });
  assert.equal(h.service.selectedEvent, original);
  h.publish(ROOT + '/days/' + day, { ...value, revision: 2, defaults: { driver: 'Jamie' } });
  assert.equal(dayData.effectiveDefaults(h.service.selectedEvent, h.service.selectedSession).driver, 'Jamie');
  h.state.next({ ready: true, uid: '', isAdmin: false }); assert.equal(h.service.selectedEvent, undefined);
  assert.ok(h.listeners.every(listener => !listener.active)); h.service.ngOnDestroy();
});
test('stale year responses and failed reads do not replace current results or retry automatically', async () => {
  const h = client(); let release;
  h.delay(() => new Promise(resolve => release = resolve)); const old = h.service.loadEvents(true, filters());
  await h.service.loadEvents(true, { ...filters(), from: '2027-01-01', to: '2027-12-31' });
  release({ docs: [], size: 0 }); await old; assert.equal(h.service.loadingEvents, false);
  h.fail(true); await h.service.loadEvents(); const count = h.calls.length; await flush(); assert.equal(h.calls.length, count);
  assert.match(h.service.listError, /Could not load/); h.fail(false); await h.service.loadEvents(); assert.equal(h.service.listError, ''); h.service.ngOnDestroy();
});
test('legacy days remain readable but cannot silently create replacement metadata', async () => {
  const h = client(new Map(recording().records)); h.service.selectEvent(day); await flush();
  assert.equal(h.service.eventReady, true); assert.equal(h.service.migrated, false);
  const editor = new GreenpowerEventEditService(h.service, {}, {}); editor.event();
  assert.equal(editor.mode, ''); assert.match(editor.error, /migration/); editor.ngOnDestroy(); h.service.ngOnDestroy();
});
test('metadata save patches one cached event, never refreshes the year, and retries unknown outcomes identically', async () => {
  const { rec, value } = migrated(), backend = memoryDb([...rec.records, [ROOT + '/days/' + day, value], [ROOT + '/days/' + day + '/live/latest', { count: 4, activeChunk: 0 }]]);
  const h = client(backend.records); await h.service.loadEvents(true, filters()); h.service.selectEvent(day); await flush();
  const calls = []; let unknown = true;
  const functions = { httpsCallable: () => input => defer(async () => {
    calls.push(structuredClone(input)); const result = await editDayMetadata(backend, adminAuth, input, options);
    if (unknown) { unknown = false; throw { code: 'functions/unavailable' }; } return result;
  }) };
  const editor = new GreenpowerEventEditService(h.service, { day, range: () => [rec.segment()] }, functions);
  const reads = h.calls.length; editor.event(); editor.draft.eventName = 'Updated'; editor.review();
  await editor.save(); assert.equal(editor.uncertain, true); assert.equal(editor.locked, true);
  editor.cancel(); assert.equal(editor.locked, true); await editor.save();
  assert.deepEqual(calls[0], calls[1]); assert.equal(h.service.selectedEvent.eventName, 'Updated');
  assert.equal(h.calls.filter(call => call.path.endsWith('/days')).length, 1);
  assert.equal(h.calls.length, reads + 1, 'only the initial track catalogue query is added');
  assert.equal(editor.notice, 'Saved'); editor.ngOnDestroy(); h.service.ngOnDestroy();
});
test('track catalogue pagination is explicit and name-only tracks can be created before loading raw data', async () => {
  const h = client();
  for (let i = 0; i < 35; i++) h.records.set(ROOT + '/tracks/t' + i, { name: 'Track ' + String(i).padStart(2, '0'), bounds: null, line: null, cells: [], revision: 1, updatedBy: 'admin' });
  await h.service.loadTracks(); assert.equal(h.service.tracks.length, 30); assert.equal(h.calls.length, 1); assert.equal(h.service.moreTracks, true);
  await flush(); assert.equal(h.calls.length, 1); await h.service.loadTracks(); assert.equal(h.service.tracks.length, 35); assert.equal(h.service.moreTracks, false);
  const id = await h.service.addTrack('New venue'); assert.ok(id); assert.equal(h.records.get(ROOT + '/tracks/' + id).bounds, null);
  assert.ok(h.calls.every(call => !call.path.includes('/chunks'))); h.service.ngOnDestroy();
});
test('session pages are limited to thirty, only load more on action, and discard stale filter results', async () => {
  const { value, session } = migrated(), h = client(new Map([[ROOT + '/days/' + day, value]]));
  for (let i = 0; i < 35; i++) h.records.set(ROOT + '/days/' + day + '/sessions/s' + String(i).padStart(2, '0'), { ...session, id: 's' + String(i).padStart(2, '0') });
  h.service.selectEvent(day); await flush(); assert.equal(h.service.sessions.length, 30); assert.equal(h.service.moreSessions, true);
  assert.equal(h.calls.length, 1); await flush(); assert.equal(h.calls.length, 1);
  await h.service.loadSessions(); assert.equal(h.service.sessions.length, 35); assert.equal(h.service.moreSessions, false);
  let release; h.delay(() => new Promise(resolve => release = resolve)); const old = h.service.loadSessions(true); await flush();
  h.service.filters.type = 'race'; await h.service.loadSessions(true); release({ docs: [], size: 0 }); await old;
  assert.equal(h.service.sessions.length, 0); assert.equal(h.service.loadingSessions, false);
  assert.ok(h.calls.every(call => call.limit === 30 && !call.path.includes('/chunks/')));
  h.service.ngOnDestroy();
});
test('session selection changes and listener updates never trigger recording loads and stale session callbacks are ignored', async () => {
  const { value, session } = migrated(), path = ROOT + '/days/' + day + '/sessions/practice';
  const h = client(new Map([[ROOT + '/days/' + day, value], [path, session]]));
  h.service.selectEvent(day); await flush(); h.service.selectSession('practice'); await flush();
  const old = h.listeners.at(-1), reads = h.calls.length;
  h.publish(path, { ...session, revision: 2, overrides: { driver: 'Sam' } }); assert.equal(h.service.selectedSession.overrides.driver, 'Sam');
  assert.equal(h.calls.length, reads);
  h.service.selectSession(''); old.next({ exists: true, data: () => session, metadata: { fromCache: false, hasPendingWrites: false } });
  assert.equal(h.service.selectedSession, undefined); assert.equal(h.service.sessionId, ''); h.service.ngOnDestroy();
});
