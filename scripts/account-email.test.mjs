import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
import { BehaviorSubject } from 'rxjs';

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL('../src/app/accountEmail.service.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true }
}).outputText;
const imports = {
  '@angular/core': { Injectable: () => target => target },
  'firebase/compat/app': { default: { auth: { EmailAuthProvider: { credential: (email, password) => ({ email, password }) } } } },
  'firebase/compat/auth': {}
};
const exports = {};
new Function('exports', 'require', code)(exports, name => imports[name] || require(name));
const { AccountEmailService } = exports;
const tick = () => new Promise(resolve => setImmediate(resolve));
const failure = code => Object.assign(Error('Sensitive provider detail must not appear in UI'), { code });

function setup() {
  const sent = [], credentials = [], reloads = [];
  const user = {
    uid: 'alice', email: 'current@example.test',
    verifyBeforeUpdateEmail: async address => { sent.push(address); },
    reauthenticateWithCredential: async credential => { credentials.push(credential); },
    reload: async () => { reloads.push(true); }
  };
  const state = new BehaviorSubject(user);
  const auth = { user: state, currentUser: Promise.resolve(user) };
  const service = new AccountEmailService(auth);
  const changeUser = next => { auth.currentUser = Promise.resolve(next); state.next(next); };
  service.address = 'new@example.test';
  return { service, user, state, auth, sent, credentials, reloads, changeUser };
}

test('Auth is the current email source; verification leaves it unchanged until confirmation', async () => {
  const { service, sent } = setup();
  assert.equal(service.currentAddress, 'current@example.test');
  await service.send();
  assert.deepEqual(sent, ['new@example.test']);
  assert.equal(service.currentAddress, 'current@example.test');
  assert.equal(service.status, 'Verification email sent.');
  assert.equal(service.canSend, false);
});

test('invalid, unchanged and signed-out requests do no work', async () => {
  const { service, sent, changeUser } = setup();
  for (const address of ['', 'wrong', 'current@example.test', ' current@example.test ', 'x'.repeat(250) + '@test.example']) {
    service.address = address; await service.send();
  }
  changeUser(null); service.address = 'new@example.test'; await service.send();
  assert.deepEqual(sent, []);
});

test('duplicate clicks are blocked while verification is pending', async () => {
  const { service, user } = setup(); let finish, requests = 0;
  user.verifyBeforeUpdateEmail = () => { requests++; return new Promise(resolve => { finish = resolve; }); };
  const pending = service.send(); await tick(); await service.send();
  assert.equal(requests, 1); assert.equal(service.busy, true);
  finish(); await pending; assert.equal(service.busy, false);
});

test('recent-login failure requests a password; reauthentication uses the current Auth address', async () => {
  const { service, user, credentials, sent } = setup();
  user.verifyBeforeUpdateEmail = async () => { throw failure('auth/requires-recent-login'); };
  await service.send();
  assert.equal(service.needsPassword, true); assert.equal(service.canSend, false);
  service.password = 'synthetic-secret';
  user.verifyBeforeUpdateEmail = async address => { sent.push(address); };
  await service.send();
  assert.deepEqual(credentials, [{ email: 'current@example.test', password: 'synthetic-secret' }]);
  assert.deepEqual(sent, ['new@example.test']);
  assert.equal(service.password, ''); assert.equal(service.needsPassword, false);
});

test('wrong passwords retain the email draft, clear the credential and permit retry', async () => {
  const { service, user, sent } = setup();
  service.needsPassword = true; service.password = 'wrong';
  user.reauthenticateWithCredential = async () => { throw failure('auth/invalid-credential'); };
  await service.send();
  assert.equal(service.error, 'Incorrect password. Try again.');
  assert.equal(service.address, 'new@example.test'); assert.equal(service.password, '');
  assert.equal(service.needsPassword, true); assert.deepEqual(sent, []);
});

test('errors are concise and never expose raw Auth details', async () => {
  for (const code of ['auth/network-request-failed', 'auth/too-many-requests', 'auth/email-already-in-use', 'auth/invalid-email', 'auth/user-disabled', 'unknown']) {
    const { service, user } = setup();
    user.verifyBeforeUpdateEmail = async () => { throw failure(code); };
    await service.send();
    assert.ok(service.error); assert.doesNotMatch(service.error, /Sensitive|provider/);
    assert.equal(service.busy, false); assert.equal(service.sent, false);
    assert.equal(service.address, 'new@example.test'); service.ngOnDestroy();
  }
});

test('sign-out/account switches clear drafts, credentials and pending feedback', async () => {
  for (const next of [null, { uid: 'bob', email: 'bob@example.test' }]) {
    const { service, changeUser } = setup();
    service.password = 'secret'; service.needsPassword = service.sent = true;
    changeUser(next);
    assert.equal(service.password, ''); assert.equal(service.address, next?.email || '');
    assert.equal(service.needsPassword, false); assert.equal(service.sent, false);
    service.ngOnDestroy();
  }
});

test('same-account token emissions preserve drafts and do not trigger extra requests', async () => {
  const { service, user, state, sent, reloads } = setup();
  state.next(user); state.next({ ...user });
  assert.equal(service.address, 'new@example.test');
  assert.deepEqual(sent, []); assert.deepEqual(reloads, []);
});

test('account switch before Auth lookup or after reauthentication prevents sending', async () => {
  for (const stage of ['lookup', 'reauth']) {
    const { service, auth, user, sent, changeUser } = setup();
    let finish;
    if (stage === 'lookup') auth.currentUser = new Promise(resolve => { finish = () => resolve(user); });
    else {
      service.needsPassword = true; service.password = 'secret';
      user.reauthenticateWithCredential = () => new Promise(resolve => { finish = resolve; });
    }
    const pending = service.send(); await tick(); changeUser(null); finish(); await pending;
    assert.deepEqual(sent, []); assert.equal(service.sent, false);
  }
});

test('late success/failure cannot alter a new account or destroyed Settings', async () => {
  for (const action of ['switch', 'destroy']) for (const outcome of ['success', 'error']) {
    const { service, user, changeUser, state } = setup(); let finish;
    user.verifyBeforeUpdateEmail = () => new Promise((resolve, reject) => { finish = () => outcome === 'success' ? resolve() : reject(failure('auth/network-request-failed')); });
    const pending = service.send(); await tick();
    if (action === 'switch') changeUser({ uid: 'bob', email: 'bob@example.test' });
    else { service.ngOnDestroy(); assert.equal(state.observed, false); }
    finish(); await pending;
    assert.equal(service.sent, false); assert.equal(service.error, ''); assert.equal(service.password, '');
  }
});

test('returning after verification reloads Auth once, updates the address and clears pending state', async () => {
  const { service, user, reloads } = setup();
  await service.refresh(); assert.deepEqual(reloads, []);
  await service.send();
  service.cancel(); // Dismissing feedback does not revoke the link or stop refresh.
  let finish, requests = 0;
  user.reload = () => { requests++; return new Promise(resolve => { finish = () => { user.email = 'new@example.test'; resolve(); }; }); };
  const pending = service.refresh(); await tick(); await service.refresh();
  assert.equal(requests, 1);
  finish(); await pending;
  assert.equal(service.currentAddress, 'new@example.test'); assert.equal(service.address, 'new@example.test');
  assert.equal(service.sent, false);
});

test('cancel restores Auth value and editing permits another explicitly requested email', async () => {
  const { service, sent } = setup();
  await service.send(); service.address = 'other@example.test'; service.edit(); await service.send();
  assert.deepEqual(sent, ['new@example.test', 'other@example.test']);
  service.password = 'secret'; service.cancel();
  assert.equal(service.address, 'current@example.test'); assert.equal(service.password, '');
  assert.equal(service.sent, false); assert.equal(service.error, '');
});
