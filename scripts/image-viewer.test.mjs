import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { Subject } from 'rxjs';

function load(path, imports) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, name => { if (!(name in imports)) throw Error(name); return imports[name]; });
  return exports;
}
const imageTime = load('../src/app/image-viewer/imageTime.ts', {});
const { ImageViewerService, recordImage } = load('../src/app/image-viewer/imageViewer.service.ts', {
  '@angular/core': { Injectable: () => target => target }, rxjs: { Subject }, './imageTime': imageTime
});
const doc = (id, image = true, chain = 'thread') => ({ id, exists: true, data: () => ({ chain, ...(image ? { chatImageUrlOriginal: id } : {}) }), get: () => '123' });
function fixture(pages = []) {
  const calls = [];
  const query = {
    where: (...args) => { calls.push(['where', ...args]); return query; },
    orderBy: (...args) => { calls.push(['orderBy', ...args]); return query; },
    startAfter: cursor => { calls.push(['cursor', cursor.id]); return query; },
    limit: limit => { calls.push(['limit', limit]); return query; },
    doc: id => ({ get: async () => doc(id) }),
    get: async () => { const page = pages.shift() || []; if (page instanceof Error) throw page; const docs = await page; return { docs, size: docs.length }; }
  };
  const viewer = new ImageViewerService({ firestore: { collection: name => { assert.equal(name, 'PERRINNMessages'); return query; } } });
  viewer.open({ src: 'selected', id: 'selected', chain: 'thread' });
  return { viewer, calls };
}
test('image projection uses available stored URLs and excludes non-images', () => {
  assert.equal(recordImage('none', { chain: 'thread' }), null);
  assert.deepEqual(recordImage('legacy', { chain: 'thread', chatImageUrlThumb: 'thumb' }), { id: 'legacy', chain: 'thread', src: 'thumb', name: 'Shared image', imageTimestamp: undefined, subject: undefined, postedAt: 0 });
});
test('older and newer pages preserve chronological order, selected image, thread scope and endpoints', async () => {
  const { viewer, calls } = fixture([[doc('older2'), doc('older1')], [doc('newer1'), doc('newer2')]]);
  await viewer.move(-1); assert.equal(viewer.current.id, 'older2');
  await viewer.move(-1); assert.equal(viewer.current.id, 'older1'); assert.equal(viewer.canMove(-1), false);
  await viewer.move(1); await viewer.move(1); assert.equal(viewer.current.id, 'selected');
  await viewer.move(1); assert.equal(viewer.current.id, 'newer1');
  await viewer.move(1); assert.equal(viewer.current.id, 'newer2'); assert.equal(viewer.canMove(1), false);
  assert.deepEqual(viewer.images.map(image => image.id), ['older1', 'older2', 'selected', 'newer1', 'newer2']);
  assert.deepEqual(calls.filter(call => call[0] === 'where'), [['where', 'chain', '==', 'thread'], ['where', 'chatImageTimestamp', '>', ''], ['where', 'chain', '==', 'thread'], ['where', 'chatImageTimestamp', '>', '']]);
  assert.deepEqual(calls.filter(call => call[0] === 'limit'), [['limit', 25], ['limit', 25]]);
  assert.deepEqual(calls.filter(call => call[0] === 'orderBy'), [['orderBy', 'chatImageTimestamp', 'desc'], ['orderBy', 'chatImageTimestamp', 'asc']]);
});
test('an unusable image page does not trigger an automatic query loop', async () => {
  const empty = Array.from({ length: 25 }, (_, i) => doc(`empty${i}`, false));
  const { viewer, calls } = fixture([empty, [doc('next')]]);
  await viewer.move(-1); assert.equal(viewer.current.id, 'selected');
  assert.equal(calls.filter(call => call[0] === 'limit').length, 1);
  await viewer.move(-1); assert.equal(viewer.current.id, 'next');
  assert.deepEqual(calls.filter(call => call[0] === 'cursor'), [['cursor', 'selected'], ['cursor', 'empty24']]);
});
test('loaded images are reused, foreign threads excluded and missing single-image thread handled', async () => {
  const { viewer, calls } = fixture();
  viewer.open({ src: 'b', id: 'b', chain: 'thread', imageTimestamp: '2' }, [{ src: 'a', id: 'a', chain: 'thread', imageTimestamp: '1' }, { src: 'foreign', id: 'x', chain: 'other' }, { src: 'b', id: 'b', chain: 'thread', imageTimestamp: '2' }]);
  await viewer.move(-1); assert.equal(viewer.current.id, 'a'); assert.equal(calls.length, 0);
  viewer.open({ src: 'profile' }); assert.equal(viewer.canMove(-1), false); assert.equal(viewer.canMove(1), false);
  viewer.open({ src: 'only', chain: 'thread', id: 'only' });
  await viewer.move(-1); await viewer.move(1); assert.equal(viewer.current.id, 'only');
  assert.equal(viewer.canMove(-1), false); assert.equal(viewer.canMove(1), false);
});
test('failed pages retain selection and can retry without losing cursor', async () => {
  const { viewer } = fixture([Error('offline'), [doc('older')]]);
  await viewer.move(-1); assert.equal(viewer.current.id, 'selected'); assert.ok(viewer.error); assert.equal(viewer.loading, false);
  await viewer.move(-1); assert.equal(viewer.current.id, 'older'); assert.equal(viewer.error, '');
});
test('late responses cannot populate a different thread or a closed dialog', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const { viewer } = fixture([pending]);
  const navigation = viewer.move(-1);
  await new Promise(done => setImmediate(done));
  viewer.close(); viewer.open({ src: 'other', chain: 'other', id: 'other' });
  resolve([doc('stale')]); await navigation;
  assert.deepEqual(viewer.images.map(image => image.id), ['other']); assert.equal(viewer.loading, false);
});
const { ImageViewerComponent } = load('../src/app/image-viewer/image-viewer.component.ts', {
  '@angular/core': { Component: () => target => target, ViewChild: () => () => {} },
  '@angular/router': { NavigationStart: class {} }, './imageTime': imageTime, rxjs: { Subscription: class { unsubscribe() {} } }
});
test('arrows, horizontal swipes and thread action preserve current association', () => {
  const moves = [], routes = [];
  const viewer = { current: { chain: 'thread' }, move: direction => moves.push(direction), close: () => routes.push('close') };
  const component = new ImageViewerComponent(viewer, { navigate: route => routes.push(route) });
  component.keydown({ key: 'ArrowLeft', preventDefault() {} }); component.keydown({ key: 'ArrowRight', preventDefault() {} });
  component.touchStart({ touches: [{ clientX: 200, clientY: 10 }] });
  component.touchEnd({ changedTouches: [{ clientX: 100, clientY: 15 }] });
  component.touchStart({ touches: [{ clientX: 200, clientY: 10 }] });
  component.touchEnd({ changedTouches: [{ clientX: 100, clientY: 200 }] });
  assert.deepEqual(moves, [-1, 1, 1]); component.goToThread(); assert.deepEqual(routes, ['close', ['/chat', 'thread']]);
  viewer.current = {}; component.goToThread(); assert.equal(routes.length, 2);
});
test('newer pagination keeps the far edge cursor across full pages and filters overlapping records', async () => {
  const first = Array.from({ length: 25 }, (_, i) => doc(`new${i + 1}`));
  const { viewer, calls } = fixture([first, [doc('new25'), doc('last')]]);
  for (let i = 0; i < 26; i++) await viewer.move(1);
  assert.equal(viewer.current.id, 'last');
  assert.equal(viewer.images.length, 27);
  assert.equal(viewer.canMove(1), false);
  assert.deepEqual(calls.filter(call => call[0] === 'cursor'), [['cursor', 'selected'], ['cursor', 'new25']]);
});
test('a deleted or mismatched anchor never queries or enters a different thread', async () => {
  const viewer = new ImageViewerService({ firestore: { collection: () => ({ doc: () => ({ get: async () => doc('selected', true, 'other') }) }) } });
  viewer.open({ src: 'selected', id: 'selected', chain: 'thread' });
  await viewer.move(-1);
  assert.equal(viewer.current.src, 'selected'); assert.ok(viewer.error); assert.equal(viewer.loading, false);
});
test('cached chat images follow upload timestamp and ID order even when message order differs', async () => {
  const { viewer, calls } = fixture();
  viewer.open({ src: 'b', id: 'b', chain: 'thread' }, [
    { src: 'c', id: 'c', chain: 'thread', imageTimestamp: '2' },
    { src: 'missing', id: 'missing', chain: 'thread' },
    { src: 'b', id: 'b', chain: 'thread', imageTimestamp: '2' },
    { src: 'a', id: 'a', chain: 'thread', imageTimestamp: '1' }
  ]);
  assert.deepEqual(viewer.images.map(image => image.id), ['a', 'b', 'c']);
  assert.equal(viewer.current.id, 'b');
  await viewer.move(1); assert.equal(viewer.current.id, 'c'); assert.equal(calls.length, 0);
});
test('thread subjects come from existing metadata and remain stable across image pages', async () => {
  assert.equal(recordImage('image', { chatImageUrlOriginal: 'url', chatSubject: 'Design' }).subject, 'Design');
  const { viewer, calls } = fixture([[doc('older')]]);
  viewer.open({ src: 'selected', id: 'selected', chain: 'thread', subject: 'Current design' });
  assert.equal(calls.length, 0);
  await viewer.move(-1); assert.equal(viewer.current.subject, 'Current design');
  await viewer.move(1); assert.equal(viewer.current.subject, 'Current design');
});
test('relative posting time stays short and handles missing, invalid and future timestamps', () => {
  const now = Date.UTC(2026, 9, 17, 16);
  for (const value of [0, NaN, Infinity, -1, now + 120000]) assert.equal(imageTime.imageAge(value, now), '');
  assert.equal(imageTime.imageAge(now - 15000, now), 'Just now');
  assert.equal(imageTime.imageAge(now + 15000, now), 'Just now');
  for (const [seconds, label] of [[60, '1 minute ago'], [7200, '2 hours ago'], [86400, '1 day ago'], [1209600, '2 weeks ago'], [5184000, '2 months ago'], [63072000, '2 years ago']]) {
    assert.equal(imageTime.imageAge(now - seconds * 1000, now), label);
  }
});
test('posting time uses message metadata rather than upload time and follows the selected image', async () => {
  assert.equal(imageTime.imagePostedMillis({ seconds: 123 }), 123000);
  assert.equal(imageTime.imagePostedMillis({ toMillis: () => 456000 }), 456000);
  assert.equal(imageTime.imagePostedMillis(null), 0);
  const projected = recordImage('one', { chatImageUrlOriginal: 'url', chatImageTimestamp: '999', serverTimestamp: { seconds: 123 }, name: 'Nico' });
  assert.equal(projected.postedAt, 123000); assert.equal(projected.name, 'Image from Nico');
  const { viewer, calls } = fixture();
  viewer.open({ src: 'b', id: 'b', chain: 'thread' }, [
    { src: 'a', id: 'a', chain: 'thread', imageTimestamp: '1', postedAt: 1000 },
    { src: 'b', id: 'b', chain: 'thread', imageTimestamp: '2', postedAt: 2000 }
  ]);
  assert.equal(viewer.current.postedAt, 2000);
  await viewer.move(-1); assert.equal(viewer.current.postedAt, 1000); assert.equal(calls.length, 0);
});

test('closing the dialog restores connected opener focus without moving the chat scroll position', () => {
  const calls = [];
  const component = new ImageViewerComponent({ opened: false }, {});
  component.dialog = { nativeElement: { open: false } };
  component.opener = { isConnected: true, focus: options => calls.push(options) };
  component.closed();
  assert.deepEqual(calls, [{ preventScroll: true }]);
  component.opener.isConnected = false;
  component.closed();
  assert.equal(calls.length, 1);
  component.dialog.nativeElement.open = true;
  component.opener.isConnected = true;
  component.closed();
  assert.equal(calls.length, 1);
});
