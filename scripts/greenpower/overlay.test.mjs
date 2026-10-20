import assert from 'node:assert/strict';
import test from 'node:test';
import { BehaviorSubject, Subject, Subscription } from 'rxjs';
import { load, data, dayData, gps, tracks, lapMetrics, motorSpeed, recordings } from './load.mjs';

const sessions = load('../../src/app/greenpower-telemetry/greenpowerSessions.ts', {
  './greenpowerDay': dayData, './greenpowerData': data, './greenpowerGps': gps
});
const overlay = load('../../src/app/greenpower-telemetry/greenpowerOverlay.ts', {
  './greenpowerData': data, './greenpowerDay': dayData, './greenpowerSessions': sessions, './greenpowerGps': gps, './greenpowerTracks': tracks, './greenpowerLapMetrics': lapMetrics, './greenpowerSpeed': motorSpeed
});
const { GreenpowerOverlayService } = load('../../src/app/greenpower-telemetry/greenpowerOverlay.service.ts', {
  '@angular/core': { Injectable: () => target => target }, rxjs: { Subject },
  'firebase/compat/app': { default: { firestore: { FieldPath: { documentId: () => '__name__' } } } },
  'firebase/compat/firestore': {}, './greenpowerData': data, './greenpowerDay': dayData,
  './greenpowerRecording': recordings, './greenpowerTracks': tracks, './greenpowerOverlay': overlay
});
const { GreenpowerOverlayComponent } = load('../../src/app/greenpower-telemetry/greenpower-overlay.component.ts', {
  '@angular/core': { Component: () => target => target, Input: () => () => {} }, rxjs: { Subscription }, './greenpowerData': data
});
const ROOT = dayData.SESSION_SCOPE, date = '2026-06-14';
function fixture(count = 3, chunksPerSession = 1) {
  const records = new Map(), calls = [];
  const state = new BehaviorSubject({ uid: 'viewer', ready: true });
  records.set(`${ROOT}/days/${date}`, { ...dayData.emptyDay(date), defaults: { driver: 'Default driver' }, eventName: 'Goodwood' });
  for (let index = 0; index < count; index++) {
    const startAt = Date.parse(date + 'T08:00:00Z') + index * 1000000;
    const id = `race-${index}`, first = index * chunksPerSession, last = first + chunksPerSession - 1;
    const chunkId = value => String(value).padStart(10, '0');
    for (let chunk = first; chunk <= last; chunk++) {
      const time = startAt + (chunk - first) * 1000;
      records.set(`${ROOT}/days/${date}/chunks/${chunkId(chunk)}`, { bytes: 100, samples: [
        { id: `sample-${chunk}`, receivedAt: time, source: '424-phone', raw: JSON.stringify({ A: index + 10, AH: 20 + chunk - first }) }
      ] });
    }
    const endAt = startAt + (chunksPerSession - 1) * 1000;
    records.set(`${ROOT}/days/${date}/sessions/${id}`, { id, schemaVersion: 2, revision: 1, updatedBy: 'admin',
      telemetryRoot: ROOT, type: 'race', startAt, endAt, overrides: index === 1 ? { driver: 'Override driver' } : {}, batteryIds: [],
      ranges: [{ day: date, source: '424-phone', firstChunk: chunkId(first), lastChunk: chunkId(last), firstIndex: 0, lastIndex: 0,
        firstSampleId: `sample-${first}`, lastSampleId: `sample-${last}`, firstAt: startAt, lastAt: endAt }] });
  }
  let delay, fail = false;
  function snapshot(path) { return { id: path.split('/').at(-1), ref: ref(path), data: () => structuredClone(records.get(path)) }; }
  function ref(path, spec = { filters: [], order: [] }) {
    return { path, id: path.split('/').at(-1), get parent() { return ref(path.split('/').slice(0, -1).join('/')); },
      doc: id => ref(path + '/' + id), collection: id => ref(path + '/' + id),
      where: (...filter) => ref(path, { ...spec, filters: [...spec.filters, filter] }),
      orderBy: field => ref(path, { ...spec, order: [...spec.order, field] }),
      limit: limit => ref(path, { ...spec, limit }), startAt: first => ref(path, { ...spec, first }),
      endAt: last => ref(path, { ...spec, last }), startAfter: after => ref(path, { ...spec, after }),
      async get(source) {
        assert.equal(source.source, 'server'); calls.push({ path, ...spec });
        if (delay && path.endsWith('/chunks')) { const pause = delay; delay = undefined; await pause; }
        if (fail && path.endsWith('/chunks')) throw new Error('Synthetic failure');
        if (path !== 'group:sessions' && path.split('/').length % 2 === 0) return snapshot(path);
        assert.ok(spec.limit > 0);
        const field = (doc, key) => key === '__name__' ? doc.ref.path : doc.data()[key];
        let docs = [...records.keys()].filter(key => path === 'group:sessions' ? key.includes('/sessions/') : key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/')).map(snapshot)
          .filter(doc => spec.filters.every(([key, op, value]) => op === '==' ? field(doc, key) === value : op === '>=' ? field(doc, key) >= value : field(doc, key) < value))
          .sort((a, b) => { for (const key of spec.order) { const x = field(a, key), y = field(b, key); if (x !== y) return x < y ? -1 : 1; } return 0; });
        if (spec.after) docs = docs.slice(docs.findIndex(doc => typeof spec.after === 'string' ? doc.id === spec.after : doc.ref.path === spec.after.ref.path) + 1);
        docs = docs.filter(doc => (!spec.first || doc.id >= spec.first) && (!spec.last || doc.id <= spec.last)).slice(0, spec.limit);
        return { docs, size: docs.length };
      }
    };
  }
  const db = { collection: ref, collectionGroup: name => ref('group:' + name) };
  const service = new GreenpowerOverlayService({ firestore: db }, { state });
  return { service, state, calls, records, db, pause(promise) { delay = promise; }, fail(value) { fail = value; } };
}

test('year query selects only canonical 2026 races, inherits labels, rebases time and amp hours, and toggles visibility locally', async () => {
  const h = fixture(3, 3);
  const original = structuredClone(h.records);
  const source = h.records.get(`${ROOT}/days/${date}/sessions/race-0`);
  for (const [id, changes] of [['practice', { type: 'practice' }], ['old-year', { startAt: Date.UTC(2025, 0, 1) }], ['legacy', { schemaVersion: 1 }]]) {
    h.records.set(`${ROOT}/days/${date}/sessions/${id}`, { ...source, id, ...changes });
  }
  await h.service.load(true);
  assert.equal(h.service.sessions.length, 3); assert.equal(h.service.hasMore, false);
  assert.ok(h.service.sessions.every(item => item.loaded));
  assert.equal(h.service.sessions[0].label, date + ' · Goodwood · Default driver');
  assert.match(h.service.sessions[1].label, /Goodwood · Override driver/);
  assert.equal(new Set(h.service.sessions.map(item => item.colour)).size, 3);
  const ampHours = h.service.sessions[0].channels.find(channel => channel.unit === 'Ah');
  assert.deepEqual(ampHours.points, [{ time: 0, value: 0 }, { time: 1000, value: 1 }, { time: 2000, value: 2 }]);
  const query = h.calls[0]; assert.equal(query.limit, 30);
  assert.deepEqual(query.filters.slice(0, 3), [['telemetryRoot', '==', ROOT], ['schemaVersion', '==', 2], ['type', '==', 'race']]);
  assert.equal(h.calls.filter(call => call.path === `${ROOT}/days/${date}`).length, 1, 'reuse event defaults');
  const before = h.calls.length, first = h.service.sessions[0];
  h.service.toggleVisibility(first.id);
  assert.equal(h.calls.length, before); assert.equal(h.service.sessions.length, 3);
  assert.equal(h.service.sessions[0].hidden, true); assert.equal(h.service.visibleSessions.length, 2);
  assert.equal(h.service.sessions[0].channels, first.channels); assert.equal(h.service.sessions[0].colour, first.colour);
  h.service.loading = true;
  h.service.toggleVisibility(first.id);
  h.service.loading = false;
  assert.equal(h.service.sessions[0].hidden, false); assert.equal(h.service.visibleSessions.length, 3);
  assert.equal(h.service.sessions[0].channels, first.channels); assert.equal(h.calls.length, before);
  for (const item of h.service.sessions) h.service.toggleVisibility(item.id);
  assert.equal(h.service.visibleSessions.length, 0); assert.equal(h.service.sessions.length, 3);
  assert.equal(h.calls.length, before); assert.equal(h.service.end, 2000);
  for (const [path, value] of original) assert.deepEqual(h.records.get(path), value, 'source data is untouched');
  h.service.ngOnDestroy();
});

test('metadata pagination needs an explicit action and preserves hidden sessions', async () => {
  const h = fixture(31);
  await h.service.load(true);
  assert.equal(h.service.sessions.length, 30); assert.equal(h.service.hasMore, true);
  h.service.toggleVisibility(h.service.sessions[0].id);
  await h.service.load();
  assert.equal(h.service.sessions.length, 31); assert.equal(h.service.hasMore, false);
  assert.equal(h.service.sessions[0].hidden, true);
  assert.equal(h.calls.filter(call => call.path === 'group:sessions').length, 2);
  h.service.ngOnDestroy();
});

test('50 pages are shared across all sessions and continuation finishes the queued page before fetching more metadata', async () => {
  const h = fixture(30, 200);
  await h.service.load(true);
  assert.equal(h.service.sessions.filter(item => item.loaded).length, 25);
  assert.equal(h.calls.filter(call => call.path.endsWith('/chunks')).length, 50);
  assert.equal(h.service.hasMore, true); assert.ok(h.service.cache.size <= 100);
  await h.service.load();
  assert.equal(h.service.sessions.filter(item => item.loaded).length, 30);
  assert.equal(h.calls.filter(call => call.path === 'group:sessions').length, 1);
  h.service.ngOnDestroy();
});

test('a shared byte budget stops the next reader before another request', async () => {
  const h = fixture(2);
  const values = [...h.records].filter(([path]) => path.includes('/sessions/')).map(([, session]) => session);
  const budget = { pages: 50, bytes: data.MAX_CHUNK_WIRE_BYTES };
  const readers = values.map(session => new recordings.RecordingReader(h.db.collection(ROOT + '/days'), session.ranges));
  await readers[0].load(() => true, budget); await readers[1].load(() => true, budget);
  assert.equal(h.calls.length, 1); assert.equal(readers[0].more, false); assert.equal(readers[1].more, true);
  h.service.ngOnDestroy();
});

test('account changes discard pending reads and errors can retry without duplicate samples', async () => {
  const h = fixture(2, 3);
  h.fail(true); await h.service.load(true);
  assert.ok(h.service.error); assert.equal(h.service.sessions.filter(item => item.loaded).length, 0);
  h.service.toggleVisibility(h.service.sessions[0].id);
  assert.equal(h.service.sessions[0].hidden, false, 'pending sessions cannot be toggled');
  h.service.toggleInclusion(h.service.sessions[0].id);
  assert.equal(h.service.sessions[0].excluded, false, 'pending sessions cannot be excluded');
  h.fail(false); await h.service.load();
  assert.equal(h.service.error, ''); assert.equal(h.service.sessions[0].channels[0].points.length, 3);
  h.service.clear();
  let resume; h.pause(new Promise(resolve => resume = resolve));
  const loading = h.service.load(true);
  while (!h.calls.at(-1).path.endsWith('/chunks') || !h.service.loading) await Promise.resolve();
  h.state.next({ ready: true, uid: 'other-viewer' }); resume(); await loading;
  assert.equal(h.service.active, false); assert.equal(h.service.sessions.length, 0); assert.equal(h.service.cache.size, 0);
  h.service.ngOnDestroy();
});


test('visibility changes preserve zoom, cursor and loaded data even when every session is hidden', async () => {
  const h = fixture(3, 3);
  const view = { changed: new Subject(), charts: channels => channels };
  const component = new GreenpowerOverlayComponent(h.service, view, { markForCheck() {} });
  await h.service.load(true);
  const window = { start: 500, end: 1500 };
  component.zoom(window); component.cursor = 1000;
  for (const item of h.service.sessions) h.service.toggleVisibility(item.id);
  assert.equal(component.allHidden, true); assert.ok(component.charts.length > 0);
  assert.ok(component.charts.every(chart => chart.traces.every(trace => trace.hidden)));
  assert.equal(component.window, window); assert.equal(component.cursor, 1000);
  h.service.toggleVisibility(h.service.sessions[0].id);
  assert.equal(component.allHidden, false); assert.equal(component.charts[0].traces.filter(trace => !trace.hidden).length, 1);
  assert.equal(component.window, window); assert.equal(component.cursor, 1000);
  component.ngOnDestroy(); h.service.ngOnDestroy();
});


test('main list exclusion and graph hiding are independent and reuse loaded data', async () => {
  const h = fixture(3, 3);
  const component = new GreenpowerOverlayComponent(h.service, { changed: new Subject(), charts: channels => channels }, { markForCheck() {} });
  await h.service.load(true);
  const first = h.service.sessions[0], before = h.calls.length;
  const window = { start: 500, end: 1500 };
  component.zoom(window); component.cursor = 1000;
  h.service.toggleVisibility(first.id);
  h.service.toggleInclusion(first.id);
  assert.ok(component.charts.every(chart => chart.traces.filter(trace => trace.sessionId === first.id).every(trace => trace.hidden && trace.excluded)));
  h.service.toggleInclusion(first.id);
  assert.equal(h.service.sessions[0].hidden, true, 'restoring inclusion preserves graph hiding');
  assert.ok(component.charts.every(chart => chart.traces.filter(trace => trace.sessionId === first.id).every(trace => trace.hidden && !trace.excluded)));
  h.service.toggleVisibility(first.id);
  for (const session of h.service.sessions) h.service.toggleInclusion(session.id);
  assert.equal(component.allHidden, true);
  assert.ok(component.charts.length > 0);
  assert.ok(component.charts.every(chart => chart.traces.every(trace => trace.hidden && trace.excluded)));
  assert.equal(component.window, window); assert.equal(component.cursor, 1000);
  h.service.toggleInclusion(first.id);
  assert.equal(component.allHidden, false);
  assert.equal(h.service.sessions[0].channels, first.channels);
  assert.equal(h.service.sessions[0].colour, first.colour);
  assert.equal(h.calls.length, before, 'toggles never fetch data');
  component.ngOnDestroy(); h.service.ngOnDestroy();
});


test('overlay track reads are exact, cached across sessions and pages, and cleared with the comparison', async () => {
  const h = fixture(31);
  h.records.get(`${ROOT}/days/${date}`).trackId = 'venue';
  h.records.set(`${ROOT}/tracks/venue`, { name: 'Venue', line: null, bounds: null, cells: [], revision: 1, updatedBy: 'admin' });
  await h.service.load(true); await h.service.load();
  const reads = () => h.calls.filter(call => call.path === `${ROOT}/tracks/venue`);
  assert.equal(reads().length, 1, 'one definition read serves all 31 sessions');
  assert.equal(h.service.tracks.size, 1);
  h.service.toggleInclusion(h.service.sessions[0].id);
  h.service.toggleVisibility(h.service.sessions[1].id);
  assert.equal(reads().length, 1);
  h.service.clear();
  assert.equal(h.service.tracks.size, 0);
  await h.service.load(true);
  assert.equal(reads().length, 2, 'new comparison refreshes the definition');
  h.service.ngOnDestroy();
});

test('overlay lap summaries match normal session analysis before rebasing to elapsed time', () => {
  const metre = 180 / (Math.PI * 6371000), start = Date.parse(date + 'T08:00:00Z');
  const fix = (time, x, y) => ({ time: start + time, lat: 50 + y * metre, lon: x * metre / Math.cos(50 * Math.PI / 180) });
  const fixes = [[0,0,-30],[3000,0,15],[6000,40,30],[10000,60,0],[14000,40,-30],[18000,0,-30],
    [24000,0,15],[28000,40,30],[32000,60,0],[36000,40,-30],[38000,0,-30],[44000,0,15]].map(v => fix(...v));
  const line = { a: fix(0,-10,0), b: fix(0,10,0), direction: 1 };
  const bounds = { south: 49.99, north: 50.01, west: -.01, east: .01 };
  const track = { line, bounds };
  const event = dayData.emptyDay(date), session = { id: 'race', type: 'race', startAt: start, endAt: start + 44000, overrides: {} };
  const samples = fixes.map((fix,i) => ({ id: String(i), receivedAt: fix.time, source: '424-phone',
    raw: JSON.stringify({ Lat: fix.lat, Lon: fix.lon, A: 12, Spd: 10 }) }));
  const raw = data.channelsFor(samples, samples.at(-1));
  const analysis = sessions.sessionLapAnalysis(gps.gpsAnalysis(fixes, line, raw, session.endAt), sessions.sessionIntervals(event, [session]),
    { channels: raw, fixes, end: session.endAt, configured: true });
  const expected = lapMetrics.lapMetricChannels(analysis.laps);
  const result = overlay.overlayChannels(samples, session, event, track);
  for (const channel of expected) {
    const shifted = result.find(item => item.id === channel.id);
    assert.deepEqual(shifted.points, channel.points.map(point => ({ ...point, time: point.time - start })));
    assert.ok(shifted.points.every(point => point.time < 43000), 'last incomplete lap adds no point');
    assert.ok(shifted.points.length > 0);
  }
  assert.ok(Math.abs(result.find(item => item.id === 'computed:lap-average-speed').points[0].value - 10 / .44704) < 1e-8);
  assert.equal(result.find(item => item.id === 'computed:lap-average-amps').points[0].value, 12);
  for (const missing of [null, { line, bounds: { south: 0, north: 1, west: 0, east: 1 } }]) {
    assert.ok(overlay.overlayChannels(samples, session, event, missing).filter(item => data.isLapMetric(item.id)).every(item => !item.points.length));
  }
});


test('a session without complete lap data never masks another session’s metric graphs', () => {
  const h = fixture();
  const completed = lapMetrics.lapMetricChannels([{ time: 0, end: 1000, complete: true, current: 12, speed: 20 }]);
  const empty = lapMetrics.lapMetricChannels([]);
  h.service.sessions = [{ channels: completed }, { channels: empty }];
  assert.ok(h.service.channels.every(channel => channel.points.length > 0));
  h.service.sessions.reverse();
  assert.ok(h.service.channels.every(channel => channel.points.length > 0));
  h.service.ngOnDestroy();
});
