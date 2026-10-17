import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const listeners = new Map();
let metadata;
const source = readFileSync(new URL('../src/app/app.component.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
const exports = {};
new Function('exports', 'require', code)(exports, name => {
  if (name === '@angular/core') return {
    Component: config => target => { metadata = config; return target; },
    ViewChild: () => () => {},
    HostListener: (event, args) => (_, method) => { listeners.set(event, { method, args }); }
  };
  if (name.startsWith('.')) return {};
  if (name.startsWith('@angular/')) return {};
  return require(name);
});
const component = () => Object.assign(Object.create(exports.AppComponent.prototype), { inputModality: 'pointer' });

test('document input events drive the shell attribute, including dialog events outside routed Chat', () => {
  assert.equal(metadata.host['[attr.data-input-modality]'], 'inputModality');
  assert.equal(listeners.get('document:pointerdown').method, 'onPointerInput');
  assert.deepEqual(listeners.get('document:keydown'), { method: 'onKeyboardInput', args: ['$event'] });
});
test('touch/mouse clear inherited keyboard mode; keyboard navigation immediately restores it', () => {
  const app = component();
  for (const key of ['Tab', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Escape', 'Home', 'End', 'PageUp', 'PageDown']) {
    app.onKeyboardInput({ key });
    assert.equal(app.inputModality, 'keyboard');
    app.onPointerInput();
    assert.equal(app.inputModality, 'pointer');
  }
});
test('typing and modifier-only events do not leave pointer mode while editing', () => {
  const app = component();
  for (const key of ['a', 'Shift', 'Control', 'Alt', 'Meta', 'Unidentified']) app.onKeyboardInput({ key });
  assert.equal(app.inputModality, 'pointer');
});

// Optional local browser fixture uses the actual component handlers and production CSS.
if (process.env.FOCUS_FIXTURE_PATH) {
  const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const viewerStyles = readFileSync(new URL('../src/app/image-viewer/image-viewer.component.css', import.meta.url), 'utf8');
  const pointer = exports.AppComponent.prototype.onPointerInput.toString();
  const keyboard = exports.AppComponent.prototype.onKeyboardInput.toString();
  writeFileSync(process.env.FOCUS_FIXTURE_PATH, `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}\n${viewerStyles}\napp-root {display:block;padding:24px} .messages {height:200px;padding:20px;outline-offset:-2px} .messages:focus-visible {outline:2px solid var(--color-focus)} button {margin:8px} textarea {display:block} </style><app-root data-input-modality="pointer"><div class="messages" tabindex="0" aria-label="Messages"><button id="open">Open image</button><p>Selectable message text</p></div><textarea aria-label="Message"></textarea><dialog aria-label="Image preview"><button id="close">Close image preview</button><p>Image preview</p></dialog></app-root><script>const app={inputModality:'pointer',${pointer},${keyboard}};const root=document.querySelector('app-root');const dialog=document.querySelector('dialog');const messages=document.querySelector('.messages');document.addEventListener('pointerdown',()=>{app.onPointerInput();root.dataset.inputModality=app.inputModality});document.addEventListener('keydown',event=>{app.onKeyboardInput(event);root.dataset.inputModality=app.inputModality});document.querySelector('#open').onclick=()=>{messages.focus();dialog.showModal()};document.querySelector('#close').onclick=()=>{dialog.close();messages.focus({preventScroll:true})};</script>`);
}
