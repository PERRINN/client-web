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
  const originals = Object.fromEntries(['window', 'navigator'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  let source, opens = 0, closes = 0, requests = 0;
  const port = { readable: new ReadableStream({ start(controller) { source = controller; } }),
    async open(options) { opens++; assert.equal(options.baudRate, 115200); }, async close() { closes++; } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { isSecureContext: true } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial: { requestPort(options) {
    requests++; assert.equal(options.filters[0].bluetoothServiceClassId, '00001101-0000-1000-8000-00805f9b34fb');
    return request ? request(port) : Promise.resolve(port);
  } } } });
  const service = new EchookConnectionService({ run: fn => fn(), runOutsideAngular: fn => fn() });
  t.after(async () => {
    service.ngOnDestroy(); await flush();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return { service, port, send: bytes => source.enqueue(Uint8Array.from(bytes)), end: () => source.close(),
    counts: () => ({ opens, closes, requests }) };
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
test('unexpected end shows a retryable error and never reconnects automatically', async t => {
  const f = fixture(t); f.service.connect(); await flush(); f.end(); await flush();
  assert.equal(f.service.state$.value.status, 'error');
  assert.equal(f.counts().requests, 1); assert.equal(f.counts().closes, 1);
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
