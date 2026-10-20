import assert from 'node:assert/strict';
import test from 'node:test';
import { load, data, dayData, gps } from './load.mjs';

const { sessionAmpHours } = load('../../src/app/greenpower-telemetry/greenpowerSessions.ts', {
  './greenpowerDay': dayData, './greenpowerData': data, './greenpowerGps': gps
});
const readings = () => data.channelsFor(Array.from({ length: 9 }, (_, time) => ({
  id: String(time), receivedAt: time, source: '424-phone', raw: JSON.stringify({ AH: 10 + time })
})))[0];
const session = (type, startAt, endAt) => ({ id: type, type, startAt, endAt });

test('each race and both dyno types start at zero, preserving raw readings and gaps', () => {
  const raw = readings(), before = structuredClone(raw);
  const sessions = [session('race', 1, 2), session('battery_dyno', 4, 5), session('motor_dyno', 7, 8)];
  const result = sessionAmpHours(raw, sessions, 8);
  assert.deepEqual(result.points.map(point => point.value), [10, 0, 1, 13, 0, 1, 16, 0, 1]);
  assert.equal(result.value, '1');
  assert.deepEqual(raw, before);
  assert.deepEqual(sessionAmpHours(raw, sessions, 8), result, 'repeated refreshes do not subtract twice');
  assert.equal(sessionAmpHours(raw, sessions, 6).value, raw.value, 'outside-session scalar stays raw');
});

test('historical ampH aliases, later readings and edited boundaries use the session baseline', () => {
  const samples = Array.from({ length: 5 }, (_, eventAt) => ({ id: String(eventAt), receivedAt: 100,
    eventAt, source: 'echook-history', raw: JSON.stringify({ ampH: 20 + eventAt }) }));
  const raw = data.channelsFor(samples, samples.at(-1))[0];
  assert.equal(sessionAmpHours(raw, [session('race', 1, 4)], 4).value, '3');
  assert.equal(sessionAmpHours(raw, [session('race', 2, 4)], 4).value, '2');
  const first = data.channelsFor(samples.slice(0, 2), samples[1])[0];
  assert.equal(sessionAmpHours(first, [session('race', 1, 4)], 1).value, '0');
  const result = sessionAmpHours(raw, [session('race', 1, 4)], 4);
  assert.deepEqual(result.points.filter(point => point.time >= 3).map(point => point.value), [2, 3],
    'zooming into a later range retains consumption from the original start');
});

test('practice, missing metadata, missing readings and ambiguous windows preserve existing values', () => {
  const raw = readings();
  for (const sessions of [[], [session('practice', 0, 8)], [session('race', 20, 30)],
    [session('race', 0, 8), session('practice', 2, 4)]]) {
    assert.deepEqual(sessionAmpHours(raw, sessions, 8), raw);
  }
  const missing = { ...raw, value: '—' };
  assert.equal(sessionAmpHours(missing, [session('race', 0, 8)], 8).value, '—');
  const empty = { ...raw, points: [] };
  assert.equal(sessionAmpHours(empty, [session('race', 0, 8)], 8), empty);
  const other = { ...raw, id: '["A"]:A' };
  assert.equal(sessionAmpHours(other, [session('race', 0, 8)], 8), other);
});
