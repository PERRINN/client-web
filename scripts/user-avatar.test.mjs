import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function load(path, imports = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, name => {
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  });
  return exports;
}
const model = load('../src/app/userAvatar.ts');
const { avatarInitials, userPhotoSources } = model;
const { UserAvatarComponent } = load('../src/app/user-avatar.component.ts', {
  '@angular/core': { Component: () => target => target, Input: () => () => {} }, './userAvatar': model
});
function avatar(name, sources) {
  const view = new UserAvatarComponent();
  view.name = name; view.sources = sources;
  view.ngOnChanges({ name: {}, sources: {} });
  return view;
}

test('HTML initials support whitespace, Unicode and missing names with at most two characters', () => {
  assert.equal(avatarInitials('  Alex  Morgan '), 'AM');
  assert.equal(avatarInitials('Nico'), 'N');
  assert.equal(avatarInitials('e\u0301mile Zola'), 'ÉZ');
  assert.equal(avatarInitials('李 明'), '李明');
  assert.equal(avatarInitials('😀 Team'), '😀T');
  assert.equal(avatarInitials('ß Team'), 'SS');
  for (const name of [undefined, null, '', '   ']) assert.equal(avatarInitials(name), '?');
});

test('photo candidates skip empty values, known shared silhouettes and duplicate URLs', () => {
  assert.deepEqual(userPhotoSources([null, undefined, '', '  ', 'null', 'undefined', 'javascript:alert(1)', 'https://example.test/images/1709995468152Screenshot.png', 'https://example.test/images/1585144867972Screen.png', ' https://example.test/photo ', 'https://example.test/photo']), ['https://example.test/photo']);
  assert.deepEqual(userPhotoSources(undefined), []);
});

test('missing or placeholder photos show initials without creating a replacement image source', () => {
  for (const sources of [undefined, [], ['https://example.test/1709995468152.png']]) {
    const view = avatar('Alex Morgan', sources);
    assert.equal(view.initials, 'AM');
    assert.equal(view.src, null);
    assert.equal(view.previewSource('https://example.test/1709995468152.png'), null);
    view.onPhotoError();
    assert.equal(view.src, null);
  }
});

test('broken thumbnails try remaining stored photos once, then leave only the HTML fallback', () => {
  const view = avatar('Nico', ['thumb', 'thumb', 'original']);
  assert.equal(view.src, 'thumb');
  assert.equal(view.previewSource('original'), 'original');
  view.onPhotoError();
  assert.equal(view.src, 'original');
  assert.equal(view.previewSource('thumb'), 'original');
  view.onPhotoError();
  assert.equal(view.src, null);
  view.onPhotoError();
  assert.equal(view.src, null);
});

test('name changes update initials without retrying failures; photo/account changes reset the photo queue', () => {
  const view = avatar('Alex', 'broken');
  view.onPhotoError();
  view.name = 'Blair Lee'; view.ngOnChanges({ name: {} });
  assert.equal(view.initials, 'BL');
  assert.equal(view.src, null);
  view.sources = ['new-photo']; view.ngOnChanges({ sources: {} });
  assert.equal(view.src, 'new-photo');
  assert.equal(view.previewSource(), 'new-photo');
  view.sources = undefined; view.ngOnChanges({ sources: {} });
  assert.equal(view.src, null);
});
