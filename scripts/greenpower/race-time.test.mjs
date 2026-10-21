import assert from 'node:assert/strict';
import test from 'node:test';
import { load, data, dayData, gps, tracks, lapMetrics, motorSpeed, markers } from './load.mjs';

const sessions = load('../../src/app/greenpower-telemetry/greenpowerSessions.ts', {
  './greenpowerData': data, './greenpowerDay': dayData, './greenpowerGps': gps
});
const overlay = load('../../src/app/greenpower-telemetry/greenpowerOverlay.ts', {
  './greenpowerData': data, './greenpowerDay': dayData, './greenpowerSessions': sessions,
  './greenpowerGps': gps, './greenpowerTracks': tracks, './greenpowerLapMetrics': lapMetrics, './greenpowerSpeed': motorSpeed
});
const sample = (time, payload = { A: 20 }) => ({ id: String(time), source: '424-phone', receivedAt: time, raw: JSON.stringify(payload) });
const samples = Array.from({ length: 61 }, (_, index) => sample(index * 3000));
const raw = data.channelsFor(samples, samples.at(-1));
const window = (type, startAt, endAt) => ({ id: type + startAt, type, startAt, endAt });
const raceTime = (windows = [], channels = raw, start = 0, end = 180000, latest = end) =>
  sessions.withRaceTime(channels, windows, start, end, latest).find(data.isRaceTime);

test('missing race time uses elapsed minutes and loaded sample timestamps without mutating source channels', () => {
  const before = structuredClone(raw), channel = raceTime();
  assert.equal(channel.id, '["raceseconds"]:');
  assert.equal(channel.value, '3');
  assert.equal(channel.valueAt(90000), 1.5);
  assert.equal(channel.points.length, samples.length);
  assert.equal(channel.valueAt(-1), undefined);
  assert.equal(channel.valueAt(180001), undefined);
  assert.equal(raceTime([], raw, 0, 180000, 183000).value, '—');
  assert.deepEqual(raw, before);
  assert.deepEqual(sessions.withRaceTime([], [], 0, 0), []);
});

test('recorded race time including zero wins; invalid readings reuse their existing identity', () => {
  for (const name of ['raceseconds', 'raceSeconds']) for (const unit of ['', 's', 'seconds']) {
    const channels = data.channelsFor([sample(0, { [name]: { value: 0, unit } })]);
    assert.equal(sessions.withRaceTime(channels, [], 0, 180000, 180000), channels);
    const missing = data.channelsFor([sample(0, { [name]: { value: null, unit } })]);
    const channel = raceTime([], missing);
    assert.equal(channel.id, missing[0].id);
    assert.equal(channel.value, '3');
  }
});

test('Energy session eligibility controls resets and adjacent sessions own their start boundary', () => {
  const windows = [window('race', 15000, 60000), window('battery_dyno', 60000, 90000),
    window('motor_dyno', 105000, 135000), window('practice', 150000, 180000)];
  const channel = raceTime(windows);
  for (const session of windows.slice(0, 3)) {
    assert.equal(channel.valueAt(session.startAt), 0);
    assert.equal(channel.valueAt(session.startAt + 15000), .25);
  }
  assert.equal(channel.valueAt(60000), 0);
  assert.equal(channel.valueAt(150000), 2.5);
  assert.equal(channel.value, '3');
  const overlap = [window('race', 15000, 90000), window('practice', 30000, 60000)];
  assert.equal(raceTime(overlap).valueAt(45000), .75);
});

test('saved session start stays the origin across missing samples, partial loads and boundary edits', () => {
  const channels = data.channelsFor([sample(60000), sample(180000)]);
  const channel = raceTime([window('race', 15000, 180000)], channels, 60000);
  assert.equal(channel.valueAt(60000), .75);
  assert.equal(channel.value, '2.75');
  assert.equal(channel.valueAt(120000), 1.75, 'elapsed time continues through outages');
  assert.equal(raceTime([window('race', 30000, 180000)], channels, 60000).value, '2.5');
  assert.equal(raceTime([], channels, 60000).value, '2');
});

test('overlay fallback resets before elapsed-time projection and preserves recorded readings', () => {
  const session = { ...window('race', 60000, 180000), overrides: {} };
  const channel = overlay.overlayChannels(samples, session).find(data.isRaceTime);
  assert.equal(channel.points[0].time, 0);
  assert.equal(channel.points[0].value, 0);
  assert.equal(channel.valueAt(90000), 1.5);
  assert.equal(channel.value, '2');
  const recorded = overlay.overlayChannels([sample(60000, { raceseconds: 30 }), sample(180000, { raceseconds: 150 })], session).find(data.isRaceTime);
  assert.deepEqual(recorded.points.map(p => p.value), [.5, 2.5]);
});

const view = load('../../src/app/greenpower-telemetry/greenpowerView.ts', {
  './greenpowerMarkers': markers, './greenpowerData': data
});

test('saved race-time aliases display the fallback in charts and scalars without changing selection IDs', () => {
  const fallback = raceTime([window('race', 60000, 180000)]);
  for (const name of ['raceseconds', 'raceSeconds', 'RaceSeconds']) for (const unit of ['', 's', 'seconds']) {
    const id = JSON.stringify([name]) + ':' + unit;
    const selection = { [id]: true };
    const chosen = view.selectedChannels([fallback], selection);
    assert.equal(chosen[0].id, id);
    assert.equal(chosen[0].value, '2');
    assert.equal(chosen[0].valueAt(90000), .5);
    assert.deepEqual(view.telemetryCharts([fallback], chosen), chosen);
    assert.deepEqual(selection, { [id]: true });
  }
  const recorded = { ...fallback, id: '["raceSeconds"]:s', value: '9' };
  assert.equal(view.selectedChannels([fallback, recorded], { [recorded.id]: true })[0], recorded);
  assert.equal(view.selectedChannels([fallback], { '["missing"]:s': true })[0].value, '—');
});
