import assert from 'node:assert/strict';
import { test } from 'node:test';
import { data, load } from './load.mjs';
const vertical = load('../../src/app/telemetry/verticalAxis.ts');
const history = load('../../src/app/telemetry/sessionHistory.ts', { './verticalAxis': vertical });
const chart = load('../../src/app/greenpower-telemetry/greenpowerChart.ts', {
  './greenpowerData': data, '../telemetry/verticalAxis': vertical, '../telemetry/sessionHistory': history
});
test('visible window controls extrema and rounded axes without off-window spikes', () => {
  const points = [{time:0,value:1000},{time:1,value:24.1},{time:2,value:24.8},{time:3,value:-1000}];
  const {axis,trace}=chart.plotFor(points,1,2,300);
  assert.equal(trace.min,24.1); assert.equal(trace.max,24.8);
  assert.ok(axis.min<=24.1 && axis.max>=24.8 && axis.max<26);
  assert.doesNotMatch(trace.path,/NaN|Infinity/);
  assert.ok(axis.ticks.length<=5);
  const expected=vertical.verticalAxis(24.1,24.8);
  assert.equal(axis.min,expected.min); assert.equal(axis.max,expected.max);
});
test('signed and constant channels share Nürburgring axis policy; empty windows stay finite', () => {
  for (const values of [[-12,8],[52,52],[0,0],[]]) {
    const points=values.map((value,time)=>({time,value}));
    const {axis,trace}=chart.plotFor(points,0,5,200);
    assert.ok(Number.isFinite(axis.min) && Number.isFinite(axis.max) && axis.max>axis.min);
    assert.doesNotMatch(trace.path,/NaN|Infinity/);
    if(values.length) assert.ok(axis.min<=Math.min(...values) && axis.max>=Math.max(...values));
  }
});
test('extreme finite numbers remain renderable with rounded axes', () => {
  for(const values of [[-1e308,1e308],[Number.MAX_VALUE,Number.MAX_VALUE],[1e-200,2e-200]]) {
    const {axis,trace}=chart.plotFor(values.map((value,time)=>({time,value})),0,1,200);
    assert.ok(Number.isFinite(axis.min) && Number.isFinite(axis.max));
    assert.doesNotMatch(trace.path,/NaN|Infinity/);
  }
});
test('cursor uses original nearest sample and never borrows data outside visible window', () => {
  const points=[{time:0,value:1},{time:3,value:8},{time:6,value:2}];
  assert.equal(chart.nearestPoint(points,2.7,0,6),points[1]);
  assert.equal(chart.nearestPoint(points,5,0,6),points[2]);
  assert.equal(chart.nearestPoint(points,4,3.5,5),undefined);
  assert.equal(chart.nearestPoint([],0,0,1),undefined);
});
test('clock ticks respect width, fractional seconds and London daylight saving', () => {
  const start=Date.parse('2026-07-01T12:00:00Z');
  const wide=chart.clockTicks(start,start+3600000,1000),small=chart.clockTicks(start,start+3600000,150);
  assert.ok(wide.length>small.length);
  assert.match(wide[0].label,/13:00:00/);
  assert.match(chart.clockTicks(start,start+200,300)[0].label,/\.\d{3}$/);
  assert.deepEqual(chart.clockTicks(1,1,300),[]);
});
test('scalars follow the nearest visible cursor sample and restore latest values on dismissal', () => {
  const channel = { value: '99', points: [{ time: 0, value: 0 }, { time: 3, value: 8.1234567 }, { time: 6, value: 2 }] };
  assert.equal(chart.scalarValue(channel, undefined, 0, 6), '99');
  assert.equal(chart.scalarValue(channel, 0, 0, 6), '0');
  assert.equal(chart.scalarValue(channel, 2.7, 0, 6), '8.123457');
  assert.equal(chart.scalarValue(channel, 5, 0, 6), '2');
  assert.equal(chart.scalarValue(channel, 4, 3.5, 5), '—');
  assert.equal(chart.scalarValue({value:'running',points:[]}, 3, 0, 6), '—');
  assert.equal(channel.value, '99', 'inspection does not overwrite live values');
  channel.value = '100';
  assert.equal(chart.scalarValue(channel, 3, 0, 6), '8.123457', 'live updates preserve inspection');
  assert.equal(chart.scalarValue(channel, undefined, 0, 6), '100');
});

test('150-reading trailing average waits for a full window and drops the oldest reading', () => {
  const points = Array.from({length: 151}, (_, time) => ({time, value: time + 1}));
  const original = structuredClone(points);
  assert.deepEqual(chart.trailingAverage(points.slice(0, 149)), []);
  const average = chart.trailingAverage(points);
  assert.equal(average.length, 2);
  assert.equal(average[0].time, 149);
  assert.ok(Math.abs(average[0].value - 75.5) < 1e-9);
  assert.ok(Math.abs(average[1].value - 76.5) < 1e-9);
  assert.deepEqual(points, original, 'recorded readings are untouched');
  assert.deepEqual(chart.trailingAverage([]), []);
  assert.throws(() => chart.trailingAverage(points, 0));
});

test('average counts readings rather than elapsed time, including zero and negative current', () => {
  const points = [{time: 0, value: -3}, {time: 1, value: 0}, {time: 900000, value: 9}];
  assert.deepEqual(chart.trailingAverage(points, 3), [{time: 900000, value: 2}]);
  assert.deepEqual(chart.trailingAverage(points, 1), points);
  assert.equal(chart.isCurrentChannel({id: '["A"]:A'}), true);
  assert.equal(chart.isCurrentChannel({id: '["AH"]:Ah'}), false);
  assert.equal(chart.isCurrentChannel({id: '["A"]:mA'}), false);
});

test('zoom keeps full preceding average history and fits both traces plus the 24 A limit', () => {
  const points = Array.from({length: 160}, (_, time) => ({time, value: time < 149 ? 100 : 10}));
  const average = chart.trailingAverage(points);
  const model = chart.plotFor(points, 150, 159, 300, average, chart.CURRENT_LIMIT_AMPS);
  assert.equal(model.trace.min, 10);
  assert.ok(model.axis.max >= average[1].value);
  assert.ok(model.axis.min <= 24 && model.axis.max >= 24);
  assert.ok(model.averageTrace.path);
  assert.doesNotMatch(model.averageTrace.path, /NaN|Infinity/);
  const low = chart.plotFor([{time: 0, value: 1}], 0, 0, 200, [], 24);
  assert.ok(low.axis.max >= 24 && low.axis.min <= 1);
  assert.ok(chart.chartY(24, low.axis) >= 10 && chart.chartY(24, low.axis) <= 110);
  const high = chart.plotFor([{time: 0, value: 40}], 0, 0, 200, [], 24);
  assert.ok(high.axis.min <= 24 && high.axis.max >= 40);
});
