import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { BehaviorSubject, Subject } from 'rxjs';
import { load, eventData, recordings } from './load.mjs';
import { ROOT, adminAuth, recording, event, eventChange, request, session, sessionChange } from './eventFixtures.mjs';
const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(host || '', /^(127\.0\.0\.1|localhost):\d+$/, 'A local Firestore emulator is required; never use production.');
const projectId = 'demo-greenpower';
const require = createRequire(import.meta.url), admin = require('firebase-admin');
const app = admin.initializeApp({ projectId });
const db = app.firestore();
const { greenpowerEventEdit } = require('../../functions/greenpowerEvents.f.js');
after(async () => { await db.terminate(); await app.delete(); });
const invoke = (data, auth = adminAuth) => greenpowerEventEdit.run({ data, auth });
function token(uid, claims = {}) {
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ ...claims, sub: uid, user_id: uid, aud: projectId,
    iss: 'https://securetoken.google.com/' + projectId, iat: now, exp: now + 3600,
    firebase: { sign_in_provider: 'custom', identities: {} } }) + '.';
}
const documentsUrl = 'http://' + host + '/v1/projects/' + projectId + '/databases/(default)/documents/';
async function access(path, uid, method = 'GET', claims = {}) {
  return fetch(documentsUrl + path, { method, headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: 'Bearer ' + token(uid, claims) } : {}) },
    ...(['PATCH', 'POST'].includes(method) ? { body: JSON.stringify({ fields: { tampered: { booleanValue: true } } }) } : {}) });
}
let created;
const fixture = recording('2026-06-14');
test('real callable handler commits verified sessions, counters and timestamped audit maps atomically', async () => {
  const batch = db.batch(); fixture.records.forEach(([path, value]) => batch.set(db.doc(path), value)); await batch.commit();
  const before = await db.getAll(...fixture.records.map(([path]) => db.doc(path)));
  const input = request('emulator-create', [eventChange('emulator-dyno')], [sessionChange('emulator-run-1', session('emulator-dyno', [fixture.segment(0, 1)])),
    sessionChange('emulator-run-2', session('emulator-dyno', [fixture.segment(2, 3)], 'Run 2'))]);
  created = await invoke(input);
  assert.equal(created.writes, 5); assert.equal(created.reads, 7);
  const eventDoc = await db.doc(ROOT + '/events/emulator-dyno').get();
  assert.equal(eventDoc.data().sessionCount, 2); assert.ok(eventDoc.data().updatedAt.toMillis() > 0);
  const audit = (await db.doc(ROOT + '/metadataChanges/' + created.changeId).get()).data();
  assert.equal(audit.records.events['emulator-dyno'].after.updatedAt.toMillis(), eventDoc.data().updatedAt.toMillis());
  assert.equal(audit.records.sessions['emulator-run-1'].before, null);
  const after = await db.getAll(...fixture.records.map(([path]) => db.doc(path)));
  assert.ok(after.every((snapshot, i) => snapshot.updateTime.isEqual(before[i].updateTime)), 'raw/day/import versions never change');
  const replay = await invoke(input); assert.equal(replay.writes, 0); assert.equal(replay.replayed, true);
  assert.equal((await db.doc(ROOT + '/events/emulator-dyno').get()).data().revision, 1);
});

test('metadata rules deny anonymous reads and every direct client write, including admin claims', async () => {
  const paths = [ROOT + '/events/emulator-dyno', ROOT + '/sessions/emulator-run-1',
    ROOT + '/metadataChanges/' + created.changeId, ROOT + '/metadataRequests/' + created.changeId];
  for (const path of paths) {
    assert.equal((await access(path)).status, 403);
    for (const uid of ['alice', 'bob']) assert.equal((await access(path, uid)).status, 200, uid + ': ' + path);
    for (const [uid, claims] of [[undefined, {}], ['alice', {}], ['bob', {}], ['test-admin', { perrinnAdmin: true }]]) {
      for (const method of ['PATCH', 'DELETE']) assert.equal((await access(path, uid, method, claims)).status, 403, method + ': ' + path);
    }
  }
  // A protected collection query also cannot expose telemetry while signed out.
  const response = await fetch(documentsUrl + ROOT + ':runQuery', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'events' }], limit: 2 } }) });
  assert.equal(response.status, 403);
});

test('handler rejects unauthenticated, ordinary and revoked admins without writes', async () => {
  const input = request('emulator-forbidden', [eventChange('emulator-forbidden')]);
  for (const [auth, code] of [[null, 'unauthenticated'], [{ uid: 'alice', token: {} }, 'permission-denied'],
    [{ uid: 'test-admin', token: { perrinnAdmin: 'true' } }, 'permission-denied'], [{ uid: 'test-admin', token: {} }, 'permission-denied']]) {
    await assert.rejects(invoke(input, auth), e => e.code === code);
  }
  assert.equal((await db.doc(ROOT + '/events/emulator-forbidden').get()).exists, false);
});

test('concurrent identical requests commit once; conflicting revisions retain the winning metadata', async () => {
  const input = request('emulator-concurrent', [eventChange('emulator-concurrent')]);
  const results = await Promise.all([invoke(input), invoke(input)]);
  assert.equal(results.filter(r => !r.replayed).length, 1); assert.equal(results[0].changeId, results[1].changeId);
  const updates = ['A', 'B'].map(name => invoke(request('emulator-update-' + name, [eventChange('emulator-concurrent', 1, event(name))])));
  const settled = await Promise.allSettled(updates);
  assert.equal(settled.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(settled.find(r => r.status === 'rejected').reason.code, 'failed-precondition');
  assert.equal((await db.doc(ROOT + '/events/emulator-concurrent').get()).data().revision, 2);
});

test('real split/merge changes only metadata and retains source event until its last session moves', async () => {
  const move = { ...session('emulator-target', [fixture.segment(2, 3)], 'Run 2') };
  await invoke(request('emulator-split', [eventChange('emulator-dyno', 1, null), eventChange('emulator-target')], [sessionChange('emulator-run-2', move, 1)], 'split'));
  await assert.rejects(invoke(request('emulator-premature', [eventChange('emulator-dyno', 2, { ...event(), state: 'superseded', supersededBy: ['emulator-target'] }), eventChange('emulator-target', 1, null)])), e => e.code === 'failed-precondition');
  const merge = request('emulator-merge', [eventChange('emulator-dyno', 2, null), eventChange('emulator-target', 1, { ...event(), state: 'superseded', supersededBy: ['emulator-dyno'] })],
    [sessionChange('emulator-run-2', { ...move, eventId: 'emulator-dyno' }, 2)], 'merge');
  const result = await invoke(merge);
  assert.equal((await db.doc(ROOT + '/events/emulator-dyno').get()).data().sessionCount, 2);
  assert.equal((await db.doc(ROOT + '/events/emulator-target').get()).data().sessionCount, 0);
  const audit = (await db.doc(ROOT + '/metadataChanges/' + result.changeId).get()).data();
  assert.equal(audit.records.sessions['emulator-run-2'].before.eventId, 'emulator-target');
  assert.equal(audit.records.sessions['emulator-run-2'].after.eventId, 'emulator-dyno');
});

test('ordinary signed-in client selects events and loads only the session samples from a shared chunk', async () => {
  const { GreenpowerEventsService } = load('../../src/app/greenpower-telemetry/greenpowerEvents.service.ts', {
    '@angular/core': { Injectable: () => target => target }, 'firebase/compat/app': { default: firebase }, 'firebase/compat/firestore': {},
    rxjs: { Subject }, './greenpowerEvents': eventData
  });
  const clientApp = firebase.initializeApp({ projectId, apiKey: 'demo-key' }, 'metadata-viewer');
  const client = clientApp.firestore(), [hostname, port] = host.split(':');
  client.useEmulator(hostname, Number(port), { mockUserToken: { sub: 'viewer', user_id: 'viewer' } });
  const state = new BehaviorSubject({ uid: 'viewer', ready: true, isAdmin: false });
  const permissions = { state, get current() { return state.value; } };
  const events = new GreenpowerEventsService(permissions, { firestore: client });
  const until = predicate => new Promise((resolve, reject) => {
    if (predicate()) return resolve();
    const timer = setTimeout(() => { subscription.unsubscribe(); reject(new Error('Metadata listener timed out')); }, 10000);
    const subscription = events.changed.subscribe(() => { if (predicate()) { clearTimeout(timer); subscription.unsubscribe(); resolve(); } });
  });
  try {
    await events.loadEvents(); assert.equal(events.listError, ''); assert.ok(events.events.some(event => event.id === 'emulator-dyno'));
    events.selectEvent('emulator-dyno'); await until(() => events.eventReady && events.sessions.length === 2);
    events.selectSession('emulator-run-1'); await until(() => events.sessionReady);
    const reader = new recordings.RecordingReader(client.collection(ROOT + '/days'), events.selectedSession.segments);
    await reader.load(() => true);
    assert.deepEqual(reader.entries.map(entry => entry.sample.id), fixture.samples.slice(0, 2).map(sample => sample.id));
    assert.equal(reader.more, false); assert.equal(events.canEdit, false);
    state.next({ uid: '', ready: true, isAdmin: false }); assert.equal(events.selectedSession, undefined); assert.deepEqual(events.events, []);
  } finally { events.ngOnDestroy(); await client.terminate(); await clientApp.delete(); }
});
