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
        assert.ok(spec.limit > 0 && spec.limit <= 100); calls.push({ path, ...spec });
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

test('metadata pages are explicit, server-only, filtered and limited; sign-out cancels stale responses', async () => {
  const h = client();
  for (let i = 0; i < 65; i++) { const id = 'event-' + String(i).padStart(2, '0'); h.records.set(ROOT + '/events/' + id, { ...savedEvent(id), location: 'Castle Combe', locationKey: 'castle combe' }); }
  assert.equal(h.calls.length, 0);
  await h.service.loadEvents(); assert.equal(h.service.events.length, 30); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].limit, 30);
  await h.service.loadEvents(); assert.equal(h.service.events.length, 60); assert.equal(h.calls.length, 2);
  await h.service.loadEvents(true, { type: 'full_dyno', location: ' Castle  Combe ', from: '2026-06-01', to: '2026-06-30' });
  assert.equal(h.service.events.length, 30); assert.deepEqual(h.calls.at(-1).filters.map(f => f[2]), ['full_dyno', 'castle combe', '2026-06-01', '2026-06-30']);
  let release; h.delay(() => new Promise(resolve => release = resolve));
  const loading = h.service.loadEvents(); h.state.next({ uid: '', ready: true, isAdmin: false });
  release({ docs: [], size: 0 }); await loading;
  assert.deepEqual(h.service.events, []); assert.equal(h.service.loadingEvents, false);
  const count = h.calls.length; await h.service.loadEvents(); assert.equal(h.calls.length, count); h.service.ngOnDestroy();
});

test('recorded-day names query only listed dates, independently of filtered event pages, and reuse loaded names', async () => {
  const h = client();
  for (const [id, day] of [['Goodwood finals', '2026-10-18'], ['Morning test', '2026-06-14'], ['Afternoon test', '2026-06-14'], ['Unrelated event', '2026-10-19']]) {
    h.records.set(ROOT + '/events/' + id.replaceAll(' ', '-'), savedEvent(id, day));
  }
  await h.service.loadEvents(true, { type: 'race', location: '', from: '', to: '' });
  h.calls.length = 0;
  const days = ['2026-10-18', '2026-06-14', '2026-05-01'];
  await h.service.loadDayNames(days);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].limit, 60);
  assert.deepEqual(h.calls[0].filters, [['date', 'in', days]]);
  assert.equal(h.service.dayLabel(days[0]), '2026-10-18 · Goodwood finals');
  assert.equal(h.service.dayLabel(days[1]), '2026-06-14 · Afternoon test / Morning test');
  assert.equal(h.service.dayLabel(days[2]), '2026-05-01 · No event');
  await h.service.loadDayNames(days); assert.equal(h.calls.length, 1);
  assert.equal(h.service.moreDayNames(days), false); h.service.ngOnDestroy();
});

test('crowded recorded dates stop at 60 names and require explicit continuation; additional dates stay available', async () => {
  const h = client(), days = Array.from({ length: 31 }, (_, i) => '2026-06-' + String(i + 1).padStart(2, '0')).filter(day => day !== '2026-06-31');
  days.push('2026-07-01');
  for (let i = 0; i < 61; i++) h.records.set(ROOT + '/events/event-' + i, savedEvent('Run ' + i, days[0]));
  await h.service.loadDayNames(days);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].filters[0][2].length, 30);
  assert.ok(h.service.dayLabel(days[0]).endsWith(' / …')); assert.equal(h.service.moreDayNames(days), true);
  await h.service.loadDayNames(days, true); assert.equal(h.calls.length, 2); assert.ok(!h.service.dayLabel(days[0]).endsWith(' / …'));
  assert.equal(h.service.dayLabel(days.at(-1)), '2026-07-01 · Events not loaded');
  await h.service.loadDayNames(days, true); assert.equal(h.calls.length, 3);
  assert.equal(h.service.dayLabel(days.at(-1)), '2026-07-01 · No event'); assert.equal(h.service.moreDayNames(days), false);
  h.service.ngOnDestroy();
});

test('recorded-day name errors preserve date choices, retry explicitly, update edits and clear stale account data', async () => {
  const h = client(new Map([[ROOT + '/events/e', savedEvent('Original')]])), days = ['2026-06-14'];
  h.fail(true); await h.service.loadDayNames(days);
  assert.match(h.service.dayLabel(days[0]), /Events unavailable/); assert.match(h.service.dayNamesError, /Could not/);
  h.fail(false); await h.service.loadDayNames(days, true);
  h.service.acknowledge(request('rename', [eventChange('e', 1, { ...event('Renamed'), date: '2026-06-14' })]), { events: [{ id: 'e', revision: 2 }], sessions: [] }, []);
  assert.equal(h.service.dayLabel(days[0]), '2026-06-14 · Renamed');
  const next = ['2026-06-15']; let release;
  h.delay(() => new Promise(resolve => release = resolve)); const loading = h.service.loadDayNames(next);
  h.state.next({ uid: 'other-viewer', ready: true, isAdmin: false });
  release({ docs: [{ id: 'old-account', data: () => savedEvent('Private old event', next[0]) }], size: 1 }); await loading;
  assert.equal(h.service.dayLabel(days[0]), '2026-06-14 · Events not loaded');
  assert.equal(h.service.dayLabel(next[0]), '2026-06-15 · Events not loaded'); assert.equal(h.service.dayNamesLoading, false);
  h.service.ngOnDestroy();
});

test('a directly opened day reuses names or makes one bounded lookup; repeated updates never retry errors', async () => {
  const h = client(new Map([[ROOT + '/events/e', savedEvent('Direct day event')]]));
  h.service.setRecordedDay('2026-06-14'); await flush();
  assert.equal(h.calls.length, 1); assert.equal(h.service.dayContext('2026-06-14').events[0].name, 'Direct day event');
  h.service.setRecordedDay('2026-06-14'); await flush(); assert.equal(h.calls.length, 1);
  h.fail(true); h.service.setRecordedDay('2026-06-15'); await flush();
  assert.equal(h.service.dayContext('2026-06-15').failed, true);
  h.service.setRecordedDay('2026-06-15'); await flush(); assert.equal(h.calls.length, 2);
  h.fail(false); await h.service.loadDayNames(['2026-06-16']);
  assert.equal(h.service.dayContext('2026-06-15').failed, true, 'another page cannot clear this day’s failure');
  const reads = h.calls.length; h.service.ngOnDestroy();
  h.service.setRecordedDay('2026-06-17'); await h.service.loadDayNames(['2026-06-17']);
  assert.equal(h.calls.length, reads, 'destroyed contexts cannot start reads');
});

test('only the latest direct day waits for an in-flight page; switching to live cancels queued lookup', async () => {
  const h = client(); let release;
  h.delay(() => new Promise(resolve => release = resolve)); const page = h.service.loadDayNames(['2026-06-14']);
  h.service.setRecordedDay('2026-06-15'); h.service.setRecordedDay('2026-06-16');
  release({ docs: [], size: 0 }); await page; await flush();
  assert.equal(h.calls.length, 2); assert.deepEqual(h.calls[1].filters[0][2], ['2026-06-16']);
  h.delay(() => new Promise(resolve => release = resolve)); const nextPage = h.service.loadDayNames(['2026-06-17']);
  h.service.setRecordedDay('2026-06-18'); h.service.setRecordedDay('');
  release({ docs: [], size: 0 }); await nextPage; await flush(); assert.equal(h.calls.length, 3);
  h.service.ngOnDestroy();
});

test('selected listeners ignore cache/stale revisions and only changed ranges request a new recording', async () => {
  const rec = recording(), e = { ...savedEvent('e'), sessionCount: 2 };
  const h = client(new Map([[ROOT + '/events/e', e], ...['a', 'b'].map((id, index) => [ROOT + '/sessions/' + id, { ...session('e', [rec.segment(index * 2, index * 2 + 1)]), id, revision: 1, updatedBy: 'admin' }])]));
  const selections = []; h.service.recordingChanged.subscribe(value => selections.push(value?.id));
  h.service.selectEvent('e'); await flush(); assert.equal(h.service.sessions.length, 2);
  h.service.selectSession('a'); await flush(); assert.equal(selections.at(-1), 'a');
  const before = selections.length, a = h.records.get(ROOT + '/sessions/a');
  h.publish(ROOT + '/sessions/a', { ...a, revision: 2, notes: 'new' }); assert.equal(selections.length, before);
  h.publish(ROOT + '/sessions/a', { ...a, revision: 1 }); assert.equal(h.service.selectedSession.revision, 2);
  h.publish(ROOT + '/sessions/a', { ...a, revision: 3, name: 'cache secret' }, { fromCache: true }); assert.notEqual(h.service.selectedSession.name, 'cache secret');
  h.service.selectSession('b'); await flush(); assert.equal(selections.at(-1), 'b');
  assert.equal(h.listeners.filter(l => l.active).length, 2);
  h.service.ngOnDestroy(); assert.equal(h.listeners.filter(l => l.active).length, 0);
});

test('invalid records and failed pages retain retry boundaries without scans or automatic retries', async () => {
  const h = client(new Map([[ROOT + '/events/bad', { ...savedEvent('bad'), provenance: {} }]]));
  await h.service.loadEvents(); assert.equal(h.service.events.length, 0); assert.match(h.service.listError, /invalid/); assert.equal(h.calls.length, 1);
  h.records.set(ROOT + '/events/bad', savedEvent('bad')); h.fail(true);
  await h.service.loadEvents(); assert.equal(h.calls.length, 2); assert.match(h.service.listError, /Could not/);
  h.fail(false); await h.service.loadEvents(); assert.equal(h.service.events.length, 1); h.service.ngOnDestroy();
});

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
  await editMetadata(backend, adminAuth, request('setup', [eventChange('e'), eventChange('target')], [sessionChange('s', session('e', [rec.segment()]))]), options);
  const h = client(backend.records); h.service.selectEvent('e'); await flush(); h.service.selectSession('s'); await flush(); await h.service.loadEvents();
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

test('session edits/reassignment use the callable, preserve fields and never save shared view settings', async () => {
  const h = await editorHarness(); h.editor.session(); h.editor.draft.notes = ' reviewed '; h.editor.targetEventId = 'target';
  h.editor.review(); assert.equal(h.calls.length, 0); assert.equal(h.editor.reviewing, true);
  await h.editor.save();
  assert.equal(h.calls[0].action, 'reassign'); assert.equal(h.backend.records.get(ROOT + '/sessions/s').notes, 'reviewed');
  assert.equal(h.backend.records.get(ROOT + '/events/e').sessionCount, 0); assert.equal(h.backend.records.get(ROOT + '/events/target').sessionCount, 1);
  assert.equal(h.editor.notice, 'Saved'); assert.equal(h.calls[0].events.length, 2); h.destroy();
});

test('uncertain completed saves reuse the exact request and do not duplicate metadata or counters', async () => {
  const h = await editorHarness(); h.editor.event(true); Object.assign(h.editor.draft, { name: 'Reviewed new event', type: 'full_dyno' });
  h.editor.review(); h.unknown(); await h.editor.save();
  assert.equal(h.editor.uncertain, true); assert.equal(h.editor.reviewing, true); const writes = h.backend.counts.writes;
  await h.editor.save(); assert.deepEqual(h.calls[0], h.calls[1]); assert.equal(h.backend.counts.writes, writes); assert.equal(h.editor.notice, 'Saved'); h.destroy();
});

test('conflicts preserve the draft and revocation during save cannot expose an old-account result', async () => {
  const h = await editorHarness(); h.editor.event(); h.editor.draft.name = 'Draft preserved'; h.editor.review();
  const current = h.backend.records.get(ROOT + '/events/e'); h.backend.records.set(ROOT + '/events/e', { ...current, revision: current.revision + 1 });
  await h.editor.save(); assert.equal(h.editor.draft.name, 'Draft preserved'); assert.match(h.editor.error, /changed elsewhere/); assert.equal(h.editor.uncertain, false);
  h.editor.cancel(); h.editor.event(true); Object.assign(h.editor.draft, { name: 'New', type: 'other' }); h.editor.review();
  let release; h.delay(new Promise(resolve => release = resolve)); const saving = h.editor.save();
  h.state.next({ ready: true, uid: '', isAdmin: false }); release(); await saving;
  assert.equal(h.editor.mode, ''); assert.equal(h.editor.notice, ''); assert.equal(h.service.selectedEvent, undefined); h.destroy();
});

test('new sessions require reviewed zoom capture; split creates a separate event without changing session identity', async () => {
  const h = await editorHarness(); h.editor.session(true); h.editor.draft.name = 'Manual reviewed run'; h.editor.review();
  assert.equal(h.calls.length, 0); await h.editor.save(); assert.equal(h.backend.records.get(ROOT + '/events/e').sessionCount, 2);
  h.service.selectSession('s'); await flush(); h.editor.session(); h.editor.split(); Object.assign(h.editor.splitDraft, { name: 'Separate dyno event', type: 'full_dyno' }); h.editor.review(); await h.editor.save();
  assert.equal(h.calls.at(-1).action, 'split'); assert.equal(h.calls.at(-1).sessions[0].id, 's'); assert.notEqual(h.backend.records.get(ROOT + '/sessions/s').eventId, 'e'); h.destroy();
});

test('a first session can start from an empty event or a recorded day, then append another UK day', async () => {
  const h = await editorHarness(), first = recording(), second = recording('2026-06-15');
  second.records.forEach(([path, value]) => h.backend.records.set(path, value));
  h.service.clear();
  h.telemetry.range = () => { throw new Error('No recorded range loaded.'); };
  h.editor.session(true); assert.equal(h.editor.mode, 'session'); assert.deepEqual(h.editor.draft.segments, []);
  h.editor.targetEventId = 'target'; h.editor.draft.name = 'Reviewed overnight session'; h.editor.review();
  assert.match(h.editor.error, /range/); assert.equal(h.calls.length, 0);
  h.telemetry.range = () => [first.segment()]; h.editor.replaceRange({ start: 0, end: 1 });
  h.telemetry.range = () => [second.segment()]; h.editor.addRange({ start: 0, end: 1 });
  assert.equal(h.editor.draft.segments.length, 2); h.editor.review(); await h.editor.save();
  const change = h.calls.at(-1).sessions[0]; assert.equal(change.data.eventId, 'target'); assert.equal(change.data.segments.length, 2);
  assert.equal(h.backend.records.get(ROOT + '/events/target').sessionCount, 1); h.destroy();
});

test('merge review moves only explicitly selected sessions and clears a moved selection immediately', async () => {
  const h = await editorHarness(); h.editor.merge(); h.editor.targetEventId = 'target';
  h.editor.toggle(h.service.selectedSession, true); h.editor.review(); assert.equal(h.calls.length, 0);
  await h.editor.save(); const change = h.calls[0];
  assert.equal(change.action, 'merge'); assert.equal(change.sessions.length, 1);
  assert.equal(h.backend.records.get(ROOT + '/events/e').state, 'superseded');
  assert.equal(h.backend.records.get(ROOT + '/events/target').sessionCount, 1);
  assert.equal(h.service.selectedSession, undefined); h.destroy();
});

test('editing a superseded event includes its bounded successor revisions without changing the links', async () => {
  const h = await editorHarness(); h.editor.merge(); h.editor.targetEventId = 'target';
  h.editor.toggle(h.service.selectedSession, true); h.editor.review(); await h.editor.save(); await flush();
  h.service.events = []; const priorReads = h.calls.length;
  await h.editor.event(); assert.equal(h.editor.loadingReferences, false);
  h.editor.draft.notes = 'Historical event notes'; h.editor.review(); await h.editor.save();
  const input = h.calls[priorReads]; assert.equal(input.events.length, 2);
  assert.deepEqual(h.backend.records.get(ROOT + '/events/e').supersededBy, ['target']);
  assert.equal(h.backend.records.get(ROOT + '/events/e').notes, 'Historical event notes'); h.destroy();
});
