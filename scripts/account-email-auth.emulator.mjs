import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import { Observable, firstValueFrom, filter } from 'rxjs';
import ts from 'typescript';

const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
assert.match(host || '', /^(127\.0\.0\.1|localhost):\d+$/, 'A local Auth emulator is required.');
const require = createRequire(import.meta.url), projectId = 'demo-message-email';
const source = ts.transpileModule(readFileSync(new URL('../src/app/accountEmail.service.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true }
}).outputText;
const exports = {}, imports = { '@angular/core': { Injectable: () => target => target }, 'firebase/compat/app': { default: firebase } };
new Function('exports', 'require', source)(exports, name => imports[name] || require(name));

test('real Auth SDK sends verification, keeps the current address until confirmed, and accepts the new login', async () => {
  const app = firebase.initializeApp({ projectId, apiKey: 'synthetic-emulator-key', authDomain: projectId + '.firebaseapp.com' }, 'email-test');
  const auth = app.auth(); auth.useEmulator('http://' + host, { disableWarnings: true });
  let service;
  try {
    const password = 'synthetic-password', initial = 'before@example.test', target = 'after@example.test';
    await auth.createUserWithEmailAndPassword(initial, password);
    const stream = new Observable(subscriber => auth.onIdTokenChanged(user => subscriber.next(user)));
    service = new exports.AccountEmailService({ user: stream, get currentUser() { return Promise.resolve(auth.currentUser); } });
    await firstValueFrom(stream.pipe(filter(Boolean)));
    const uid = auth.currentUser.uid;
    assert.equal(service.currentAddress, initial);
    service.address = target; await service.send();
    assert.equal(service.sent, true); assert.equal(auth.currentUser.email, initial);
    const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}/oobCodes`);
    assert.equal(response.status, 200);
    const { oobCodes } = await response.json();
    assert.ok(oobCodes.length <= 10, 'Unexpected demo state: refuse a broad result set');
    const code = oobCodes.find(entry => entry.requestType === 'VERIFY_AND_CHANGE_EMAIL' && entry.newEmail === target);
    assert.ok(code, 'Expected a verification request for the new address');
    await auth.applyActionCode(code.oobCode);
    await auth.signOut();
    await auth.signInWithEmailAndPassword(target, password);
    await firstValueFrom(stream.pipe(filter(user => user?.email === target)));
    assert.equal(auth.currentUser.uid, uid);
    assert.equal(service.currentAddress, target);
    assert.equal(service.sent, false);
    await assert.rejects(auth.signInWithEmailAndPassword(initial, password));
  } finally { service?.ngOnDestroy(); await auth.signOut(); await app.delete(); }
});
