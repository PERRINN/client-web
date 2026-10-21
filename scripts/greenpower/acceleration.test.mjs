import assert from 'node:assert/strict';
import test from 'node:test';
import { data, load, dayData, gps, tracks, lapMetrics, motorSpeed } from './load.mjs';
const sessions = load('../../src/app/greenpower-telemetry/greenpowerSessions.ts', {
  './greenpowerData': data, './greenpowerDay': dayData, './greenpowerGps': gps
});
const overlay = load('../../src/app/greenpower-telemetry/greenpowerOverlay.ts', {
  './greenpowerData': data, './greenpowerDay': dayData, './greenpowerSessions': sessions,
  './greenpowerGps': gps, './greenpowerTracks': tracks, './greenpowerLapMetrics': lapMetrics, './greenpowerSpeed': motorSpeed
});
const sample = (value, unit, time = 1000, source = '424-phone', name = 'AccelX') => ({
  id: String(time), receivedAt: time, source,
  raw: JSON.stringify({ [name]: unit ? { value, unit } : value })
});

test('acceleration converts SI and named unitless readings to g while preserving recordings and saved IDs', () => {
  for (const source of ['424-phone', 'echook-history']) {
    for (const unit of ['', 'm/s²', 'm/s^2', 'm/s2', 'm/s/s', 'g', 'G']) {
      for (const value of [-9.80665, 0, 9.80665, 4.903325]) {
        const row = sample(value, unit, 1000, source), before = structuredClone(row);
        const channel = data.channelsFor([row], row)[0];
        const expected = ['g', 'G'].includes(unit) ? value : value / 9.80665;
        assert.equal(channel.id, '["AccelX"]:' + unit);
        assert.equal(channel.unit, 'g');
        assert.ok(Math.abs(channel.points[0].value - expected) < 1e-12);
        assert.equal(channel.value, data.displayValue(expected));
        assert.equal(data.formatChannelNumber(channel, channel.points[0].value), expected.toFixed(1));
        assert.equal(data.channelDetails(channel.id).unit, 'g');
        assert.deepEqual(data.mergeChannels([[channel]], row), [channel], 'merging never converts twice');
        data.updateValues([channel], sample(0, unit, 2000, source));
        assert.equal(channel.value, '0');
        assert.equal(channel.points[0].value, data.channelsFor([row])[0].points[0].value);
        assert.deepEqual(row, before);
      }
    }
  }
});

test('nested axis channels convert without changing unrelated or unsupported units', () => {
  const raw = JSON.stringify({ imu: { AccelY: 9.80665, AccZ: -9.80665 },
    alt: 42, temperature: 24, unknown: 9.80665, acceleration: { value: 10, unit: 'unknown' } });
  const channels = data.channelsFor([{ id: 'a', receivedAt: 1000, source: '424-phone', raw }]);
  assert.equal(channels[0].unit, 'g');
  assert.equal(channels[0].value, '1');
  assert.equal(channels[1].value, '-1');
  assert.equal(channels[2].value, '42');
  assert.equal(channels[4].value, '9.80665');
  assert.equal(channels[5].value, '10');
  assert.equal(channels[5].unit, 'unknown');
});

test('overlays use g values and elapsed timestamps from the shared projection', () => {
  const rows = [sample(9.80665, 'm/s2'), sample(-4.903325, 'm/s2', 2000)];
  const channel = overlay.overlayChannels(rows, { id: 'race', type: 'race', startAt: 1000, endAt: 2000, overrides: {} })
    .find(item => item.id === '["AccelX"]:m/s2');
  assert.equal(channel.unit, 'g');
  assert.deepEqual(channel.points, [{ time: 0, value: 1 }, { time: 1000, value: -.5 }]);
  assert.equal(data.formatChannelNumber(channel, channel.points[0].value), '1.0');
  assert.equal(data.formatChannelNumber(channel, channel.points[1].value), '-0.5');
});
