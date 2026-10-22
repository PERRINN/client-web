import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { BehaviorSubject } from 'rxjs';

const code = ts.transpileModule(readFileSync(new URL('../src/app/mobileOrientation.service.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true }
}).outputText;

function fixture({ touch = true, type = 'portrait-primary', angle, lock = async () => {} } = {}) {
  const media = Object.assign(new EventTarget(), { matches: touch });
  const orientation = Object.assign(new EventTarget(), { type, lock });
  const screen = { orientation, width: 390, height: 844 };
  const window = Object.assign(new EventTarget(), { orientation: angle, matchMedia: () => media });
  const document = new EventTarget();
  const exports = {};
  new Function('exports', 'require', 'window', 'screen', 'document', code)(exports, name => {
    if (name === '@angular/core') return { Injectable: () => target => target };
    if (name === 'rxjs') return { BehaviorSubject };
    throw Error(name);
  }, window, screen, document);
  const service = new exports.MobileOrientationService();
  let blocked;
  const states = [];
  service.landscapeBlocked$.subscribe(value => { blocked = value; states.push(value); });
  const rotate = type => { orientation.type = type; orientation.dispatchEvent(new Event('change')); };
  return { service, screen, window, document, media, rotate, states, blocked: () => blocked };
}

test('both landscape directions block touch devices and portrait restores the page', () => {
  const f = fixture();
  assert.equal(f.blocked(), false);
  f.rotate('landscape-primary'); assert.equal(f.blocked(), true);
  f.rotate('landscape-secondary'); assert.equal(f.blocked(), true);
  f.rotate('portrait-secondary'); assert.equal(f.blocked(), false);
  assert.deepEqual(f.states, [false, true, false]);
  f.service.ngOnDestroy();
});

test('initial landscape is blocked even when native locking is absent or rejected', async () => {
  for (const lock of [null, () => Promise.reject(Error('Not allowed')), () => { throw Error('Unsupported'); }]) {
    const f = fixture({ type: 'landscape-primary', lock });
    assert.equal(f.blocked(), true);
    await new Promise(resolve => setImmediate(resolve));
    f.service.ngOnDestroy();
  }
});

test('desktop landscape stays available and does not request a lock', () => {
  const f = fixture({ touch: false, type: 'landscape-primary', lock: () => { assert.fail('Desktop lock'); } });
  assert.equal(f.blocked(), false);
  f.window.dispatchEvent(new Event('resize'));
  assert.equal(f.blocked(), false);
  f.service.ngOnDestroy();
});

test('portrait keyboard resize does not block the app; legacy iOS angles are supported', () => {
  const f = fixture();
  f.window.innerWidth = 390;
  f.window.innerHeight = 240;
  f.window.dispatchEvent(new Event('resize'));
  assert.equal(f.blocked(), false);
  f.screen.orientation.type = undefined;
  f.window.orientation = -90;
  f.window.dispatchEvent(new Event('orientationchange'));
  assert.equal(f.blocked(), true);
  f.window.orientation = 0;
  f.window.dispatchEvent(new Event('orientationchange'));
  assert.equal(f.blocked(), false);
  f.service.ngOnDestroy();
});

test('locks are attempted only on startup and fullscreen changes; listeners are removed', () => {
  const calls = [];
  const f = fixture({ lock: async mode => { calls.push(mode); } });
  f.rotate('landscape-primary');
  for (let i = 0; i < 10; i++) f.window.dispatchEvent(new Event('resize'));
  assert.deepEqual(calls, ['portrait']);
  f.document.dispatchEvent(new Event('fullscreenchange'));
  assert.deepEqual(calls, ['portrait', 'portrait']);
  f.service.ngOnDestroy();
  f.rotate('portrait-primary');
  f.document.dispatchEvent(new Event('fullscreenchange'));
  assert.deepEqual(f.states, [false, true]);
  assert.equal(calls.length, 2);
});

test('changing the primary pointer refreshes the guard without polling', () => {
  const f = fixture({ touch: false, type: 'landscape-primary' });
  f.media.matches = true;
  f.media.dispatchEvent(new Event('change'));
  assert.equal(f.blocked(), true);
  f.media.matches = false;
  f.media.dispatchEvent(new Event('change'));
  assert.equal(f.blocked(), false);
  f.service.ngOnDestroy();
});
