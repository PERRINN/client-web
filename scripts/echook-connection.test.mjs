import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(file, dependencies = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/app/prototypes/echook-connection/' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true }
  }).outputText;
  new Function('exports', 'require', source)(exports, name => dependencies[name] || require(name));
  return exports;
}
const protocol = load('echookProtocol.ts');
const { EchookDecoder } = protocol;
const { EchookConnectionService } = load('echookConnection.service.ts', {
  '@angular/core': { Injectable: () => value => value }, './echookProtocol': protocol
});
const packet = (id, a, b) => [123, id.charCodeAt(0), a, b, 125];
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

test('decodes fragmented and combined packets, current/legacy zero and integer flag', () => {
  const decoder = new EchookDecoder(), readings = [];
  const receive = reading => readings.push(reading);
  decoder.push(Uint8Array.from([9, 123, 118, 24]), 10, receive);
  decoder.push(Uint8Array.from([75, 125, ...packet('i', 255, 50), ...packet('m', 140, 34), ...packet('s', 0, 0), ...packet('a', 255, 255)]), 20, receive);
  assert.deepEqual(readings.map(r => [r.id, r.value]), [['v', 24.75], ['i', .5], ['m', 1234], ['s', 0], ['a', 0]]);
  assert.equal(readings[0].unit, 'V'); assert.equal(readings[3].unit, 'm/s');
});
test('resynchronizes after corruption, handles framing bytes as data, preserves unknown channels', () => {
  const decoder = new EchookDecoder(), readings = [];
  const bytes = [123, 118, 2, 101, 5, ...packet('s', 123, 45), ...packet('m', 125, 0), ...packet('?', 1, 2)];
  for (const byte of bytes) decoder.push(Uint8Array.of(byte), 42, r => readings.push(r));
  assert.deepEqual(readings.map(r => r.value), [123.45, 125, 1.02]);
  assert.equal(readings[2].label, 'Channel ?');
  decoder.push(Uint8Array.from([123, 118, 1]), 0, () => {}); decoder.reset();
  decoder.push(Uint8Array.from([2, 125]), 0, () => assert.fail('Reset must discard partial packet'));
});
test('noise does not accumulate state', () => {
  const decoder = new EchookDecoder();
  decoder.push(new Uint8Array(100000).fill(123), 0, () => assert.fail());
  assert.ok(decoder.pending.length <= 4);
});

function fixture(t, request) {
  const originals = Object.fromEntries(['window', 'navigator', 'document'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  let source, opens = 0, closes = 0, requests = 0, lookups = 0;
  const stream = () => new ReadableStream({ start(controller) { source = controller; } });
  const port = { readable: stream(), getInfo: () => ({ bluetoothServiceClassId: '00001101-0000-1000-8000-00805f9b34fb' }),
    async open(options) { opens++; assert.equal(options.baudRate, 115200); this.readable = stream(); }, async close() { closes++; } };
  const serial = Object.assign(new EventTarget(), { grants: [port],
    async getPorts() { lookups++; return this.grants; }, requestPort(options) {
      requests++; assert.equal(options.filters[0].bluetoothServiceClassId, '00001101-0000-1000-8000-00805f9b34fb');
      return request ? request(port) : Promise.resolve(port);
    } });
  const document = Object.assign(new EventTarget(), { hidden: false });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { isSecureContext: true } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  const zone = { run: fn => fn(), runOutsideAngular: fn => fn() };
  const service = new EchookConnectionService(zone);
  t.after(async () => {
    service.ngOnDestroy(); await flush();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return { service, port, serial, document, zone, send: bytes => source.enqueue(Uint8Array.from(bytes)), end: () => source.close(),
    counts: () => ({ opens, closes, requests }), lookups: () => lookups,
    visible(value) { document.hidden = !value; document.dispatchEvent(new Event('visibilitychange')); },
    available() { const event = new Event('connect'); Object.defineProperty(event, 'port', { value: port }); serial.dispatchEvent(event); } };
}
test('single connection keeps latest values and closes on disconnect', async t => {
  const f = fixture(t); f.service.connect(); f.service.connect(); await flush();
  assert.equal(f.service.state$.value.status, 'connected');
  f.send([...packet('v', 24, 1), ...packet('v', 24, 2)]); await flush();
  await f.service.disconnect();
  assert.equal(f.service.state$.value.readings.length, 1);
  assert.equal(f.service.state$.value.readings[0].value, 24.02);
  assert.deepEqual(f.counts(), { opens: 1, closes: 1, requests: 1 });
  assert.equal(f.port.readable.locked, false);
});
test('cancel while chooser pending never opens late selected port', async t => {
  let resolve;
  const f = fixture(t, () => new Promise(r => { resolve = r; }));
  f.service.connect(); const stopped = f.service.disconnect(); resolve(f.port); await stopped;
  assert.deepEqual(f.counts(), { opens: 0, closes: 0, requests: 1 });
  assert.equal(f.service.state$.value.status, 'idle');
});
test('cancel while opening closes late opened port', async t => {
  let resolve;
  const f = fixture(t); f.port.open = () => new Promise(r => { resolve = r; });
  f.service.connect(); await flush(); const stopped = f.service.disconnect(); resolve(); await stopped;
  assert.equal(f.counts().closes, 1); assert.equal(f.port.readable.locked, false);
});
test('unexpected end recovers using the saved grant without another chooser', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t); f.service.connect(); await flush(); f.end(); await flush();
  assert.equal(f.service.state$.value.status, 'error');
  assert.equal(f.counts().requests, 1); assert.equal(f.counts().closes, 1);
  t.mock.timers.tick(1000); await flush();
  assert.equal(f.counts().opens, 2); assert.equal(f.counts().requests, 1);
  assert.equal(f.service.state$.value.status, 'connected');
});
test('chooser dismissal stays idle, open failure shows an error', async t => {
  const f = fixture(t, () => Promise.reject(new DOMException('Cancelled', 'NotFoundError')));
  f.service.connect(); await flush(); assert.equal(f.service.state$.value.status, 'idle');
  f.port.open = async () => { throw new Error('Busy'); };
  navigator.serial.requestPort = () => Promise.resolve(f.port);
  f.service.connect(); await flush(); assert.equal(f.service.state$.value.status, 'error');
});
test('destroy cancels read and releases the stream', async t => {
  const f = fixture(t); f.service.connect(); await flush(); f.service.ngOnDestroy(); await flush();
  assert.equal(f.counts().closes, 1); assert.equal(f.port.readable.locked, false);
});
test('unsupported browser prevents chooser access', t => {
  const f = fixture(t); delete navigator.serial;
  const service = new EchookConnectionService({ run: fn => fn(), runOutsideAngular: fn => fn() });
  assert.match(service.unavailable, /Chrome on Android/); service.connect();
  assert.equal(f.counts().requests, 0); service.ngOnDestroy();
});

const { dashboardMetrics } = load('echookDashboard.ts');
const reading = (id, value, at = 10000) => ({ id, value, at });
test('dashboard uses mph and the same left/right voltage mapping as telemetry', () => {
  const metrics = dashboardMetrics([reading('s', 4.4704), reading('w', 12.2), reading('v', 24.6)], true, 10000);
  assert.ok(Math.abs(metrics[0].value - 10) < 1e-10);
  assert.equal(metrics[0].unit, 'mph');
  assert.equal(metrics[1].value, 12.2);
  assert.ok(Math.abs(metrics[2].value - 12.4) < 1e-10);
  assert.deepEqual(metrics.slice(0, 3).map(metric => metric.status), ['Live', 'Live', 'Live']);
});
test('dashboard preserves zero and hides missing, stale or disconnected values', () => {
  const metrics = dashboardMetrics([reading('s', 0), reading('w', 12)], true, 15000);
  assert.equal(metrics[0].value, 0); assert.equal(metrics[2].value, undefined);
  assert.equal(metrics[2].status, 'Waiting');
  const old = dashboardMetrics([reading('s', 3), reading('w', 12), reading('v', 24, 15001)], true, 15001);
  assert.equal(old[1].status, 'Stale'); assert.equal(old[2].status, 'Stale');
  assert.equal(old[2].value, undefined, 'A fresh total cannot make an old lower voltage fresh');
  assert.ok(dashboardMetrics([reading('s', 2)], false, 10000).every(metric => metric.value === undefined));
  assert.equal(dashboardMetrics([reading('s', NaN)], true, 10000)[0].status, 'Waiting');
});

test('dashboard adds throttle input, native motor RPM and current with per-channel freshness', () => {
  const inputs = [reading('t', 75), reading('d', 20), reading('m', 1234), reading('i', 12.5)];
  const metrics = dashboardMetrics(inputs, true, 10000).slice(3, 6);
  assert.deepEqual(metrics.map(({ id, value, unit, status }) => ({ id, value, unit, status })), [
    { id: 'throttle', value: 75, unit: '%', status: 'Live' },
    { id: 'motor', value: 1234, unit: 'rpm', status: 'Live' },
    { id: 'current', value: 12.5, unit: 'A', status: 'Live' }
  ]);
  assert.ok(dashboardMetrics(inputs, true, 15001).slice(3, 6).every(metric => metric.value === undefined && metric.status === 'Stale'));
  assert.ok(dashboardMetrics([reading('t', 0), reading('m', 0), reading('i', 0)], true, 10000).slice(3, 6).every(metric => metric.value === 0));
  assert.equal(dashboardMetrics([reading('d', 75)], true, 10000)[3].value, undefined, 'Do not substitute throttle output for input');
});

test('temperature 1 is ambient and temperature 2 is motor, matching telemetry', () => {
  const temperatures = dashboardMetrics([reading('a', 18.25), reading('b', 64.75), reading('c', 30)], true, 10000).slice(6);
  assert.deepEqual(temperatures.map(({ id, label, value, unit, digits }) => ({ id, label, value, unit, digits })), [
    { id: 'ambient', label: 'Ambient', value: 18.25, unit: '°C', digits: '1.1-1' },
    { id: 'motor-temp', label: 'Motor', value: 64.75, unit: '°C', digits: '1.1-1' }
  ]);
  const partial = dashboardMetrics([reading('a', 0)], true, 10000).slice(6);
  assert.equal(partial[0].value, 0); assert.equal(partial[1].value, undefined);
  assert.ok(dashboardMetrics([reading('a', 20), reading('b', 60)], true, 15001).slice(6).every(metric => metric.status === 'Stale' && metric.value === undefined));
});

test('startup and restart reuse the sole granted Bluetooth serial port automatically', async t => {
  const f = fixture(t); f.service.start(); f.service.start(); await flush();
  assert.deepEqual(f.counts(), { opens: 1, closes: 0, requests: 0 });
  await f.service.disconnect(); f.service.start(); await flush();
  assert.deepEqual(f.counts(), { opens: 2, closes: 1, requests: 0 });
});
test('no grant or ambiguous grants require selection and never open a chooser automatically', async t => {
  const f = fixture(t); f.serial.grants = []; f.service.start(); await flush();
  assert.equal(f.service.state$.value.needsPermission, true); assert.equal(f.counts().requests, 0);
  await f.service.disconnect(); f.serial.grants = [f.port, { getInfo: f.port.getInfo }]; f.service.start(); await flush();
  assert.equal(f.counts().opens, 0); assert.equal(f.service.state$.value.needsPermission, true);
});
test('retry burst is bounded at six opens and a device availability event can restart it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t); let failures = 0;
  f.port.open = async () => { failures++; throw new Error('Off'); };
  f.service.start(); await flush();
  for (const delay of [1000, 2000, 4000, 8000, 16000]) { t.mock.timers.tick(delay); await flush(); }
  assert.equal(failures, 6); assert.equal(f.lookups(), 6); assert.equal(f.counts().requests, 0);
  t.mock.timers.tick(3600000); await flush(); assert.equal(failures, 6);
  f.available(); await flush(); assert.equal(failures, 7);
});
test('permission revocation stops automatic opens and requests one-time selection', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t); f.service.start(); await flush(); f.serial.grants = []; f.end(); await flush();
  t.mock.timers.tick(1000); await flush();
  assert.equal(f.counts().opens, 1); assert.equal(f.service.state$.value.needsPermission, true);
  assert.equal(f.counts().requests, 0);
});
test('stop or destruction cancels pending retries and ignores late grant lookup', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t); f.service.start(); await flush(); f.end(); await flush();
  await f.service.disconnect(); t.mock.timers.tick(100000); await flush(); assert.equal(f.counts().opens, 1);
  let resolve; f.serial.getPorts = () => new Promise(r => { resolve = r; });
  f.service.start(); f.service.ngOnDestroy(); resolve([f.port]); await flush();
  assert.equal(f.counts().opens, 1);
});
test('hidden pages pause reconnect work and foreground resumes with the saved grant', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t); f.service.start(); await flush(); f.end(); await flush();
  f.visible(false); t.mock.timers.tick(100000); await flush(); assert.equal(f.counts().opens, 1);
  f.visible(true); await flush(); assert.equal(f.counts().opens, 2); assert.equal(f.counts().requests, 0);
});
test('a stalled stream closes after ten seconds and enters recovery once', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const f = fixture(t); f.service.start(); await flush();
  t.mock.timers.tick(10500); await flush(); assert.equal(f.counts().closes, 1);
  t.mock.timers.tick(1000); await flush(); assert.equal(f.counts().opens, 2);
});
test('open followed by immediate EOF cannot bypass the reconnect budget', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t); let opens = 0;
  f.port.open = async () => { opens++; f.port.readable = new ReadableStream({ start(c) { c.close(); } }); };
  f.service.start(); await flush();
  for (const delay of [1000, 2000, 4000, 8000, 16000]) { t.mock.timers.tick(delay); await flush(); }
  assert.equal(opens, 6); t.mock.timers.tick(100000); await flush(); assert.equal(opens, 6);
});

test('resume during an unfinished open waits for cleanup and then reconnects once', async t => {
  const f = fixture(t), originalOpen = f.port.open.bind(f.port);
  let finish, calls = 0;
  f.port.open = async options => { calls++; if (calls === 1) await new Promise(resolve => { finish = resolve; }); return originalOpen(options); };
  f.service.start(); await flush(); const stopping = f.service.disconnect();
  f.service.start(); finish(); await stopping; await flush();
  assert.equal(calls, 2); assert.equal(f.counts().closes, 1); assert.equal(f.service.state$.value.status, 'connected');
});
test('failure to close a port stops retries instead of risking a second owner', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t); f.port.close = async () => { throw new Error('Busy'); };
  f.service.start(); await flush(); f.end(); await flush();
  t.mock.timers.tick(100000); f.available(); await flush();
  assert.equal(f.counts().opens, 1); assert.match(f.service.state$.value.message, /Close this tab/);
});
