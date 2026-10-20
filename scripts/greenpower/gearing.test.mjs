import assert from 'node:assert/strict';
import test from 'node:test';
import { load, data, dayData, gps } from './load.mjs';

const sessions = load('../../src/app/greenpower-telemetry/greenpowerSessions.ts', {
  './greenpowerDay': dayData, './greenpowerData': data, './greenpowerGps': gps
});
const vertical = load('../../src/app/telemetry/verticalAxis.ts');
const history = load('../../src/app/telemetry/sessionHistory.ts', { './verticalAxis': vertical });
const chart = load('../../src/app/greenpower-telemetry/greenpowerChart.ts', {
  './greenpowerData': data, '../telemetry/verticalAxis': vertical, '../telemetry/sessionHistory': history
});
const overlay = load('../../src/app/greenpower-telemetry/greenpowerOverlay.ts', {
  './greenpowerData': data, './greenpowerDay': dayData, './greenpowerSessions': sessions
});
const event = { ...dayData.emptyDay('2026-06-14'), defaults: { motorGearTeeth: 12, wheelGearTeeth: 60 } };
const race = { id: 'race', type: 'race', startAt: 20, endAt: 40, overrides: { motorGearTeeth: 15 } };
const raw = data.channelsFor([0, 100].map(receivedAt => ({ receivedAt, source: 'echook-history', raw: '{"gear":99}' })));
const gear = (metadata = event, windows = [race], complete = true) => sessions.savedGear(raw, metadata, windows, 0, 100, 30, complete)[0];

test('saved gearing replaces historical sensor values without changing raw channels or selections', () => {
  const before = structuredClone(raw), result = gear();
  assert.equal(result.id, raw[0].id);
  assert.equal(result.value, '4');
  assert.equal(result.valueAt(10), 5);
  assert.equal(result.valueAt(20), 4);
  assert.equal(result.valueAt(40), 4);
  assert.equal(result.valueAt(41), 5);
  assert.ok(result.points.every(point => point.value === 4 || point.value === 5));
  assert.deepEqual(raw, before);
  assert.equal(sessions.savedGear([], event, [], 0, 100, 100)[0].value, '5', 'saved gearing needs no sensor gear');
});

test('cursor and zoom use the effective ratio at the exact time, including adjacent session boundaries', () => {
  const next = { ...race, id: 'next', startAt: 40, endAt: 60, overrides: { wheelGearTeeth: 72 } };
  const result = gear(event, [race, next]);
  assert.equal(chart.scalarValue(result, 39.999, 35, 45), '4');
  assert.equal(chart.scalarValue(result, 40, 35, 45), '6');
  assert.deepEqual(chart.channelReading(result, 40, 35, 45), { time: 40, value: 6 });
  assert.equal(chart.scalarValue(result, undefined, 35, 45), '4');
});

test('missing, partial and ambiguous metadata never fall back to recorded gear or draw across unknown ratios', () => {
  for (const result of [gear(null), gear({ ...event, defaults: {} }, []), gear(event, [race], false),
    gear(event, [race, { ...race, id: 'overlap' }])]) {
    assert.equal(result.value, '—');
    assert.equal(chart.scalarValue(result, 30, 0, 100), '—');
    assert.deepEqual(result.points, []);
  }
  const incomplete = gear({ ...event, defaults: {} });
  assert.equal(chart.scalarValue(incomplete, 30, 0, 100), '—');
});

test('overlays inherit event teeth and apply session overrides before shifting to elapsed time', () => {
  const samples = [20, 30, 40].map(receivedAt => ({ id: String(receivedAt), receivedAt, source: '424-phone', raw: '{"Gear":99}' }));
  const result = overlay.overlayChannels(samples, race, event)[0];
  assert.equal(result.value, '4');
  assert.deepEqual(result.points, [{ time: 0, value: 4 }, { time: 20, value: 4 }]);
  assert.equal(chart.channelReading(result, 10, 0, 20).value, 4);
});
