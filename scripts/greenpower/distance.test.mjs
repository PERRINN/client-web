import assert from 'node:assert/strict';
import test from 'node:test';
import { data, dayData, gps, load, motorSpeed } from './load.mjs';

const sessions = load('../../src/app/greenpower-telemetry/greenpowerSessions.ts', {
  './greenpowerData': data, './greenpowerDay': dayData, './greenpowerGps': gps
});
const view = load('../../src/app/greenpower-telemetry/greenpowerView.ts', { './greenpowerData': data });
const window = (type, startAt, endAt) => ({ id: `${type}-${startAt}`, type, startAt, endAt, overrides: {} });
const signal = (points, value = String(points.at(-1)?.value ?? '—')) => ({
  id: data.MOTOR_DERIVED_SPEED, ...data.channelDetails(data.MOTOR_DERIVED_SPEED), points, value
});
const distance = (points, windows = [], latest = points.at(-1)?.time) => sessions.withDistance([signal(points)], windows, latest).find(c => c.id === data.DISTANCE);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const points = Array.from({ length: 21 }, (_, i) => ({ time: i * 3000, value: 30 }));

test('distance integrates motor mph over actual timestamps in miles and preserves the source', () => {
  const source = [signal([{ time: 0, value: 20 }, { time: 3000, value: 40 }, { time: 9000, value: 60 }])];
  const before = structuredClone(source);
  const channel = sessions.withDistance(source, [], 9000).find(c => c.id === data.DISTANCE);
  assert.deepEqual(data.channelDetails(data.DISTANCE), { label: 'Distance travelled', unit: 'mi' });
  assert.equal(channel.points[0].value, 0);
  near(channel.valueAt(3000), .025); near(channel.valueAt(9000), .025 + 1 / 12);
  assert.deepEqual(source, before);
  assert.deepEqual(sessions.withDistance([signal([{ time: 0, value: 0 }, { time: 3000, value: 0 }])], [], 3000).at(-1).points.map(p => p.value), [0, 0]);
});

test('distance shares Energy session eligibility, boundary ownership and reset edits', () => {
  const windows = [window('race', 3000, 12000), window('battery_dyno', 18000, 27000), window('motor_dyno', 33000, 42000), window('practice', 48000, 57000)];
  const channel = distance(points, windows);
  for (const session of windows.slice(0, 3)) {
    assert.equal(channel.valueAt(session.startAt), 0); near(channel.valueAt(session.endAt), .075);
  }
  near(channel.valueAt(57000), .475);
  near(distance(points, [window('race', 21000, 27000)]).valueAt(27000), .05);
  near(distance(points, [window('race', 0, 60000), window('practice', 3000, 6000)]).valueAt(60000), .5);
  assert.equal(distance(points, [window('race', 0, 12000), window('motor_dyno', 12000, 27000)]).valueAt(12000), 0);
  assert.equal(distance(points, [window('race', 4000, 12000)]).valueAt(6000), 0, 'first in-session sample sets the origin');
});

test('gaps withhold cumulative distance until a new eligible session and missing latest stays blank', () => {
  const sparse = [0, 3000, 30000, 33000, 36000].map(time => ({ time, value: 30 }));
  const channel = distance(sparse, [window('race', 33000, 36000)]);
  assert.equal(channel.valueAt(30000), undefined); assert.equal(channel.valueAt(18000), undefined);
  assert.equal(channel.valueAt(33000), 0); near(channel.valueAt(36000), .025);
  assert.equal(distance(sparse).value, '—');
  assert.equal(distance(points, [], 63000).value, '—');
  assert.equal(sessions.withDistance([signal(points, '—')], [], 60000).at(-1).value, '—');
  assert.deepEqual(sessions.withDistance([{ ...signal(points), id: data.VEHICLE_SPEED }], [], 60000).map(c => c.id), [data.VEHICLE_SPEED], 'no recorded-speed fallback');
});

test('motor gearing and circumference feed distance, with missing metadata withholding it', () => {
  const event = { ...dayData.emptyDay('2026-10-20'), wheelCircumferenceM: 1.29, defaults: { motorGearTeeth: 12, wheelGearTeeth: 60 } };
  const samples = points.map(p => ({ id: String(p.time), receivedAt: p.time, source: '424-phone', raw: JSON.stringify({ RPM: 3000, Spd: 99 }) }));
  const raw = data.channelsFor(samples, samples.at(-1));
  const derive = (channels, metadata = event, windows = []) => sessions.withDistance(motorSpeed.withMotorDerivedSpeed(sessions.savedGear(channels, metadata, windows, 0, 60000, 60000), metadata, 60000), windows, 60000).find(c => c.id === data.DISTANCE);
  near(derive(raw).points.at(-1).value, 12.9 / .44704 / 60);
  near(derive(raw, { ...event, wheelCircumferenceM: 2.58 }).points.at(-1).value, 25.8 / .44704 / 60);
  const gearSession = { ...window('race', 0, 60000), overrides: { wheelGearTeeth: 120 } };
  near(derive(raw, event, [gearSession]).points.at(-1).value, 6.45 / .44704 / 60);
  assert.equal(derive(raw, { ...event, defaults: {} }), undefined);
  const merged = data.mergeChannels([data.channelsFor(samples.slice(0, 10)), data.channelsFor(samples.slice(10))], samples.at(-1));
  assert.deepEqual(derive(merged).points, derive(raw).points);
});

test('distance respects saved visibility and can be ordered before vehicle speed', () => {
  const channel = distance(points);
  const speed = { ...signal(points), id: data.VEHICLE_SPEED };
  const channels = [speed, channel], saved = { [speed.id]: true };
  const before = structuredClone(saved);
  assert.deepEqual(view.telemetryCharts(channels, view.selectedChannels(channels, saved)).map(c => c.id), [speed.id]);
  assert.deepEqual(view.telemetryCharts(channels, channels).map(c => c.id), [speed.id, data.DISTANCE]);
  assert.deepEqual(view.telemetryCharts(channels, []).map(c => c.id), []);
  assert.deepEqual(view.telemetryCharts([], []), []);
  assert.deepEqual(view.telemetryCharts(channels, [channel, speed]).map(c => c.id), [data.DISTANCE, speed.id]);
  assert.deepEqual(saved, before);
  assert.equal(view.configurableCharts(channels).some(c => c.id === data.DISTANCE), true);
});
