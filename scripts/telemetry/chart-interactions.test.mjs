import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

// Compile the dependency-free interaction helpers with the project's TypeScript.
function load(name) {
  const source = readFileSync(new URL(`../../src/app/telemetry/${name}.ts`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, id => {
    if (id === '@angular/platform-browser') return {};
    if (id === '@angular/core') return { Component: () => target => target };
    if (id === './telemetry.service') return {};
    return id.startsWith('./') ? load(id.slice(2)) : createRequire(import.meta.url)(id);
  });
  return exports;
}
const { ChartSelection } = load('chartSelection');
const { ChartNavigation } = load('chartNavigation');
const { ChartDoubleTap } = load('chartDoubleTap');
function chart() {
  const captured = new Set();
  return { getBoundingClientRect: () => ({ left: 100, width: 1000 }), blur() {},
    setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id), releasePointerCapture: id => captured.delete(id) };
}
function pointer(target, x, extra = {}) {
  return { currentTarget: target, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0,
    clientX: x, clientY: 20, timeStamp: 0, preventDefault() {}, ...extra };
}

test('overview background selects full-domain ranges in both drag directions', () => {
  for (const range of [{ start: 100, end: 200, origin: 100, duration: 1100 }, { start: 0, end: 1000, origin: 0, duration: 1000 }]) {
    for (const [from, to] of [[350, 850], [850, 350]]) {
      const svg = chart(), navigation = new ChartNavigation(), selection = new ChartSelection();
      assert.equal(navigation.start(pointer(svg, from), range, () => assert.fail('background must not pan')), false);
      selection.start(pointer(svg, from), { start: range.origin, end: range.duration });
      selection.move(pointer(svg, to));
      assert.deepEqual(selection.overviewBand(range.origin, range.duration), { x: 75, width: 150 });
      assert.deepEqual(selection.finish(pointer(svg, to)), { start: range.origin + 250, end: range.origin + 750 });
    }
  }
});

test('zoomed overview window still pans and both edges resize within bounds', () => {
  const svg = chart(), range = { start: 200, end: 600, origin: 0, duration: 1000 };
  for (const [from, to, expected] of [[500, 700, [400, 800]], [300, 200, [100, 600]], [700, 900, [200, 800]], [500, 2000, [600, 1000]]]) {
    const navigation = new ChartNavigation(); let result;
    assert.equal(navigation.start(pointer(svg, from), range, (...values) => result = values), true);
    navigation.move(pointer(svg, to)); navigation.end(pointer(svg, to));
    assert.deepEqual(result, expected);
  }
});

test('channel zoom uses the current window, clamps outside drags and ignores clicks/cancellation', () => {
  const svg = chart(), selection = new ChartSelection();
  selection.start(pointer(svg, 350), { start: 20, end: 60 });
  assert.deepEqual(selection.finish(pointer(svg, 2000)), { start: 30, end: 60 });
  selection.start(pointer(svg, 350), { start: 20, end: 60 });
  assert.equal(selection.finish(pointer(svg, 353)), undefined);
  selection.start(pointer(svg, 350), { start: 20, end: 60 }); selection.end(pointer(svg, 500));
  assert.equal(selection.finish(pointer(svg, 850)), undefined);
  assert.equal(selection.start(pointer(svg, 350, { button: 2 }), { start: 20, end: 60 }), false);
});

function tap(gesture, svg, time, x = 500, extra = {}) {
  gesture.start(pointer(svg, x, { pointerType: 'touch', timeStamp: time, ...extra }));
  return gesture.finish(pointer(svg, x, { pointerType: 'touch', timeStamp: time + 50, ...extra }));
}
test('double-tap resets only for nearby quick taps on the same chart; normal capture release is harmless', () => {
  const svg = chart(), gesture = new ChartDoubleTap();
  assert.equal(tap(gesture, svg, 0), false);
  gesture.cancel(pointer(svg, 500, { pointerType: 'touch' }));
  assert.equal(tap(gesture, svg, 200, 510), true);
  assert.equal(tap(gesture, svg, 400), false);
  assert.equal(tap(gesture, chart(), 600), false);
  assert.equal(tap(gesture, svg, 1000), false);
  assert.equal(tap(gesture, svg, 1200, 600), false);
  assert.equal(tap(gesture, svg, 1800, 600), false);
});

test('scrolls, drags, long presses, cancellation and multi-touch do not count as taps', () => {
  for (const action of ['horizontal', 'vertical', 'long', 'cancel', 'multitouch']) {
    const gesture = new ChartDoubleTap(), svg = chart();
    tap(gesture, svg, 0);
    gesture.start(pointer(svg, 500, { pointerType: 'touch', timeStamp: 150 }));
    if (action === 'horizontal') gesture.move(pointer(svg, 510));
    if (action === 'vertical') gesture.move(pointer(svg, 500, { clientY: 40 }));
    if (action === 'cancel') gesture.cancel(pointer(svg, 500));
    if (action === 'multitouch') {
      assert.equal(gesture.start(pointer(svg, 510, { pointerType: 'touch', pointerId: 2, isPrimary: false })), false);
      gesture.finish(pointer(svg, 510, { pointerId: 2 }));
    }
    assert.equal(gesture.finish(pointer(svg, 500, { timeStamp: action === 'long' ? 450 : 200 })), false, action);
    assert.equal(tap(gesture, svg, 500), false, action);
  }
});

test('mouse clicks never count as touch double-taps', () => {
  const gesture = new ChartDoubleTap(), svg = chart();
  gesture.start(pointer(svg, 500)); assert.equal(gesture.finish(pointer(svg, 500)), false);
  gesture.start(pointer(svg, 500)); assert.equal(gesture.finish(pointer(svg, 500)), false);
});


test('component shares overview/channel zoom and preserves taps across touch pointerleave', t => {
  const { TelemetryComponent } = load('telemetry.component');
  const component = new TelemetryComponent({ history: { length: 1, start: 100, end: 1100 }, disconnect() {} },
    { runOutsideAngular() {} }, { nativeElement: {} });
  t.after(() => component.ngOnDestroy());
  const svg = chart();
  for (const distance of [false, true]) {
    component.distanceAxis = distance; component.overlay.max = 1000;
    component.start = component.origin; component.end = component.duration;
    component.startNavigation(pointer(svg, 350)); component.moveNavigation(pointer(svg, 850)); component.finishNavigation(pointer(svg, 850));
    assert.equal(component.start, component.origin + 250);
    assert.equal(component.end, component.origin + 750);
    component.startDrag(pointer(svg, 350)); component.finishDrag(pointer(svg, 850));
    assert.equal(component.start, component.origin + 375);
    assert.equal(component.end, component.origin + 625);
    assert.equal(component.full, false);
    for (const overview of [false, true]) {
      const start = e => overview ? component.startNavigation(e) : component.startDrag(e);
      const finish = e => overview ? component.finishNavigation(e) : component.finishDrag(e);
      component.full = false;
      for (const time of [0, 200]) {
        start(pointer(svg, 600, { pointerType: 'touch', timeStamp: time }));
        finish(pointer(svg, 600, { pointerType: 'touch', timeStamp: time + 50 }));
        component.endDrag(pointer(svg, 600)); // lostpointercapture
        component.clearCursor(); // touch pointerleave
      }
      assert.equal(component.full, true);
      assert.equal(component.follow, false);
      assert.equal(component.selection.active, false);
    }
  }
});


test('telemetry page title is restored when leaving the page', () => {
  const { TelemetryComponent } = load('telemetry.component');
  let title = 'PERRINN';
  const component = new TelemetryComponent({ editor: { watch() {} }, openSample() {}, disconnect() {} },
    { runOutsideAngular() {} }, { nativeElement: {} }, { getTitle: () => title, setTitle: value => title = value });
  component.ngOnInit(); assert.equal(title, '424 Nürburgring Telemetry');
  component.ngOnDestroy(); assert.equal(title, 'PERRINN');
});


const { SessionHistory } = load('sessionHistory');
const { telemetryPlots } = load('telemetryPlots');
const { LapOverlay } = load('lapOverlay');
function historyOf(rows) {
  const history = new SessionHistory(rows[0].length);
  rows.forEach((values, i) => history.append({ sequence:i+1, frame:i, time:i*.02, simulationTime:i*.02, paused:false, values }));
  return history;
}
function channelsOf(...ids) { return ids.map(id => ({id, unit:'', sourceHz:50, available:true})); }

test('Y axes fit visible original samples, including previously fixed channels', () => {
  const channels = channelsOf('Speed', 'PowerBalanceDelivered', 'AeroDrsPosition', 'AutopilotDistanceError');
  const history = historyOf([[1000,0,0,-1000], [20,41,61,1], [21,42,62,2], [900,100,100,1000]]);
  const plots = telemetryPlots(history, channels, .02, .04, 1);
  for (const [i, min, max] of [[0,20,21],[1,41,42],[2,61,62],[3,1,2]]) {
    assert.equal(plots[i].min, min); assert.equal(plots[i].max, max);
    assert.ok(plots[i].axis.min <= min && plots[i].axis.max >= max);
    assert.ok(plots[i].axis.max - plots[i].axis.min < 10);
    assert.equal(plots[i].above + plots[i].below, '');
  }
  const full = telemetryPlots(history, channels, 0, .06, 1);
  assert.ok(full[0].axis.max >= 1000);
  assert.equal(full[3].axis.min, -500); assert.equal(full[3].axis.max, 500);
  assert.ok(full[3].above && full[3].below);
  const panned = telemetryPlots(history, channels, .04, .06, 1);
  assert.ok(panned[0].axis.max >= 900);
});

test('Y axes handle empty, missing and constant visible values without session extrema', () => {
  const channels = channelsOf('Speed', 'Brake');
  const history = historyOf([[999,100], [null,0], [NaN,0], [null,0]]);
  const plots = telemetryPlots(history, channels, .02, .06, 300);
  assert.equal(plots[0].path, ''); assert.deepEqual(plots[0].ticks, []);
  assert.ok(plots[1].axis.min < 0 && plots[1].axis.max > 0);
  assert.ok(plots[1].axis.max < 100);
  for (const plot of telemetryPlots(history, channels, 1, 2, 300)) {
    assert.equal(plot.path, ''); assert.deepEqual(plot.ticks, []);
    assert.ok(Number.isFinite(plot.axis.min) && Number.isFinite(plot.axis.max));
  }
});

test('distance Y axes combine visible laps and exclude outliers outside the distance window', () => {
  const channels = channelsOf('LapDistance', 'AeroBalance');
  const history = historyOf([[0,-1000], [10,40], [20,41], [30,999], [0,-999], [10,60], [20,61], [30,1000]]);
  const overlay = new LapOverlay();
  overlay.update(history, channels, [{number:1,start:0,end:.06,complete:true,sectors:[]}, {number:2,start:.08,end:.14,complete:true,sectors:[]}]);
  const plot = telemetryPlots(history, channels, 10, 20, 300, overlay)[1];
  assert.equal(plot.min, 40); assert.equal(plot.max, 61);
  assert.ok(plot.axis.min > 0 && plot.axis.max < 100);
  assert.equal(plot.layers.length, 2);
  assert.ok(plot.layers.every(layer => layer.path && !layer.above && !layer.below));
  const empty = telemetryPlots(history, channels, 100, 200, 300, overlay)[1];
  assert.deepEqual(empty.ticks, []); assert.ok(empty.layers.every(layer => !layer.path));
});

test('visible peaks survive range calculation before low-resolution reduction', () => {
  const rows = Array.from({length:100}, (_,i) => [i === 47 ? 1234 : 10]);
  const history = historyOf(rows);
  const plot = telemetryPlots(history, channelsOf('Speed'), .2, 1.5, 1)[0];
  assert.equal(plot.max,1234); assert.ok(plot.axis.max >= 1234);
  assert.ok(plot.path.includes('L'));
});


test('bounded channels autoscale within hard limits, including constant and out-of-range data', () => {
  const ids = ['PowerBalanceDelivered','WheelTorqueBalance','AeroBalance','AeroDrsPosition','RpmDiffFront','RpmDiffRear','AutopilotDistanceError'];
  for (const id of ids) {
    const min = id.includes('Balance') || id === 'AeroDrsPosition' ? 0 : -500, max = min === 0 ? 100 : 500;
    for (const values of [[min,max], [min,min], [max,max], [min-1000,max+1000], [max+1000,max+1000], [min-1000,min-1000]]) {
      const history = historyOf(values.map(value => [value]));
      const plot = telemetryPlots(history, channelsOf(id), 0, .02, 300)[0];
      assert.ok(plot.axis.min >= min && plot.axis.max <= max, id);
      assert.ok(plot.axis.max > plot.axis.min, id);
      assert.ok(plot.ticks.length && plot.ticks.every(tick => tick.value >= min && tick.value <= max), id);
      assert.equal(history.value(0,0), values[0]);
      if (values[0] < min) assert.ok(plot.below, id);
      if (values[1] > max) assert.ok(plot.above, id);
    }
    const plot = telemetryPlots(historyOf([[40],[41]]), channelsOf(id), 0, .02, 300)[0];
    assert.ok(plot.axis.max-plot.axis.min < 10, id);
  }
});

test('distance overlays apply the same hard limits and preserve edge markers', () => {
  const history = historyOf([[0,-900], [10,900]]), channels = channelsOf('LapDistance','RpmDiffFront');
  const overlay = new LapOverlay();
  overlay.update(history,channels,[{number:1,start:0,end:.02,complete:true,sectors:[]}]);
  const plot = telemetryPlots(history,channels,0,10,300,overlay)[1];
  assert.equal(plot.axis.min,-500); assert.equal(plot.axis.max,500);
  assert.ok(plot.layers[0].above && plot.layers[0].below);
});
