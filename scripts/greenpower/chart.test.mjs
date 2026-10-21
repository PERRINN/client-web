import assert from 'node:assert/strict';
import { test } from 'node:test';
import { data, load } from './load.mjs';
const vertical = load('../../src/app/telemetry/verticalAxis.ts');
const history = load('../../src/app/telemetry/sessionHistory.ts', { './verticalAxis': vertical });
const chart = load('../../src/app/greenpower-telemetry/greenpowerChart.ts', {
  './greenpowerData': data, '../telemetry/verticalAxis': vertical, '../telemetry/sessionHistory': history
});
test('race time readouts use minutes and seconds while plotted values retain minutes', () => {
  const samples = [0, 59.6, 1414, 3600].map((raceseconds, receivedAt) => ({ source: '424-phone', receivedAt, raw: JSON.stringify({ raceseconds }) }));
  const channel = data.channelsFor(samples, samples[2])[0];
  assert.equal(chart.scalarReadout(channel, undefined, 0, 3), '23m 34s');
  for (const [cursor, expected] of [[0, '0m 0s'], [1, '1m 0s'], [2, '23m 34s'], [3, '60m 0s']]) {
    assert.equal(chart.scalarReadout(channel, cursor, 0, 3), expected);
    assert.equal(chart.channelReadout(channel, channel.points[cursor].value, 0, 60), expected);
    assert.equal(chart.channelReadout(channel, channel.points[cursor].value, 0, 60, false), expected);
  }
  assert.equal(chart.scalarReadout(channel, 10, 5, 10), '—');
  assert.equal(chart.scalarReadout({ ...channel, value: '—' }, undefined, 0, 3), '—');
  assert.equal(chart.channelReadout(channel, NaN, 0, 60), '—');
  assert.equal(channel.points[2].value, 1414 / 60);
  assert.equal(chart.scalarReadout({ id: 'other', unit: 'A', value: '12', points: [] }, undefined, 0, 3), '12 A');
});
test('speed axes, cursor and latest scalar share mph values', () => {
  const samples = [0, 10].map((Spd, receivedAt) => ({ source: '424-phone', receivedAt, raw: JSON.stringify({ Spd }) }));
  const channel = data.channelsFor(samples, samples[1])[0];
  const model = chart.plotFor(channel.points, 0, 1, 300);
  assert.equal(channel.unit, 'mph');
  assert.equal(model.trace.max, 10 / 0.44704);
  assert.ok(model.axis.max >= model.trace.max && model.axis.min <= 0);
  assert.equal(chart.nearestPoint(channel.points, 1, 0, 1).value, model.trace.max);
  assert.equal(chart.scalarValue(channel, 1, 0, 1), '22.369363');
  assert.equal(chart.scalarValue(channel, undefined, 0, 1), '22.369363');
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

test('current chart fits measured readings and the 24 A limit', () => {
  assert.equal(chart.channelLimit({id: '["A"]:A'}), 24);
  assert.equal(chart.channelLimit({id: '["AH"]:Ah'}), 24);
  assert.equal(chart.channelLimit({id: '["A"]:mA'}), undefined);
  const points = Array.from({length: 160}, (_, time) => ({time, value: time < 149 ? 100 : 10}));
  const model = chart.plotFor(points, 150, 159, 300, chart.channelLimit({id: '["A"]:A'}));
  assert.equal(model.trace.min, 10);
  assert.equal(model.trace.max, 10);
  assert.ok(model.axis.min <= 10 && model.axis.max >= 24 && model.axis.max < 100);
  const high = chart.plotFor([{time: 0, value: 40}], 0, 0, 200, 24);
  assert.ok(high.axis.min <= 24 && high.axis.max >= 40);
  assert.ok(chart.chartY(24, high.axis) >= 10 && chart.chartY(24, high.axis) <= 110);
});

test('total voltage limit stays visible across readings, zoom and empty overlays', () => {
  const samples = [19, 21, 25].map((Vt, receivedAt) => ({ source: '424-phone', receivedAt, raw: JSON.stringify({ Vt }) }));
  const channel = data.channelsFor(samples, samples.at(-1))[0];
  const limit = chart.channelLimit(channel);
  assert.equal(limit, 21);
  assert.equal(chart.channelLimit({ id: '["V1"]:V' }), undefined);
  assert.equal(chart.channelLimit({ id: '["Vt"]:mV' }), undefined);
  for (const width of [200, 1000]) {
    for (const [start, end] of [[0, 2], [0, 0], [2, 2], [3, 4]]) {
      for (const overlay of [false, true]) {
        const model = chart.plotFor(overlay ? [] : channel.points, start, end, width, limit, [], overlay ? [channel.points] : []);
        const values = channel.points.filter(p => p.time >= start && p.time <= end).map(p => p.value);
        assert.ok(model.axis.min <= Math.min(limit, ...values));
        assert.ok(model.axis.max >= Math.max(limit, ...values));
        assert.ok(chart.chartY(limit, model.axis) >= 10 && chart.chartY(limit, model.axis) <= 110);
      }
    }
  }
});

test('paired battery voltages keep the 10 V limit and both traces visible through zoom', () => {
  const samples = [[18, 8], [22, 12], [24, 11]].map(([Vt, V1], receivedAt) =>
    ({ source: '424-phone', receivedAt, raw: JSON.stringify({ Vt, V1 }) }));
  const channels = data.channelsFor(samples, samples.at(-1));
  const left = channels.find(c => c.id === data.VOLTAGE_LEFT);
  const right = channels.find(c => c.id === data.VOLTAGE_RIGHT);
  assert.equal(chart.channelLimit(left), 10);
  assert.equal(chart.channelLimit(right), 10);
  assert.equal(chart.channelLimit(channels.find(c => c.id === data.VOLTAGE_DIFF)), undefined);
  for (const width of [200, 1000]) {
    for (const [start, end] of [[0, 2], [0, 0], [2, 2], [3, 4]]) {
      for (const overlay of [false, true]) {
        const model = chart.plotFor(overlay ? [] : left.points, start, end, width, 10,
          overlay ? [] : right.points, overlay ? [left.points, right.points] : []);
        const values = [...left.points, ...right.points].filter(p => p.time >= start && p.time <= end).map(p => p.value);
        assert.ok(model.axis.min <= Math.min(10, ...values));
        assert.ok(model.axis.max >= Math.max(10, ...values));
        assert.ok(chart.chartY(10, model.axis) >= 10 && chart.chartY(10, model.axis) <= 110);
      }
    }
  }
});

test('energy limit stays visible below and above 550 Wh, through zoom and empty overlays', () => {
  const limit = chart.channelLimit({ id: data.ENERGY });
  assert.equal(limit, 550);
  for (const values of [[0, 100], [600, 800], []]) {
    const points = values.map((value, time) => ({ time, value }));
    for (const overlay of [false, true]) {
      const model = chart.plotFor(overlay ? [] : points, 0, 1, 300, limit, [], overlay ? [points] : []);
      assert.ok(model.axis.min <= Math.min(limit, ...values));
      assert.ok(model.axis.max >= Math.max(limit, ...values));
      assert.ok(chart.chartY(limit, model.axis) >= 10 && chart.chartY(limit, model.axis) <= 110);
    }
  }
  const zoomed = chart.plotFor([{ time: 0, value: 2000 }, { time: 1, value: 100 }], 1, 1, 300, limit);
  assert.ok(zoomed.axis.min <= 100 && zoomed.axis.max >= limit && zoomed.axis.max < 2000);
});

test('comparison traces share an axis spanning both visible series', () => {
  const left=[{time:0,value:11},{time:1,value:12}], right=[{time:0,value:14},{time:1,value:15},{time:2,value:1000}];
  const model=chart.plotFor(left,0,1,390,undefined,right);
  assert.ok(model.axis.min<=11 && model.axis.max>=15 && model.axis.max<1000);
  assert.equal(model.trace.min,11); assert.equal(model.comparison.max,15);
  assert.doesNotMatch(model.comparison.path,/NaN|Infinity/);
  assert.equal(chart.plotFor([],0,1,320,undefined,right).empty,false);
});

test('overlay traces share an axis across every visible session without off-window extrema', () => {
  const series = [[{ time: 0, value: 1000 }, { time: 100, value: 5 }, { time: 200, value: 8 }],
    [{ time: 100, value: -12 }, { time: 200, value: 40 }]];
  const model = chart.plotFor([], 100, 200, 300, 24, [], series);
  assert.equal(model.overlays.length, 2);
  assert.ok(model.axis.min <= -12 && model.axis.max >= 40 && model.axis.max < 1000);
  assert.equal(model.overlays[0].max, 8);
  assert.ok(model.overlays.every(trace => !/NaN|Infinity/.test(trace.path)));
  assert.equal(model.empty, false);
  assert.equal(chart.elapsedTime(0), '0:00:00');
  assert.equal(chart.elapsedTime(3661000), '1:01:01');
  assert.equal(chart.elapsedTime(3599999.9999999995), '1:00:00');
});
