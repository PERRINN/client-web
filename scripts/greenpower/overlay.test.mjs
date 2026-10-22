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

test('overlay power and Wh retain session baselines after elapsed-time projection', () => {
  const startAt = Date.parse(date + 'T08:00:00Z');
  const rows = Array.from({ length: 11 }, (_, index) => ({ id: String(index), source: '424-phone',
    receivedAt: startAt + index * 3000, raw: JSON.stringify({ Vt: 24, A: 20, AH: 10 + index / 60 }) }));
  const result = overlay.overlayChannels(rows, { type: 'battery_dyno', startAt: startAt + 6000,
    endAt: startAt + 30000, overrides: {} });
  const power = result.find(channel => channel.id === data.POWER);
  const energy = result.find(channel => channel.id === data.ENERGY);
  assert.deepEqual(power.points[0], { time: 0, value: 480 });
  assert.deepEqual(energy.points[0], { time: 0, value: 0 });
  assert.ok(Math.abs(energy.valueAt(24000) - 3.2) < 1e-10);
  assert.ok(Math.abs(energy.points.at(-1).value - 3.2) < 1e-10);
  assert.equal(energy.value, '3.2');
});

test('battery dyno overlay labels include saved batteries and omit empty battery lists', () => {
  const event = { ...dayData.emptyDay(date), eventName: 'Battery test', defaults: { driver: 'Sam' } };
  const session = { type: 'battery_dyno', batteryIds: ['Battery A'], overrides: {} };
  const base = date + ' · Battery test · Sam';
  assert.equal(overlay.overlayLabel(event, session), base + ' · Battery A');
  assert.equal(overlay.overlayLabel(event, { ...session, batteryIds: ['Battery A', 'Battery B'] }), base + ' · Battery A, Battery B');
  assert.equal(overlay.overlayLabel(event, { ...session, batteryIds: [] }), base);
  for (const type of ['race', 'practice', 'motor_dyno']) {
    assert.equal(overlay.overlayLabel(event, { ...session, type }), base);
  }
  assert.equal(overlay.overlayLabel({ ...event, eventName: '', defaults: {} }, session), date + ' · Battery A');
});

test('battery dyno labels use the maximum finite computed Wh, including zero, rather than the last reading', () => {
  const event = dayData.emptyDay(date), session = { type: 'battery_dyno', batteryIds: [], overrides: {} };
  const channels = [{ id: data.ENERGY, value: '2', points: [
    { time: 0, value: 0 }, { time: 1, value: 12.345 }, { time: 2, value: 2 },
    { time: 3, value: NaN }, { time: 4, value: Infinity }
  ] }];
  assert.equal(overlay.overlayLabel(event, session, channels), date + ' · 12 Wh');
  assert.equal(overlay.overlayLabel(event, session, [{ ...channels[0], points: [{ time: 0, value: 0 }] }]), date + ' · 0 Wh');
  assert.equal(overlay.overlayLabel(event, session, [{ ...channels[0], points: [] }]), date);
  assert.equal(overlay.overlayLabel(event, { ...session, type: 'race' }, channels), date);
});

test('loading a battery dyno adds computed maximum Wh to shared session and chart labels', async () => {
  const h = fixture(1, 3);
  h.records.get(`${ROOT}/days/${date}/sessions/race-0`).type = 'battery_dyno';
  for (const [path, record] of h.records) if (path.includes('/chunks/')) {
    for (const sample of record.samples) sample.raw = JSON.stringify({ Vt: 24, A: 20 });
  }
  const component = new GreenpowerOverlayComponent(h.service, { changed: new Subject(), charts: channels => channels }, { markForCheck() {} });
  const labels = [];
  const subscription = h.service.changed.subscribe(() => labels.push(h.service.sessions[0]?.label));
  await h.service.load(true, 'battery_dyno');
  assert.ok(labels.includes(date + ' · Goodwood · Default driver'), 'pending label has no energy');
  assert.equal(h.service.sessions[0].label, date + ' · Goodwood · Default driver · 0 Wh');
  assert.ok(component.charts.every(chart => chart.traces.every(trace => trace.label === h.service.sessions[0].label)));
  assert.equal(h.calls.length, 3, 'one metadata, one parent and one chunk request');
  subscription.unsubscribe(); component.ngOnDestroy(); h.service.ngOnDestroy();
});

test('battery dyno preset filters the year and type, retains its filter on pagination and retry, and resets when switching', async () => {
  const h = fixture(31);
  for (const [path, value] of h.records) if (path.includes('/sessions/')) value.type = 'battery_dyno';
  const source = h.records.get(`${ROOT}/days/${date}/sessions/race-0`);
  for (const [id, changes] of [['race', { type: 'race' }], ['motor', { type: 'motor_dyno' }],
    ['practice', { type: 'practice' }], ['old-year', { startAt: Date.UTC(2025, 11, 31) }],
    ['next-year', { startAt: Date.UTC(2027, 0, 1) }], ['legacy', { schemaVersion: 1 }]]) {
    h.records.set(`${ROOT}/days/${date}/sessions/${id}`, { ...source, id, ...changes });
  }
  const component = new GreenpowerOverlayComponent(h.service, { changed: new Subject(), charts: channels => channels }, { markForCheck() {} });
  component.choose('2026-battery-dyno');
  while (h.service.loading) await Promise.resolve();
  assert.equal(h.service.title, '2026 battery dyno tests');
  assert.equal(h.service.sessions.length, 30);
  assert.ok(h.service.sessions.every(item => item.loaded && item.session.type === 'battery_dyno'));
  h.fail(true); await h.service.load();
  assert.ok(h.service.error);
  assert.equal(h.service.sessions.length, 31);
  h.fail(false); await h.service.load();
  assert.equal(h.service.error, '');
  assert.ok(h.service.sessions.every(item => item.loaded));
  const queries = h.calls.filter(call => call.path === 'group:sessions');
  assert.equal(queries.length, 2);
  assert.ok(queries.every(query => query.limit === 30 && query.filters.some(([key, , value]) => key === 'type' && value === 'battery_dyno')));
  assert.ok(queries[1].after, 'continuation uses the battery preset cursor');
  component.choose('2026-race');
  while (h.service.loading) await Promise.resolve();
  assert.equal(h.service.title, '2026 race sessions');
  assert.deepEqual(h.service.sessions.map(item => item.session.type), ['race']);
  assert.equal(h.service.hasMore, false);
  assert.equal(h.calls.filter(call => call.path === 'group:sessions').at(-1).after, undefined);
  component.ngOnDestroy(); h.service.ngOnDestroy();
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
  const event = { ...dayData.emptyDay(date), defaults: { motorGearTeeth: 12, wheelGearTeeth: 60 } }, session = { id: 'race', type: 'race', startAt: start, endAt: start + 44000, overrides: {} };
  const samples = fixes.map((fix,i) => ({ id: String(i), receivedAt: fix.time, source: '424-phone',
    raw: JSON.stringify({ Lat: fix.lat, Lon: fix.lon, A: 12, Vt: 24, Spd: 10, RPM: 3000 }) }));
  const raw = data.channelsFor(samples, samples.at(-1));
  const analysis = sessions.sessionLapAnalysis(gps.gpsAnalysis(fixes, line, raw, session.endAt), sessions.sessionIntervals(event, [session]),
    { channels: raw, fixes, end: session.endAt, configured: true });
  const projected = motorSpeed.withMotorDerivedSpeed(sessions.savedGear(raw, event, [session], session.startAt, session.endAt), event);
  const expected = lapMetrics.lapMetricChannels(motorSpeed.motorLapSpeeds(analysis.laps, projected), projected);
  const result = overlay.overlayChannels(samples, session, event, track);
  for (const channel of expected) {
    const shifted = result.find(item => item.id === channel.id);
    assert.deepEqual(shifted.points, channel.points.map(point => ({ ...point, time: point.time - start })));
    assert.ok(shifted.points.every(point => point.time < 43000), 'last incomplete lap adds no point');
    assert.ok(shifted.points.length > 0);
  }
  assert.ok(Math.abs(result.find(item => item.id === 'computed:lap-average-speed').points[0].value - 12.9 / .44704) < 1e-8);
  assert.equal(result.find(item => item.id === 'computed:lap-average-amps').points[0].value, 12);
  assert.equal(result.find(item => item.id === 'computed:lap-average-power').points[0].value, 288);
  for (const missing of [null, { line, bounds: { south: 0, north: 1, west: 0, east: 1 } }]) {
    assert.ok(overlay.overlayChannels(samples, session, event, missing).filter(item => data.isLapMetric(item.id)).every(item => !item.points.length));
  }
});


test('a session without complete lap data never masks another session’s metric graphs', () => {
  const h = fixture();
  const completed = lapMetrics.lapMetricChannels([{ time: 0, end: 1000, complete: true, current: 12, speed: 20 }],
    [{ id: data.POWER, points: [{ time: 0, value: 288 }, { time: 1000, value: 288 }] }]);
  const empty = lapMetrics.lapMetricChannels([]);
  h.service.sessions = [{ channels: completed }, { channels: empty }];
  assert.ok(h.service.channels.every(channel => channel.points.length > 0));
  h.service.sessions.reverse();
  assert.ok(h.service.channels.every(channel => channel.points.length > 0));
  h.service.ngOnDestroy();
});

function liveFixture(count = 1, type = 'battery_dyno') {
  const h = fixture(count, 2);
  for (const [path, session] of h.records) if (path.includes('/sessions/')) session.type = type;
  const event = h.records.get(`${ROOT}/days/${date}`);
  event.defaults = { driver: 'Live driver', motorGearTeeth: 18, wheelGearTeeth: 57 };
  const startAt = Date.parse(date + 'T20:00:00Z');
  const session = { ...structuredClone(h.records.get(`${ROOT}/days/${date}/sessions/race-0`)),
    id: 'live-run', type, startAt, endAt: null, batteryIds: ['Live battery'], overrides: {} };
  session.ranges = [{ ...session.ranges[0], firstAt: startAt, lastAt: startAt, lastChunk: session.ranges[0].firstChunk, firstIndex: 0, lastIndex: 0, lastSampleId: session.ranges[0].firstSampleId }];
  h.records.set(`${ROOT}/days/${date}/sessions/${session.id}`, session);
  const source = (count = 5, changes = {}) => {
    const samples = Array.from({ length: count }, (_, index) => ({ id: 'live-' + index, source: '424-phone',
      receivedAt: startAt - 3000 + index * 3000,
      raw: JSON.stringify({ Vt: 24, A: 20, AH: 10 + index / 10, RPM: 3000, Spd: 10 }) }));
    const end = samples.at(-1).receivedAt;
    const raw = data.channelsFor(samples, samples.at(-1));
    const energy = sessions.withEnergy(raw, [session], end);
    const geared = sessions.savedGear(energy.map(channel => sessions.sessionAmpHours(channel, [session], end)), event, [session], samples[0].receivedAt, end, end);
    const channels = sessions.withDistance(motorSpeed.withMotorDerivedSpeed(geared, event, end), [session], end);
    return { event, sessions: [session], channels, end, complete: true, ...changes };
  };
  return { ...h, event, session, source };
}

test('live overlay reuses calculated data with zero extra queries, keeps its start and updates Wh and elapsed time', async () => {
  const h = liveFixture(1), source = h.source(5), id = `${ROOT}/days/${date}/sessions/live-run`;
  h.service.syncLive(source); assert.equal(h.calls.length, 0);
  await h.service.load(true, 'battery_dyno');
  const item = h.service.sessions.find(item => item.id === id);
  assert.equal(item.live, true); assert.equal(item.loaded, true); assert.match(item.label, /Live battery · 1 Wh · Live$/);
  const energy = item.channels.find(channel => channel.id === data.ENERGY);
  assert.deepEqual(energy.points[0], { time: 0, value: 0 });
  assert.ok(Math.abs(energy.points.at(-1).value - 1.2) < 1e-10);
  assert.ok(Math.abs(energy.valueAt(9000) - 1.2) < 1e-10);
  const before = h.calls.length, colour = item.colour;
  const component = new GreenpowerOverlayComponent(h.service, { changed: new Subject(), charts: channels => channels }, { markForCheck() {} });
  component.zoom({ start: 0, end: 6000 }); component.cursor = 3000;
  h.service.toggleVisibility(id); h.service.toggleInclusion(id);
  h.service.syncLive(h.source(8));
  const updated = h.service.sessions.find(item => item.id === id);
  assert.equal(h.calls.length, before, 'appending live data performs no reads');
  assert.equal(updated.colour, colour); assert.equal(updated.hidden, true); assert.equal(updated.excluded, true);
  assert.match(updated.label, /2 Wh · Live$/);
  assert.equal(h.service.end, 18000); assert.equal(component.cursor, 3000); assert.deepEqual(component.window, { start: 0, end: 6000 });
  assert.equal(h.session.endAt, null, 'the persisted session stays open');
  const original = source.channels.find(channel => channel.id === data.ENERGY).points.at(-1);
  assert.equal(original.time, source.end); assert.ok(Math.abs(original.value - 1.2) < 1e-10);
  component.ngOnDestroy(); h.service.ngOnDestroy();
});

test('live session is included before historical pagination reaches it, without a second chunk reader or duplicate', async () => {
  const h = liveFixture(35);
  h.service.syncLive(h.source()); await h.service.load(true, 'battery_dyno');
  assert.equal(h.service.sessions.length, 31); assert.equal(h.service.more, true);
  assert.equal(h.service.sessions.at(-1).session.id, 'live-run', 'live session follows the historical page');
  assert.equal(h.calls.filter(call => call.path === 'group:sessions').length, 1);
  assert.equal(h.calls.find(call => call.path === 'group:sessions').limit, 30);
  assert.equal(h.calls.filter(call => call.path.endsWith('/chunks')).length, 30, 'only completed recordings read chunks');
  await h.service.load();
  assert.equal(h.service.sessions.length, 36);
  assert.equal(h.service.sessions.at(-1).session.id, 'live-run', 'loading more history keeps live last');
  assert.equal(h.service.sessions.filter(item => item.session.id === 'live-run').length, 1);
  assert.equal(h.calls.filter(call => call.path.endsWith('/chunks')).length, 35);
  h.service.ngOnDestroy();
});

test('live race preset, session closure and paused contexts retain one stable comparison snapshot', async () => {
  const h = liveFixture(1, 'race'); h.service.syncLive(h.source());
  await h.service.load(true, 'battery_dyno'); assert.equal(h.service.sessions.length, 0, 'mismatched preset excludes the session');
  await h.service.load(true, 'race');
  const item = h.service.sessions.find(item => item.live), colour = item.colour, before = h.calls.length;
  const closed = { ...h.session, endAt: h.session.startAt + 9000 };
  h.service.syncLive(h.source(8, { sessions: [closed] }));
  assert.equal(item.live, false); assert.equal(item.session.endAt, closed.endAt);
  assert.equal(item.channels.find(channel => channel.id === data.ENERGY).points.at(-1).time, 9000);
  assert.equal(item.colour, colour); assert.doesNotMatch(item.label, / · Live$/); assert.equal(h.calls.length, before);
  h.service.syncLive(h.source(10, { sessions: [closed] }));
  assert.equal(item.channels.find(channel => channel.id === data.ENERGY).points.at(-1).time, 9000, 'closed snapshot stops growing');
  h.service.syncLive(h.source(8));
  assert.equal(item.live, true, 'reopening reuses the existing session identity');
  const snapshot = item.channels;
  h.service.syncLive(); assert.equal(item.live, false); assert.match(item.label, / · Open$/); assert.equal(item.channels, snapshot);
  assert.equal(h.calls.length, before);
  h.service.clear(); h.service.syncLive(h.source()); await h.service.load(true, 'race');
  assert.equal(h.service.sessions.filter(item => item.session.id === h.session.id).length, 1, 'reopening overlay attaches one live session');
  h.state.next({ uid: '', ready: true }); assert.equal(h.service.sessions.length, 0);
  h.service.ngOnDestroy();
});

test('incomplete or overlapping live metadata withholds consumption and preserves chart frames and cursor', async () => {
  const h = liveFixture(); h.service.syncLive(h.source()); await h.service.load(true, 'battery_dyno');
  const component = new GreenpowerOverlayComponent(h.service, { changed: new Subject(), charts: channels => channels }, { markForCheck() {} });
  component.cursor = 3000;
  const before = h.calls.length, count = component.charts.length;
  const missing = h.source(8, { complete: false });
  missing.channels = missing.channels.filter(channel => channel.id !== data.DISTANCE);
  h.service.syncLive(missing);
  const item = h.service.sessions.find(item => item.live);
  assert.equal(component.charts.length, count); assert.equal(component.cursor, 3000);
  assert.doesNotMatch(item.label, / Wh/);
  for (const id of [data.ENERGY, data.DISTANCE, '["AH"]:Ah']) {
    const channel = item.channels.find(channel => channel.id === id);
    assert.deepEqual(channel.points, []); assert.equal(channel.valueAt?.(3000), undefined);
  }
  h.service.syncLive(h.source(8, { sessions: [h.session, { ...h.session, id: 'overlap', type: 'practice', endAt: h.session.startAt + 3000 }] }));
  assert.deepEqual(item.channels.find(channel => channel.id === data.ENERGY).points, []);
  h.service.syncLive(h.source(8)); assert.match(item.label, / Wh · Live$/);
  assert.equal(h.calls.length, before); assert.equal(component.charts.length, count); assert.equal(component.cursor, 3000);
  component.ngOnDestroy(); h.service.ngOnDestroy();
});

test('a session adopted from an in-flight historical load is not duplicated or overwritten by its old recording', async () => {
  const h = fixture(2, 2), event = h.records.get(`${ROOT}/days/${date}`);
  let resume; h.pause(new Promise(resolve => resume = resolve));
  const loading = h.service.load(true, 'race');
  for (let step = 0; step < 20 && !h.calls.at(-1)?.path.endsWith('/chunks'); step++) await Promise.resolve();
  assert.ok(h.calls.at(-1).path.endsWith('/chunks'));
  const open = { ...h.records.get(`${ROOT}/days/${date}/sessions/race-0`), endAt: null };
  const channels = [{ id: '["A"]:A', label: 'Current', unit: 'A', value: '42',
    points: [{ time: open.startAt, value: 42 }, { time: open.startAt + 3000, value: 43 }] }];
  h.service.syncLive({ event, sessions: [open], channels, end: open.startAt + 3000, complete: true });
  resume(); await loading;
  assert.equal(h.service.error, '');
  assert.equal(h.service.sessions.filter(item => item.session.id === open.id).length, 1);
  const item = h.service.sessions.find(item => item.session.id === open.id);
  assert.equal(item.live, true); assert.deepEqual(item.channels[0].points, [{time:0,value:42},{time:3000,value:43}]);
  assert.equal(h.calls.filter(call => call.path.endsWith('/chunks')).length, 2, 'one existing in-flight read and the other historical recording');
  h.service.ngOnDestroy();
});

test('closure waits for received end samples, and elapsed readers cannot escape the session boundaries', async () => {
  const h = liveFixture(); h.service.syncLive(h.source(5)); await h.service.load(true, 'battery_dyno');
  const item = h.service.sessions.find(item => item.live), endAt = h.session.startAt + 18000;
  const closed = { ...h.session, endAt };
  h.service.syncLive(h.source(5, {sessions:[closed]})); assert.equal(item.live, true, 'tail still has to reach the saved end');
  h.service.syncLive(h.source(8, {sessions:[closed]})); assert.equal(item.live, false);
  const energy = item.channels.find(channel => channel.id === data.ENERGY);
  assert.equal(energy.valueAt(-1), undefined); assert.equal(energy.valueAt(18001), undefined);
  assert.ok(Math.abs(energy.valueAt(18000) - 2.4) < 1e-10);
  h.service.ngOnDestroy();
});


test('overlay lists and graph readings keep live last through history loading, updates and visibility changes', async () => {
  const h = liveFixture(2); h.service.syncLive(h.source()); await h.service.load(true, 'battery_dyno');
  const component = new GreenpowerOverlayComponent(h.service, { changed: new Subject(), charts: channels => channels }, { markForCheck() {} });
  const id = `${ROOT}/days/${date}/sessions/live-run`, item = h.service.sessions.at(-1), colour = item.colour;
  assert.equal(item.id, id);
  for (const chart of component.charts.filter(chart => chart.traces.some(trace => trace.sessionId === id))) assert.equal(chart.traces.at(-1).sessionId, id);
  component.zoom({start:0,end:6000}); component.cursor=3000;
  h.service.toggleVisibility(id); h.service.toggleInclusion(id);
  const reads=h.calls.length;
  h.service.syncLive(h.source(8));
  assert.equal(h.calls.length,reads); assert.equal(h.service.sessions.at(-1).id,id);
  assert.equal(h.service.sessions.at(-1).colour,colour);
  assert.equal(h.service.sessions.at(-1).hidden,true); assert.equal(h.service.sessions.at(-1).excluded,true);
  for (const chart of component.charts.filter(chart => chart.traces.some(trace => trace.sessionId === id))) assert.equal(chart.traces.at(-1).sessionId,id);
  assert.deepEqual(component.window,{start:0,end:6000}); assert.equal(component.cursor,3000);
  component.ngOnDestroy(); h.service.ngOnDestroy();
});
