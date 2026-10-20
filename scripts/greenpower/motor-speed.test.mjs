import assert from 'node:assert/strict';
import test from 'node:test';
import { data, dayData, gps, load, motorSpeed } from './load.mjs';

const sessions = load('../../src/app/greenpower-telemetry/greenpowerSessions.ts', {
  './greenpowerDay': dayData, './greenpowerData': data, './greenpowerGps': gps
});
const view = load('../../src/app/greenpower-telemetry/greenpowerView.ts', { './greenpowerData': data });
const event = { ...dayData.emptyDay('2026-06-14'), defaults: { motorGearTeeth: 12, wheelGearTeeth: 60 } };
const samples = (recorded = true, source = '424-phone') => [0, 20, 30, 40, 60, 80, 100].map(receivedAt => ({
  id: String(receivedAt), source, receivedAt,
  raw: JSON.stringify(source === '424-phone' ? { RPM: 3000, Gear: 99, ...(recorded ? { Spd: 2 } : {}) }
    : { rpm: 3000, gear: 99, ...(recorded ? { speed: 2 } : {}) })
}));
function project(records = samples(), metadata = event, windows = [], complete = true) {
  const raw = data.channelsFor(records, records.at(-1));
  const geared = sessions.savedGear(raw, metadata, windows, 0, 100, 100, complete);
  return { raw, geared, result: motorSpeed.withMotorDerivedSpeed(geared, metadata, 100) };
}
const derived = channels => channels.find(channel => channel.id === data.MOTOR_DERIVED_SPEED);

test('motor RPM uses wheel-to-motor ratio and event circumference, preserving recorded speed', () => {
  for (const source of ['424-phone', 'echook-history']) {
    const h = project(samples(true, source));
    const comparison = derived(h.result);
    assert.equal(comparison.unit, 'mph');
    assert.ok(comparison.points.every(point => Math.abs(point.value - 12.9 / .44704) < 1e-10));
    assert.ok(Math.abs(Number(comparison.value) - 12.9 / .44704) < 1e-6);
    assert.equal(h.result.find(channel => channel.id === data.VEHICLE_SPEED), h.raw.find(channel => channel.id === data.VEHICLE_SPEED));
    assert.equal(gps.timeAverage(h.result.find(channel => channel.id === data.VEHICLE_SPEED).points, 0, 100), 2 / .44704);
    const tuned = project(samples(), { ...event, wheelCircumferenceM: 1.4 });
    assert.ok(Math.abs(derived(tuned.result).points[0].value - 14 / .44704) < 1e-10);
  }
});

test('saved session teeth and exact adjacent boundaries select the effective ratio at each RPM timestamp', () => {
  const windows = [
    { id: 'a', startAt: 20, endAt: 40, overrides: { motorGearTeeth: 15 } },
    { id: 'b', startAt: 40, endAt: 60, overrides: { wheelGearTeeth: 72 } }
  ];
  const h = project(samples(), event, windows);
  const ratios = [5, 4, 4, 6, 6, 5, 5];
  derived(h.result).points.forEach((point, i) => assert.ok(Math.abs(point.value - 3000 / ratios[i] * 1.29 / 60 / .44704) < 1e-10));
});

test('RPM-only recordings retain one configurable Vehicle speed chart and no standalone derived chart', () => {
  const h = project(samples(false));
  const primary = h.result.find(channel => channel.id === data.VEHICLE_SPEED);
  assert.deepEqual(primary.points, []); assert.equal(primary.value, '—');
  assert.equal(view.chartHasData(primary, h.result), true);
  assert.deepEqual(view.telemetryCharts(h.result, [primary]).map(channel => channel.id), [data.VEHICLE_SPEED]);
  assert.equal(view.selectionFor(h.result).charts[data.VEHICLE_SPEED], true);
  assert.equal(view.selectionFor(h.result).charts[data.MOTOR_DERIVED_SPEED], undefined);
  assert.equal(view.configurableCharts(h.result).some(channel => channel.id === data.MOTOR_DERIVED_SPEED), false);
});

test('missing, invalid, incomplete or ambiguous metadata cannot produce invented speeds', () => {
  for (const h of [project(samples(), undefined, [], false), project(samples(), { ...event, defaults: {} }),
    project(samples(), { ...event, wheelCircumferenceM: 0 }), project(samples(), event, [], false),
    project(samples(), event, [{ id: 'a', startAt: 20, endAt: 40, overrides: {} }, { id: 'b', startAt: 20, endAt: 40, overrides: {} }])]) {
    assert.deepEqual(derived(h.result).points, []);
  }
  const empty = [];
  assert.equal(motorSpeed.withMotorDerivedSpeed(empty, event), empty);
  const zero = samples(false).map(sample => ({ ...sample, raw: '{"RPM":0}' }));
  assert.ok(derived(project(zero).result).points.every(point => point.value === 0));
});

test('calculation uses indexed gear points instead of scanning sessions for every RPM sample', () => {
  const h = project(samples(false));
  h.geared.find(channel => channel.id.startsWith('["Gear"]:')).valueAt = () => { throw new Error('Unexpected session scan'); };
  assert.equal(derived(motorSpeed.withMotorDerivedSpeed(h.geared, event, 100)).points.length, 7);
});


test('lap speeds always use the motor-derived signal with time weighting and no stale recorded fallback', () => {
  const samples = [0, 1000, 10000].map((receivedAt, i) => ({ id: String(i), source: '424-phone', receivedAt,
    raw: JSON.stringify({ RPM: i ? 4000 : 2000, Spd: 99 }) }));
  const raw = data.channelsFor(samples, samples.at(-1));
  const geared = sessions.savedGear(raw, event, [], 0, 10000, 10000);
  const channels = motorSpeed.withMotorDerivedSpeed(geared, event, 10000);
  const laps = [{ time: 0, end: 10000, lap: 1, complete: true, current: 12, speed: 999 },
    { time: 10000, end: 11000, lap: 2, complete: false, speed: 999 }];
  const result = motorSpeed.motorLapSpeeds(laps, channels);
  assert.ok(Math.abs(result[0].speed - 16.77 / .44704) < 1e-10, 'average weights elapsed time between RPM-derived samples');
  assert.equal(result[0].current, 12); assert.equal(result[0].time, 0); assert.equal(result[0].end, 10000);
  assert.equal(result[1].speed, undefined, 'incomplete laps have no speed average');
  assert.equal(laps[0].speed, 999, 'enrichment does not mutate cached GPS intervals');
  assert.equal(motorSpeed.motorLapSpeeds(laps, raw)[0].speed, undefined, 'recorded speed never substitutes for missing motor speed');
  const tuned = motorSpeed.withMotorDerivedSpeed(geared, { ...event, wheelCircumferenceM: 1.4 }, 10000);
  assert.ok(Math.abs(motorSpeed.motorLapSpeeds(laps, tuned)[0].speed - result[0].speed * 1.4 / 1.29) < 1e-10);
});

test('lap speed stays unavailable for RPM outages or incomplete interval coverage', () => {
  const lap = [{ time: 0, end: 20000, complete: true, speed: 99 }];
  for (const points of [[], [{ time: 1000, value: 20 }, { time: 20000, value: 20 }],
    [{ time: 0, value: 20 }, { time: 10000, value: 20 }], [{ time: 0, value: 20 }, { time: 20000, value: 20 }]]) {
    assert.equal(motorSpeed.motorLapSpeeds(lap, [{ id: data.MOTOR_DERIVED_SPEED, points }])[0].speed, undefined);
  }
});
