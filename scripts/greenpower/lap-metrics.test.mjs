import assert from 'node:assert/strict';
import test from 'node:test';
import { data, load, lapMetrics } from './load.mjs';

const laps = [
  { time: 0, end: 60000, complete: true, speed: 25, current: 21, lap: 1 },
  { time: 60000, end: 90000, complete: false, lap: 2 },
  { time: 90000, end: 155000, complete: true, speed: 26, lap: 3 },
  { time: 155000, end: 180000, complete: false, lap: 4 }
];
const view = load('../../src/app/greenpower-telemetry/greenpowerView.ts', { './greenpowerData': data });

test('lap metrics reuse completed times and averages with seconds, mph and amps', () => {
  const channels = lapMetrics.lapMetricChannels(laps);
  assert.deepEqual(channels.map(channel => [channel.label, channel.unit]), [
    ['Lap time', 's'], ['Lap average speed · from motor', 'mph'], ['Lap average amps', 'A'], ['Lap average power', 'W']
  ]);
  assert.deepEqual(channels[0].points, [{ time: 60000, value: 60 }, { time: 155000, value: 65 }]);
  assert.deepEqual(channels[1].points, [{ time: 60000, value: 25 }, { time: 155000, value: 26 }]);
  assert.deepEqual(channels[2].points, [{ time: 60000, value: 21 }]);
  for (const channel of channels) {
    assert.ok(channel.points.every(point => point.time !== 90000 && point.time !== 180000), 'incomplete laps add no dot');
    assert.equal(channel.valueAt, undefined, 'cursor uses real lap-finish points');
    assert.deepEqual(data.channelDetails(channel.id), { label: channel.label, unit: channel.unit });
  }
});

test('completed lap finish points connect as one normal line without fabricated intermediate dots', () => {
  const channel = lapMetrics.lapMetricChannels(laps)[0];
  const path = data.chartTrace(channel.points, 0, 180000, 390, { min: 50, max: 70 }).path;
  assert.equal((path.match(/M/g) ?? []).length, 1);
  assert.ok(path.includes('L'));
  assert.doesNotMatch(path, /NaN|Infinity/);
  assert.equal(data.chartTrace(channel.points, 70000, 80000, 390).path, '', 'zoom never invents lap completions');
});

test('metric plots respect selected visibility and order', () => {
  const channels = lapMetrics.lapMetricChannels(laps);
  const saved = { id: 'raw', label: 'Current', unit: 'A', value: '20', points: [{ time: 0, value: 20 }] };
  assert.deepEqual(view.telemetryCharts([saved, ...channels], [saved, channels[0]]).map(channel => channel.id),
    ['raw', channels[0].id]);
  assert.equal(view.configurableCharts(channels).length, 4);
  assert.deepEqual(view.selectionFor(channels).charts, Object.fromEntries(channels.filter(c => c.points.length).map(c=>[c.id,true])));
  assert.deepEqual(view.telemetryCharts(lapMetrics.lapMetricChannels([]), []), []);
});

test('invalid and zero-duration summaries cannot create values or paths', () => {
  const invalid = [{ time: 0, end: 0, complete: true }, { time: 0, end: 10, complete: true, speed: NaN, current: Infinity }];
  const channels = lapMetrics.lapMetricChannels(invalid);
  assert.equal(channels[0].points.length, 1);
  assert.equal(channels[1].points.length, 0);
  assert.equal(channels[2].points.length, 0);

});

test('lap power time-weights same-payload watts over completed lap boundaries', () => {
  const samples = [[0, 20, 10], [1000, 30, 20], [4000, 20, 10]].map(([time, Vt, A]) =>
    ({ id: String(time), receivedAt: time, source: '424-phone', raw: JSON.stringify({ Vt, A }) }));
  const channels = data.channelsFor(samples);
  const laps = [{ time: 500, end: 2500, complete: true }, { time: 2500, end: 4000, complete: false }];
  const power = lapMetrics.lapMetricChannels(laps, channels).find(c => c.id === 'computed:lap-average-power');
  assert.deepEqual(power.points, [{ time: 2500, value: 500 }]);
  assert.equal(power.value, '500');
  assert.equal(data.isLapMetric(power.id), true);
  assert.ok(data.COMPUTED_CHANNEL_IDS.includes(power.id));
  assert.ok(view.editorChannels([], { scalars: {}, charts: {} }).some(c => c.id === power.id));
});

test('lap power omits missing coverage, outages, non-finite averages and incomplete laps', () => {
  const lap = { time: 0, end: 20000, complete: true };
  for (const points of [[], [{ time: 1, value: 500 }, { time: 20000, value: 500 }],
    [{ time: 0, value: 500 }, { time: 20000, value: 500 }],
    [{ time: 0, value: Infinity }, { time: 10000, value: 500 }, { time: 20000, value: 500 }]]) {
    const power = lapMetrics.lapMetricChannels([lap], [{ id: data.POWER, points }]).at(-1);
    assert.deepEqual(power.points, []);
    assert.equal(power.value, '—');
  }
});
