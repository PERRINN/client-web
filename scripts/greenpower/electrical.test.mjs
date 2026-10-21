import assert from 'node:assert/strict';
import test from 'node:test';
import { data, dayData, gps, load, markers } from './load.mjs';

const { withEnergy } = load('../../src/app/greenpower-telemetry/greenpowerSessions.ts', {
  './greenpowerData': data, './greenpowerDay': dayData, './greenpowerGps': gps
});
const view = load('../../src/app/greenpower-telemetry/greenpowerView.ts', { './greenpowerMarkers': markers, './greenpowerData': data });
const sample = (time, payload = { Vt: 24, A: 20, AH: 10 + time / 3600000 * 20 }) => ({
  id: String(time), receivedAt: time, source: '424-phone', raw: JSON.stringify(payload)
});
const energy = (samples, sessions = [], latest = samples.at(-1)) =>
  withEnergy(data.channelsFor(samples, latest), sessions, latest?.receivedAt).find(channel => channel.id === data.ENERGY);
const session = (type, startAt, endAt) => ({ id: type, type, startAt, endAt });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('power uses total voltage and current from the same live or historical payload', () => {
  for (const source of ['424-phone', 'echook-history']) {
    const row = { ...sample(0), source, raw: JSON.stringify(source === 'echook-history'
      ? { voltage: 25, current: 20 } : { Vt: 25, A: 20 }) };
    const channel = data.channelsFor([row], row).find(channel => channel.id === data.POWER);
    assert.deepEqual(channel, { id: data.POWER, label: 'Power', unit: 'W', value: '500', points: [{ time: 0, value: 500 }] });
    assert.deepEqual(data.channelDetails(data.POWER), { label: 'Power', unit: 'W' });
  }
  const samples = [{ Vt: 24 }, { A: 20 }, { Vt: '24', A: 20 }, { Vt: 24, A: null },
    { Vt: { value: 24, unit: 'mV' }, A: 20 }, { Vt: 24, A: { value: 20, unit: 'mA' } },
    { Vt: 1e308, A: 1e308 }].map((payload, index) => sample(index, payload));
  assert.ok(data.channelsFor(samples).every(channel => channel.id !== data.POWER));
  const explicit = data.channelsFor([sample(0, { Vt: { value: 24, unit: 'V' }, A: { value: -2, unit: 'A' } })]);
  assert.equal(explicit.find(channel => channel.id === data.POWER).value, '-48');
});

test('Wh integrates trapezoids using actual timestamps, with zero baseline and stable cursor values', () => {
  const samples = [sample(0), sample(3000, { Vt: 24, A: 10 }), sample(9000, { Vt: 24, A: 30 })];
  const before = structuredClone(samples), channel = energy(samples);
  near(channel.points[1].value, .3); near(channel.points[2].value, 1.1);
  assert.equal(channel.value, '1.1'); assert.equal(channel.points[0].value, 0);
  near(channel.valueAt(3000), .3);
  assert.deepEqual(data.channelDetails(data.ENERGY), { label: 'Energy', unit: 'Wh' });
  assert.deepEqual(samples, before, 'raw records are untouched');
  assert.equal(energy([sample(0, { Vt: 24, A: -20 }), sample(3000, { Vt: 24, A: -20 })]).value, '-0.4');
});

test('race and dyno Wh reset independently; practice and ambiguous metadata retain recording totals', () => {
  const samples = Array.from({ length: 21 }, (_, index) => sample(index * 3000));
  const sessions = [session('race', 3000, 12000), session('battery_dyno', 18000, 27000),
    session('motor_dyno', 33000, 42000), session('practice', 48000, 57000)];
  const channel = energy(samples, sessions);
  for (const window of sessions.slice(0, 3)) {
    assert.equal(channel.valueAt(window.startAt), 0);
    near(channel.valueAt(window.endAt), 1.2);
  }
  near(channel.valueAt(57000), 7.6);
  const changed = energy(samples, [session('battery_dyno', 21000, 27000)]);
  near(changed.valueAt(27000), .8);
  for (const windows of [[], [session('race', 0, 60000), session('practice', 3000, 6000)]]) {
    near(energy(samples, windows).valueAt(60000), 8);
  }
  const adjacent = energy(samples, [session('race', 0, 12000), session('battery_dyno', 12000, 27000)]);
  assert.equal(adjacent.valueAt(12000), 0, 'the next session owns its starting boundary');
});

test('a recording gap stops Wh until the next unambiguous session reset; missing latest values stay blank', () => {
  const samples = [sample(0), sample(3000), sample(30000), sample(33000), sample(36000)];
  const channel = energy(samples, [session('battery_dyno', 33000, 36000)]);
  assert.equal(channel.valueAt(30000), undefined);
  assert.equal(channel.valueAt(18000), undefined);
  assert.equal(channel.valueAt(33000), 0); near(channel.valueAt(36000), .4);
  assert.equal(channel.value, '0.4');
  assert.equal(energy(samples).value, '—');
  assert.equal(energy(samples).valueAt(36000), undefined);
  assert.equal(energy([sample(0), sample(3000)], [], sample(4000, { A: 20 })).value, '—');
  assert.equal(energy([sample(0), sample(3000)], [], sample(4000)).value, '—', 'latest metadata cannot extrapolate unreceived chunks');
  assert.equal(energy([sample(0, { AH: 10 })]), undefined);
});

test('merged chunk projections produce the same Wh as a contiguous recording without double counting', () => {
  const samples = Array.from({ length: 100 }, (_, index) => sample(index * 3000));
  const chunks = [samples.slice(0, 32), samples.slice(32, 64), samples.slice(64)];
  const projected = chunks.map(chunk => data.channelsFor(chunk));
  const merged = data.mergeChannels(projected, samples.at(-1));
  const before = structuredClone(merged);
  const whole = energy(samples);
  const fromChunks = withEnergy(merged, [], samples.at(-1).receivedAt).find(channel => channel.id === data.ENERGY);
  assert.deepEqual(fromChunks.points, whole.points); assert.equal(fromChunks.value, whole.value);
  assert.deepEqual(merged, before);
  assert.deepEqual(withEnergy(merged, [], samples.at(-1).receivedAt).find(channel => channel.id === data.ENERGY).points, fromChunks.points);
});

test('power and energy respect explicit chart visibility and ordering', () => {
  const channels = withEnergy(data.channelsFor([sample(0), sample(3000)], sample(3000)), [], 3000);
  const current = channels.find(channel => channel.id === '["A"]:A');
  const ah = channels.find(channel => channel.id === '["AH"]:Ah');
  const before = structuredClone(view.selectionFor(channels));
  assert.deepEqual(view.telemetryCharts(channels, [ah, current]).map(channel => channel.id),
    ['["AH"]:Ah', '["A"]:A']);
  assert.deepEqual(view.telemetryCharts(channels, []).map(channel => channel.id), []);
  assert.equal(view.telemetryCharts(channels, channels).filter(channel => channel.id === data.POWER).length, 1);
  assert.equal(view.telemetryCharts(channels, channels).filter(channel => channel.id === data.ENERGY).length, 1);
  assert.equal(before.charts[data.POWER], true); assert.equal(before.charts[data.ENERGY], true);
  assert.deepEqual(view.selectionFor(channels), before);
  assert.deepEqual(view.telemetryCharts([], []), []);
});

test('a synthetic full day keeps one Wh value per power sample and reuses channel projections', () => {
  const samples = Array.from({ length: 28800 }, (_, index) => sample(index * 3000));
  const channels = data.channelsFor(samples, samples.at(-1));
  const start = performance.now();
  const result = withEnergy(channels, [], samples.at(-1).receivedAt);
  const channel = result.find(channel => channel.id === data.ENERGY);
  assert.equal(channel.points.length, 28800);
  assert.ok(Math.abs(channel.points.at(-1).value - 11519.6) < 1e-6);
  assert.equal(result.find(channel => channel.id === data.POWER), channels.find(channel => channel.id === data.POWER));
  console.log(JSON.stringify({ powerSamples: 28800, energyProjectionMs: Math.round(performance.now() - start) }));
});
