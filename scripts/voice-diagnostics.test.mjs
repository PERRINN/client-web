import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const exports = {};
new Function('exports', ts.transpileModule(readFileSync(new URL('../src/app/voice/voiceDiagnostics.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText)(exports);
const { voiceDiagnosticCode: code } = exports;
test('shared voice error codes exclude private error messages and accept numeric Angular errors', () => {
  assert.equal(code({ code: -203, message: 'private' }), 'NG0203');
  assert.equal(code({ code: 'functions/unavailable', message: 'private' }), 'unavailable');
  assert.equal(code({ code: 'private error with spaces', name: 'NotFoundError' }), 'NotFoundError');
  assert.equal(code({ message: 'private' }), 'Unknown error');
});
