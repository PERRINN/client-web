import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BehaviorSubject, Subject, firstValueFrom, defer } from 'rxjs';
import { load, eventData, recordings, data } from './load.mjs';
import { memoryDb, editMetadata, event, eventChange, request, recording, session, sessionChange, adminAuth, options, ROOT } from './eventFixtures.mjs';
const core = { Injectable: () => target => target };
const firebase = { default: { firestore: { FieldPath: { documentId: () => '__name__' } } } };
const { GreenpowerEventsService } = load('../../src/app/greenpower-telemetry/greenpowerEvents.service.ts', {
  '@angular/core': core, 'firebase/compat/app': firebase, 'firebase/compat/firestore': {}, rxjs: { Subject }, './greenpowerEvents': eventData
});
const { GreenpowerEventEditService } = load('../../src/app/greenpower-telemetry/greenpowerEventEdit.service.ts', {
  '@angular/core': core, rxjs: { firstValueFrom, Subject }, './greenpowerEvents': eventData
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
    return { path, doc: id => ref(path + '/' + id), collection: name => ref(path + '/' + name),
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
  const db = { doc: ref, collection: ref };
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

async function editorHarness() {
  const rec = recording(), backend = memoryDb(rec.records);
  await editMetadata(backend, adminAuth, request('setup', [eventChange('2026-06-14')], [sessionChange('s', session('2026-06-14', [rec.segment()]))]), options);
  const h = client(backend.records); h.service.selectEvent('2026-06-14'); await flush(); h.service.selectSession('s'); await flush(); await h.service.loadEvents();
  const calls = []; let unknownOnce = false, wait;
  const functions = { httpsCallable(name, config) {
    assert.equal(name, 'greenpowerEventEdit'); assert.equal(config.timeout, 35000);
    return input => defer(async () => {
      calls.push(structuredClone(input)); if (wait) await wait;
      const result = await editMetadata(backend, adminAuth, input, options);
      if (unknownOnce) { unknownOnce = false; throw { code: 'functions/unavailable' }; }
      return result;
    });
  } };
  const telemetry = { day: '2026-06-14', dates: ['2026-06-14'], start: rec.segment().firstAt, end: rec.segment().lastAt, range: () => [rec.segment()] };
  const editor = new GreenpowerEventEditService(h.service, telemetry, functions);
  return { ...h, editor, backend, calls, telemetry, unknown() { unknownOnce = true; }, delay(value) { wait = value; }, destroy() { editor.ngOnDestroy(); h.service.ngOnDestroy(); } };
}

const day = '2026-06-14';
const filters = (type = '', location = '') => ({ type, location, from: '2026-01-01', to: '2026-12-31' });

test('all filtered recorded days load at once, including unnamed days, with explicit year bounds', async () => {
  const h = client();
  for (let i = 1; i <= 31; i++) { const date = '2026-07-' + String(i).padStart(2, '0'); h.records.set(ROOT + '/days/' + date, { date, count: 1 }); }
  h.records.set(ROOT + '/days/2025-06-14', { date: '2025-06-14', count: 1 });
  h.records.set(ROOT + '/events/legacy', savedEvent('Legacy workshop'));
  const year = new Intl.DateTimeFormat('en', { timeZone: 'Europe/London', year: 'numeric' }).format(new Date());
  assert.equal(h.service.filters.from, year + '-01-01');
  await h.service.loadEvents(true, filters()); assert.equal(h.service.events.length, 31);
  assert.equal(h.calls.length, 3); assert.equal(h.calls[0].limit, 367); assert.equal(h.calls[1].limit, 60);
  assert.deepEqual(h.calls[1].filters[0].slice(0, 2), ['date', 'in']);
  assert.ok(h.service.events.every(event => event.id === event.date));
  const calls = h.calls.length; await h.service.loadDayNames(h.service.events.map(event => event.date)); assert.equal(h.calls.length, calls);
  h.service.ngOnDestroy();
});

test('track filters use canonical metadata for every recorded day, ignoring metadata without recordings', async () => {
  const h = client(new Map(recording().records));
  h.records.set(ROOT + '/events/' + day, { ...savedEvent(day), location: 'Castle Combe', locationKey: 'castle combe' });
  h.records.set(ROOT + '/events/no-recording', { ...savedEvent('no-recording', '2026-06-15'), location: 'Castle Combe', locationKey: 'castle combe' });
  await h.service.loadEvents(true, filters('', ' Castle  Combe '));
  assert.equal(h.calls.length, 2); assert.equal(h.calls[0].path, ROOT + '/days'); assert.equal(h.calls[0].limit, 367);
  assert.deepEqual(h.service.events.map(event => event.id), [day]); assert.equal(h.service.eventLabel(day), day + ' · ' + day);
  h.service.ngOnDestroy();
});


test('a complete leap year loads all 366 days and metadata in fourteen queries, including late track matches', async () => {
  const h = client();
  for (let i = 0; i < 366; i++) {
    const date = new Date(Date.UTC(2028, 0, 1 + i)).toISOString().slice(0, 10);
    h.records.set(ROOT + '/days/' + date, { date });
    h.records.set(ROOT + '/events/' + date, { ...savedEvent(date, date), locationKey: date.endsWith('01-01') ? 'target' : 'elsewhere' });
  }
  await h.service.loadEvents(true, { ...filters('', 'Target'), from: '2028-01-01', to: '2028-12-31' });
  assert.equal(h.service.listError, ''); assert.deepEqual(h.service.events.map(event => event.id), ['2028-01-01']);
  assert.equal(h.calls.length, 14); assert.equal(h.calls[0].limit, 367);
  assert.ok(h.calls.slice(1).every(call => call.limit === 60 && call.filters[0][2].length <= 30));
  await h.service.loadEvents(true, { ...filters(), from: '2028-01-01', to: '2028-12-31' });
  assert.equal(h.service.events.length, 366); assert.equal(h.calls.length, 28);
  await h.service.loadEvents(true, { ...filters(), from: '2028-01-01', to: '2029-12-31' });
  assert.equal(h.calls.length, 28); assert.equal(h.service.listError, 'Choose a valid year.');
  h.service.ngOnDestroy();
});

test('empty years stop after one query; metadata failures keep date choices and retry only on request', async () => {
  const h = client(); await h.service.loadEvents(true, filters());
  assert.deepEqual(h.service.events, []); assert.equal(h.calls.length, 1);
  h.records.set(ROOT + '/days/' + day, { date: day });
  const sub = h.service.changed.subscribe(() => { if (h.service.loadingEvents && h.service.events.length) h.fail(true); });
  await h.service.loadEvents(true, filters()); sub.unsubscribe();
  assert.equal(h.service.events.length, 1); assert.match(h.service.listError, /Could not load/);
  const count = h.calls.length; await flush(); assert.equal(h.calls.length, count);
  h.fail(false); await h.service.loadEvents(); assert.equal(h.service.listError, '');
  assert.equal(h.calls.length, count + 2); h.service.ngOnDestroy();
});

test('changing year during a metadata batch discards its results and prevents further old-year batches', async () => {
  const h = client(); let release;
  for (let i = 1; i <= 31; i++) { const date = '2026-07-' + String(i).padStart(2, '0'); h.records.set(ROOT + '/days/' + date, { date }); }
  const sub = h.service.changed.subscribe(() => {
    if (h.service.events.length === 31) { sub.unsubscribe(); h.delay(() => new Promise(resolve => release = resolve)); }
  });
  const old = h.service.loadEvents(true, filters()); await flush(); assert.equal(h.calls.length, 2);
  await h.service.loadEvents(true, { ...filters(), from: '2027-01-01', to: '2027-12-31' });
  release({ docs: [], size: 0 }); await old;
  assert.equal(h.calls.length, 3); assert.deepEqual(h.service.events, []); assert.equal(h.service.loadingEvents, false);
  h.service.ngOnDestroy();
});

test('whole events load without saved metadata; typed sessions paginate and account changes clear listeners', async () => {
  const h = client(new Map(recording().records)), changes = [];
  h.service.recordingChanged.subscribe(value => changes.push(value));
  await h.service.selectEvent(day); await flush(); assert.equal(h.service.eventReady, true); assert.equal(h.service.selectedEvent.revision, 0);
  h.records.set(ROOT + '/sessions/race', { ...session(day, [recording().segment()]), type: 'race', id: 'race', revision: 1, updatedBy: 'admin' });
  h.records.set(ROOT + '/sessions/practice', { ...session(day, [recording().segment()]), type: 'practice', id: 'practice', revision: 1, updatedBy: 'admin' });
  await h.service.loadEvents(true, filters('race')); await flush();
  assert.deepEqual(h.service.sessions.map(session => session.id), ['race']);
  const query = h.calls.findLast(call => call.path.endsWith('/sessions')); assert.equal(query.limit, 30);
  assert.deepEqual(query.filters, [['eventId', '==', day], ['type', '==', 'race']]);
  h.service.selectSession('race'); await flush(); assert.equal(changes.at(-1).id, 'race');
  const active = h.listeners.filter(listener => listener.active); assert.equal(active.length, 2);
  h.state.next({ ready: true, uid: '', isAdmin: false }); assert.equal(h.service.selectedSession, undefined);
  assert.ok(h.listeners.every(listener => !listener.active)); assert.deepEqual(h.service.events, []); h.service.ngOnDestroy();
});

test('late pages and selections are cancelled; failures retain retry cursors without automatic retries', async () => {
  const h = client(new Map(recording().records)); let release;
  h.delay(() => new Promise(resolve => release = resolve));
  const loading = h.service.loadEvents(true, filters()); h.state.next({ ready: true, uid: '', isAdmin: false });
  release({ docs: [], size: 0 }); await loading; assert.deepEqual(h.service.events, []);
  h.state.next({ ready: true, uid: 'other', isAdmin: true }); h.fail(true);
  await h.service.loadEvents(true, filters()); assert.match(h.service.listError, /Could not load/);
  const calls = h.calls.length; await flush(); assert.equal(h.calls.length, calls);
  h.fail(false); await h.service.loadEvents(); assert.equal(h.service.events.length, 1); h.service.ngOnDestroy();
});

test('session edits preserve exact zoom boundaries, engineering fields and identity', async () => {
  const h = await editorHarness(), range = recording().segment(1, 2);
  h.editor.session(); h.editor.draft.notes = 'Reviewed'; h.editor.draft.type = 'race'; h.telemetry.range = () => [range];
  h.editor.replaceRange({ start: range.firstAt, end: range.lastAt }); h.editor.review(); assert.equal(h.calls.length, 0);
  await h.editor.save(); const saved = h.backend.records.get(ROOT + '/sessions/s');
  assert.equal(saved.type, 'race'); assert.equal(saved.notes, 'Reviewed'); assert.deepEqual(saved.segments, [range]);
  assert.equal(h.calls[0].sessions[0].id, 's'); assert.equal(h.backend.records.get(ROOT + '/events/' + day).sessionCount, 1);
  h.destroy();
});

test('new sessions need a type and remain within the selected event day; rejected captures retain the draft', async () => {
  const h = await editorHarness(); h.editor.session(true); h.editor.draft.name = 'Practice'; h.editor.review(); assert.match(h.editor.error, /type/);
  const before = structuredClone(h.editor.draft.segments); h.telemetry.range = () => [recording('2026-06-15').segment()];
  h.editor.addRange({ start: 0, end: 1 }); assert.match(h.editor.error, /UK day/); assert.deepEqual(h.editor.draft.segments, before);
  h.editor.draft.type = 'practice'; h.editor.review(); await h.editor.save(); assert.equal(h.calls.length, 1);
  assert.equal(h.backend.records.get(ROOT + '/events/' + day).sessionCount, 2); h.destroy();
});

test('an unnamed day can save its first session and event metadata atomically', async () => {
  const h = await editorHarness(); h.backend.records.delete(ROOT + '/events/' + day); h.backend.records.delete(ROOT + '/sessions/s');
  await h.service.selectEvent(day); await flush(); h.editor.session(true); h.editor.draft.name = 'First run'; h.editor.draft.type = 'practice';
  h.editor.review(); assert.equal(h.calls.length, 0); await h.editor.save();
  assert.equal(h.backend.records.get(ROOT + '/events/' + day).sessionCount, 1); assert.equal(h.calls[0].events[0].expectedRevision, 0); h.destroy();
});

test('uncertain saves reuse the exact request and conflicts/revocation retain safe UI state', async () => {
  const h = await editorHarness(); h.editor.event(); h.editor.draft.name = 'Changed'; h.editor.review(); h.unknown(); await h.editor.save();
  assert.equal(h.editor.uncertain, true); const writes = h.backend.counts.writes;
  await h.editor.save(); assert.deepEqual(h.calls[0], h.calls[1]); assert.equal(h.backend.counts.writes, writes);
  h.backend.records.get(ROOT + '/events/' + day).revision++;
  h.editor.event(); h.editor.draft.name = 'Preserve'; h.editor.review(); await h.editor.save();
  assert.equal(h.editor.draft.name, 'Preserve'); assert.match(h.editor.error, /changed elsewhere/);
  h.editor.cancel(); h.editor.event(); h.editor.review(); let release; h.delay(new Promise(resolve => release = resolve));
  const saving = h.editor.save(); h.state.next({ ready: true, uid: '', isAdmin: false }); release(); await saving;
  assert.equal(h.editor.mode, ''); assert.equal(h.editor.notice, ''); h.destroy();
});

test('name lookup failures preserve event choices and retry only on explicit request', async () => {
  const h = client(new Map(recording().records)); h.delay(() => Promise.reject(Error('synthetic names failure')));
  await h.service.loadDayNames([day]); assert.match(h.service.dayNamesError, /Could not load/);
  await h.service.loadEvents(true, filters()); assert.deepEqual(h.service.events.map(event => event.id), [day]);
  const calls = h.calls.length; await flush(); assert.equal(h.calls.length, calls);
  h.records.set(ROOT + '/events/' + day, savedEvent(day)); await h.service.loadEvents(true, filters());
  assert.equal(h.service.dayNamesError, ''); assert.equal(h.service.eventLabel(day), day + ' · ' + day); h.service.ngOnDestroy();
});

test('selected listeners ignore cache/stale revisions and metadata-only edits avoid sample reloads', async () => {
  const h = client(new Map(recording().records)); h.records.set(ROOT + '/events/' + day, savedEvent(day));
  const path = ROOT + '/sessions/s', record = { ...session(day, [recording().segment()]), revision: 1, updatedBy: 'admin' };
  h.records.set(path, record); await h.service.selectEvent(day); await flush();
  const changes = []; h.service.recordingChanged.subscribe(value => changes.push({ value, requested: h.service.sessionId }));
  h.service.selectSession('s'); assert.equal(changes[0].requested, 's', 'clear old samples after identifying the requested session, without loading a whole day');
  await flush(); const count = changes.length;
  h.publish(path, { ...record, revision: 2, notes: 'Cached' }, { fromCache: true }); assert.equal(h.service.selectedSession.revision, 1);
  h.publish(path, { ...record, revision: 2, notes: 'Server' }); assert.equal(changes.length, count);
  h.publish(path, record); assert.equal(h.service.selectedSession.revision, 2);
  h.publish(path, { ...record, revision: 3, segments: [{ ...record.segments[0], day: '2026-06-15' }] });
  assert.equal(h.service.selectedSession, undefined); assert.equal(changes.at(-1).value, undefined); h.service.ngOnDestroy();
});

test('legacy track metadata never matches a former track after canonical metadata changes', async () => {
  const h = client(new Map(recording().records));
  h.records.set(ROOT + '/events/legacy', { ...savedEvent('Old track'), locationKey: 'old track' });
  h.records.set(ROOT + '/events/' + day, { ...savedEvent(day), locationKey: 'new track' });
  await h.service.loadEvents(true, filters('', 'Old track')); assert.deepEqual(h.service.events, []); assert.equal(h.calls.length, 2);
  await h.service.loadEvents(true, filters('', 'New track')); assert.deepEqual(h.service.events.map(event => event.id), [day]); h.service.ngOnDestroy();
});


test('historical original-ID metadata names every recorded day and supports track filtering before migration', async () => {
  const h = client(new Map(recording().records));
  h.records.set(ROOT + '/events/historical-dyno', { ...savedEvent('Workshop dyno'), locationKey: 'workshop' });
  await h.service.loadEvents(true, filters());
  assert.equal(h.service.listError, ''); assert.equal(h.service.eventLabel(day), day + ' · Workshop dyno');
  await h.service.selectEvent(day); await flush();
  assert.equal(h.service.selectedEvent.revision, 0, 'no migration or fabricated persisted event');
  assert.equal(h.service.selectedEvent.name, 'Workshop dyno');
  assert.equal(h.service.selectedEvent.locationKey, 'workshop');
  assert.equal(eventData.recordedEventName(day, h.service.dayContext(day).events), 'Workshop dyno');
  await h.service.loadEvents(true, filters('', 'Workshop'));
  assert.deepEqual(h.service.events.map(event => event.id), [day]);
  h.service.ngOnDestroy();
});

test('full-year metadata refresh replaces stale names and detects crowded pages without claiming completeness', async () => {
  const h = client(new Map(recording().records));
  h.records.set(ROOT + '/events/old', savedEvent('Old name'));
  await h.service.loadEvents(true, filters()); assert.match(h.service.eventLabel(day), /Old name/);
  h.records.delete(ROOT + '/events/old'); h.records.set(ROOT + '/events/new', savedEvent('New name'));
  await h.service.loadEvents(true, filters()); assert.equal(h.service.eventLabel(day), day + ' · New name');
  for(let i=0;i<60;i++)h.records.set(ROOT + '/events/crowded-'+i, savedEvent('Crowded '+i));
  await h.service.loadEvents(true, filters()); assert.match(h.service.listError, /Could not load all event names/);
  assert.equal(h.service.loadedEvents, false); assert.equal(h.service.events.length, 1);
  h.service.ngOnDestroy();
});


test('sessions save without a name control, derive new labels from type and retain existing hidden metadata', async () => {
  const h = await editorHarness();
  h.editor.session(true); h.editor.draft.type = 'practice';
  assert.equal(h.editor.draft.name, ''); h.editor.review(); assert.equal(h.editor.error, '');
  assert.equal(h.editor.draft.name, 'Practice'); await h.editor.save();
  const created = h.calls.at(-1).sessions[0]; assert.equal(created.data.name, 'Practice');
  const existing = h.backend.records.get(ROOT + '/sessions/s');
  Object.assign(existing, { name: 'Historical run', runNumber: 7, operator: 'Historical operator', tags: ['original'], description: 'Historical description' });
  h.publish(ROOT + '/sessions/s', existing); h.service.selectSession('s'); await flush();
  h.editor.session(); h.editor.draft.notes = 'Updated notes'; h.editor.review(); assert.equal(h.editor.error, ''); await h.editor.save();
  const saved = h.backend.records.get(ROOT + '/sessions/s');
  for(const key of ['name','runNumber','operator','tags','description'])assert.deepEqual(saved[key], existing[key], key);
  assert.equal(saved.notes, 'Updated notes'); h.destroy();
});


test('historical day drafts retain source metadata and ambiguous days cannot create replacement metadata', async () => {
  const h = await editorHarness();
  const legacy = { ...h.backend.records.get(ROOT + '/events/' + day), name: 'Historical event', notes: 'Keep notes', description: 'Keep description', engineering: { batteryIds: ['original'] } };
  h.records.delete(ROOT + '/events/' + day); h.records.set(ROOT + '/events/historical', legacy);
  await h.service.loadEvents(true, filters()); await h.service.selectEvent(day); await flush();
  h.editor.event(); assert.equal(h.editor.draft.name, 'Historical event'); assert.equal(h.editor.draft.notes, 'Keep notes');
  assert.deepEqual(h.editor.draft.engineering, { batteryIds: ['original'] }); h.editor.cancel();
  h.records.set(ROOT + '/events/another', { ...legacy, name: 'Another historical event' });
  await h.service.loadEvents(true, filters());
  h.editor.event(); assert.equal(h.editor.mode, ''); assert.match(h.editor.error, /Review this day/); assert.equal(h.calls.length, 0);
  h.destroy();
});
