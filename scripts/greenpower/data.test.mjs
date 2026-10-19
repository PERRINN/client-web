import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { data, sample } from './load.mjs';

test('live and historical speed projections use mph without changing raw values or saved IDs', () => {
  for (const [source, raw] of [['424-phone', '{"Spd":10,"RPM":1000}'], ['echook-history', '{"speed":10,"rpm":1000}']]) {
    const first = { ...sample(0), source, raw };
    const latest = { ...first, receivedAt: first.receivedAt + 3000 };
    const channels = data.channelsFor([first], latest);
    const speed = channels.find(c => c.label === 'Vehicle speed');
    assert.equal(speed.id, '["Spd"]:m/s');
    assert.equal(speed.unit, 'mph');
    assert.equal(speed.value, '22.369363');
    assert.equal(speed.points[0].value, 10 / 0.44704);
    assert.deepEqual(data.channelDetails(speed.id), { label: 'Vehicle speed', unit: 'mph' });
    assert.equal(channels.find(c => c.label === 'Motor speed').unit, 'rpm');
    const merged = data.mergeChannels([channels], latest);
    assert.deepEqual(merged.find(c => c.id === speed.id), speed, 'merging and live refresh do not convert twice');
    assert.equal(first.raw, raw);
    data.updateValues(channels, { ...latest, raw: source === '424-phone' ? '{"Spd":0}' : '{"speed":0}' });
    assert.equal(speed.value, '0');
  }
});
test('explicit speed units convert values while missing and unrelated readings stay intact', () => {
  for (const [unit, value] of [['m/s', 0.44704], ['km/h', 1.609344], ['kph', 1.609344], ['mph', 1]]) {
    const raw = JSON.stringify({ Spd: { value, unit }, missing: { value: null, unit }, A: 12 });
    const channels = data.channelsFor([{ ...sample(0), raw }]);
    const speed = channels.find(c => c.label === 'Vehicle speed');
    assert.equal(speed.unit, 'mph');
    assert.equal(speed.value, '1');
    assert.ok(Math.abs(speed.points[0].value - 1) < 1e-12);
    assert.equal(data.channelDetails(speed.id).unit, 'mph');
    assert.equal(channels.find(c => c.label === 'missing').value, '—');
    assert.equal(channels.find(c => c.label === 'missing').points.length, 0);
    assert.equal(channels.find(c => c.label === 'Current').value, '12');
  }
});
test('dynamic numeric and other fields appear; explicit units and unusual keys remain distinct', () => {
  const fields = data.fields('{"Spd":10,"custom":{"value":2,"unit":"mm","quality":"good"},"a/b":3,"a":{"b":4},"array":[1,2],"status":"running"}');
  assert.equal(fields.find(f => f.label === 'Vehicle speed').unit, 'm/s');
  assert.equal(fields.find(f => f.label === 'custom').unit, 'mm');
  assert.ok(fields.some(f => f.label === 'custom / quality'));
  assert.equal(new Set(fields.map(f => f.id)).size, fields.length);
  const channels = data.channelsFor([{ ...sample(0), raw: '{"value":2,"status":"running"}' }]);
  assert.equal(channels.find(c => c.label === 'value').points.length, 1);
  assert.equal(channels.find(c => c.label === 'status').points.length, 0);
});
test('latest payload controls scalars and missing fields do not masquerade as current', () => {
  const first = { ...sample(0), raw: '{"Spd":2,"A":3}' }, last = { ...sample(1), raw: '{"Spd":0}' };
  const channels = data.channelsFor([first, last], last);
  assert.equal(channels.find(c => c.label === 'Current').value, '—');
  assert.equal(channels.find(c => c.label === 'Vehicle speed').value, '0');
  assert.equal(channels.find(c => c.label === 'Current').points.length, 1);
});
test('plot decimation preserves a one-sample spike and stays proportional to pixels', () => {
  const points = Array.from({ length: 28800 }, (_, time) => ({ time, value: time === 12345 ? 1000 : 0 }));
  const trace = data.chartTrace(points, 0, 28800);
  assert.equal(trace.max, 1000); assert.equal(trace.min, 0);
  assert.match(trace.path, /,10\.00/);
  assert.ok((trace.path.match(/[ML]/g) || []).length <= 1200);
});
test('full-day synthetic processing preserves 28,800 samples; live update reparses only its chunk', () => {
  const samples = Array.from({ length: 28800 }, (_, i) => sample(i));
  const start = performance.now(), chunks = [];
  for (let index = 0; index < samples.length; index += 32) chunks.push(data.channelsFor(samples.slice(index, index + 32)));
  const channels = data.mergeChannels(chunks, samples.at(-1));
  const initialMs = performance.now() - start;
  assert.equal(channels.find(c => c.label === 'Vehicle speed').points.length, samples.length);
  const updateStart = performance.now();
  chunks[chunks.length - 1] = data.channelsFor(samples.slice(-32));
  const updated = data.mergeChannels(chunks, samples.at(-1));
  updated.forEach(c => data.chartTrace(c.points, samples[0].receivedAt, samples.at(-1).receivedAt));
  console.log(JSON.stringify({ samples: samples.length, chunks: chunks.length, channels: channels.length, initialMs: Math.round(initialMs), updateAndPlotsMs: Math.round(performance.now() - updateStart) }));
});
test('UK day boundaries differ correctly from UTC in summer', () => {
  assert.equal(data.londonDay(Date.parse('2026-07-01T23:30:00Z')), '2026-07-02');
  assert.equal(data.londonDay(Date.parse('2026-01-01T23:30:00Z')), '2026-01-01');
});
test('extreme finite channel values cannot overflow chart coordinates', () => {
  const trace = data.chartTrace([{ time: 0, value: -1e308 }, { time: 1, value: 1e308 }], 0, 1);
  assert.doesNotMatch(trace.path, /NaN|Infinity/);
  assert.match(trace.path, /,110\.00/); assert.match(trace.path, /,10\.00/);
});
