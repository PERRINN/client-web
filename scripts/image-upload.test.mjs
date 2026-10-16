import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
import { Subject } from 'rxjs';
const require = createRequire(import.meta.url);
function load(path, overrides = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, name => overrides[name] || require(name));
  return exports;
}
const core = { Injectable: () => target => target, Component: () => target => target, ViewChild: () => () => {}, HostListener: () => () => {}, runInInjectionContext: (_, fn) => fn() };
const uploads = load('../src/app/imageUpload.service.ts', { '@angular/core': core });
const { SettingsComponent } = load('../src/app/settings.component.ts', { '@angular/core': core, './imageUpload.service': uploads });
const zone = { run: fn => fn() };
const input = () => ({ files: [{ name: 'Team photo.png', type: 'image/png', size: 100 }], value: 'selected' });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('shared uploader reports bounded whole percentages, resolves URLs and removes listeners', async () => {
  const percent = new Subject(), url = new Subject(), reports = [], paths = [];
  let finish;
  const task = Object.assign(new Promise(resolve => finish = resolve), { percentageChanges: () => percent });
  const service = new uploads.ImageUploadService({ ref: path => { paths.push(path); return { put: () => task, getDownloadURL: () => url }; } }, {});
  const result = service.upload('images/123-photo.png', input().files[0], p => reports.push(p));
  percent.next(undefined); percent.next(NaN); percent.next(35.6); percent.next(125);
  assert.deepEqual(reports, [0, 36, 100]); finish(); await tick();
  assert.equal(percent.observed, false); assert.equal(reports.at(-1), null);
  percent.next(100); assert.equal(reports.at(-1), null);
  url.next('photo-url'); assert.equal(await result, 'photo-url'); assert.deepEqual(paths, ['images/123-photo.png']);
});
test('shared uploader releases progress listeners when upload or URL resolution fails', async () => {
  for (const stage of ['upload', 'url']) {
    const percent = new Subject(); let fail;
    const task = Object.assign(stage === 'upload' ? new Promise((_, reject) => fail = reject) : Promise.resolve(), { percentageChanges: () => percent });
    const service = new uploads.ImageUploadService({ ref: () => ({ put: () => task, getDownloadURL: () => { throw Error('offline'); } }) }, {});
    const result = service.upload('images/test', input().files[0], () => {});
    const rejection = assert.rejects(result, /offline/);
    if (stage === 'upload') { percent.error(Error('offline')); fail(Error('offline')); }
    await rejection; assert.equal(percent.observed, false);
  }
});
function settings(upload, createMessage) {
  const UI = { currentUser: 'owner', currentUserLastMessageObj: { name: 'Nico' }, createMessage };
  return new SettingsComponent({}, {}, { upload }, UI, {}, zone);
}
test('profile picture uploads preserve the existing message contract and remain busy through saving', async () => {
  const paths = [], writes = []; let finish;
  const component = settings(async (path, _, report) => { paths.push(path); report(62); report(null); return 'profile-photo'; }, message => { writes.push(message); return new Promise(resolve => finish = resolve); });
  const file = input(), result = component.onImageChange({ target: file }); await tick();
  assert.equal(component.profileUpload.busy, true); assert.equal(component.profileUpload.percent, null);
  assert.match(paths[0], /^images\/\d{13}Team photo.png$/);
  const timestamp = paths[0].slice(7,20);
  assert.deepEqual(writes[0], { chain:'owner', text:'updating my profile picture', userImageTimestamp:timestamp, imageUrlThumbUser:'profile-photo', imageUrlMedium:'profile-photo', imageUrlOriginal:'profile-photo', chatImageTimestamp:timestamp, chatImageUrlThumb:'profile-photo', chatImageUrlMedium:'profile-photo', chatImageUrlOriginal:'profile-photo' });
  finish(); await result; assert.equal(component.profileUpload.busy, false); assert.equal(file.value, ''); assert.equal(component.UI.currentUserLastMessageObj.name, 'Nico'); assert.equal(component.UI.currentUserLastMessageObj.imageUrlOriginal, 'profile-photo');
});
test('profile uploads reject account changes and late results after navigation, and recover on failures', async () => {
  for (const mode of ['account', 'destroy', 'upload', 'save']) {
    let finish; const writes = [];
    const component = settings(mode === 'upload' ? async () => { throw Error('offline'); } : () => new Promise(resolve => finish = resolve), async message => { writes.push(message); if (mode === 'save') throw Error('offline'); });
    const result = component.onImageChange({ target: input() });
    if (mode === 'account') component.UI.currentUser = 'another';
    if (mode === 'destroy') component.ngOnDestroy();
    if (mode !== 'upload') finish('photo');
    await result;
    assert.equal(writes.length, mode === 'save' ? 1 : 0); assert.equal(component.profileUpload.busy, false);
    assert.equal(component.UI.currentUserLastMessageObj.imageUrlOriginal, undefined);
    if (mode !== 'destroy') assert.match(component.profileUpload.error, /couldn’t save/);
  }
});
