import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { BehaviorSubject, Subject } from 'rxjs';
import { load, eventData } from './load.mjs';
import { ROOT, adminAuth, recording, eventChange, request, session, sessionChange } from './eventFixtures.mjs';
import { createRequire } from 'node:module';
import { prepareDayMigration, runDayMigration } from './eventDayMigration.mjs';
const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(host || '', /^(127\.0\.0\.1|localhost):\d+$/, 'A local Firestore emulator is required; never use production.');
const require = createRequire(import.meta.url), admin = require('firebase-admin');
const projectId = 'demo-greenpower', app = admin.initializeApp({ projectId }), db = app.firestore();
const { greenpowerEventEdit } = require('../../functions/greenpowerEvents.f.js');
const invoke = (data, auth = adminAuth) => greenpowerEventEdit.run({ data, auth });
const day = '2026-06-14', fixture = recording(day);
after(async () => { await db.terminate(); await app.delete(); });
let created;
function token(uid, claims = {}) {
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url'), now = Math.floor(Date.now() / 1000);
  return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ ...claims, sub: uid, user_id: uid, aud: projectId,
    iss: 'https://securetoken.google.com/' + projectId, iat: now, exp: now + 3600, firebase: { sign_in_provider: 'custom', identities: {} } }) + '.';
}
async function access(path, uid, method = 'GET', claims = {}) {
  return fetch('http://' + host + '/v1/projects/' + projectId + '/databases/(default)/documents/' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: 'Bearer ' + token(uid, claims) } : {}) },
    ...(['PATCH', 'POST'].includes(method) ? { body: JSON.stringify({ fields: { tampered: { booleanValue: true } } }) } : {}) });
}
test('real callable creates one date-keyed event and typed sessions atomically without modifying raw data', async () => {
  const batch = db.batch(); fixture.records.forEach(([path, value]) => batch.set(db.doc(path), value)); await batch.commit();
  const before = await db.getAll(...fixture.records.map(([path]) => db.doc(path)));
  const input = request('day-emulator-create', [eventChange(day)], [sessionChange('practice', session(day, [fixture.segment(0, 1)])),
    sessionChange('race', { ...session(day, [fixture.segment(2, 3)]), type: 'race' })]);
  created = await invoke(input); assert.equal(created.writes, 5); assert.equal(created.reads, 7);
  const event = (await db.doc(ROOT + '/events/' + day).get()).data(); assert.equal(event.sessionCount, 2);
  const audit = (await db.doc(ROOT + '/metadataChanges/' + created.changeId).get()).data();
  assert.equal(audit.records.events[day].after.updatedAt.toMillis(), event.updatedAt.toMillis());
  const after = await db.getAll(...fixture.records.map(([path]) => db.doc(path)));
  assert.ok(after.every((snapshot, i) => snapshot.updateTime.isEqual(before[i].updateTime)));
  assert.equal((await invoke(input)).writes, 0);
});

test('anonymous reads and all direct writes remain denied while other signed-in users can read', async () => {
  for (const path of [ROOT + '/events/' + day, ROOT + '/sessions/race', ROOT + '/metadataChanges/' + created.changeId, ROOT + '/metadataRequests/' + created.changeId]) {
    assert.equal((await access(path)).status, 403);
    for (const uid of ['alice', 'bob']) assert.equal((await access(path, uid)).status, 200);
    for (const [uid, claims] of [[undefined, {}], ['alice', {}], ['admin', { perrinnAdmin: true }]])
      for (const method of ['PATCH', 'DELETE']) assert.equal((await access(path, uid, method, claims)).status, 403);
  }
});

test('callable rejects missing recordings, duplicate event identities, cross-day sessions and revoked admins', async () => {
  await assert.rejects(invoke(request('random', [eventChange('random')])), error => error.code === 'invalid-argument');
  await assert.rejects(invoke(request('revoked', [eventChange(day, 1, null)]), { uid: 'admin', token: {} }), error => error.code === 'permission-denied');
  await assert.rejects(invoke(request('missing', [eventChange('2026-06-15', 0, eventData.editable(eventData.dayEvent('2026-06-15')))])), error => error.code === 'failed-precondition');
  const next = recording('2026-06-15'), bad = { ...session(day, [fixture.segment(), next.segment()]), type: 'race' };
  await assert.rejects(invoke(request('cross', [eventChange(day, 1, null)], [sessionChange('cross', bad)])), error => error.code === 'invalid-argument');
  assert.equal((await db.doc(ROOT + '/sessions/cross').get()).exists, false);
});

test('concurrent identical creates replay once and stale revisions cannot duplicate a day event', async () => {
  const date = '2026-06-16'; await db.doc(ROOT + '/days/' + date).set({ date, count: 1 });
  const input = request('concurrent-date-create', [eventChange(date, 0, eventData.editable(eventData.dayEvent(date)))]);
  const results = await Promise.all([invoke(input), invoke(input)]);
  assert.equal(results.filter(result => !result.replayed).length, 1);
  assert.equal(results[0].changeId, results[1].changeId);
  await assert.rejects(invoke({ ...input, requestId: 'different-create' }), error => error.code === 'failed-precondition');
  assert.equal((await db.doc(ROOT + '/events/' + date).get()).data().revision, 1);
});

test('ordinary signed-in client discovers recorded events, filters typed sessions and clears on logout', async () => {
  const { GreenpowerEventsService } = load('../../src/app/greenpower-telemetry/greenpowerEvents.service.ts', {
    '@angular/core': { Injectable: () => target => target }, 'firebase/compat/app': { default: firebase }, 'firebase/compat/firestore': {}, rxjs: { Subject }, './greenpowerEvents': eventData
  });
  const clientApp = firebase.initializeApp({ projectId, apiKey: 'demo-key' }, 'day-event-viewer'), client = clientApp.firestore();
  const [hostname, port] = host.split(':'); client.useEmulator(hostname, Number(port), { mockUserToken: { sub: 'viewer', user_id: 'viewer' } });
  const state = new BehaviorSubject({ uid: 'viewer', ready: true, isAdmin: false });
  const service = new GreenpowerEventsService({ state, get current() { return state.value; } }, { firestore: client });
  const until = predicate => new Promise((resolve, reject) => {
    if (predicate()) return resolve();
    const timer = setTimeout(() => { sub.unsubscribe(); reject(Error('Listener timed out')); }, 10000);
    const sub = service.changed.subscribe(() => { if (predicate()) { clearTimeout(timer); sub.unsubscribe(); resolve(); } });
  });
  try {
    await service.loadEvents(true, { type: 'race', location: '', from: '2026-01-01', to: '2026-12-31' });
    assert.equal(service.listError, ''); assert.ok(service.events.some(event => event.id === day));
    await service.selectEvent(day); await until(() => service.eventReady && !service.loadingSessions);
    assert.deepEqual(service.sessions.map(session => session.id), ['race']);
    service.selectSession('race'); await until(() => service.sessionReady); assert.equal(service.selectedSession.type, 'race');
    state.next({ uid: '', ready: true, isAdmin: false }); assert.equal(service.selectedEvent, undefined); assert.deepEqual(service.events, []);
  } finally { service.ngOnDestroy(); await client.terminate(); await clientApp.delete(); }
});

test('real migration preserves source/raw versions and commits timestamped source audit snapshots', async () => {
  const date = '2026-06-17', sourceId = 'legacy-migration-source';
  const data = eventData.editable(eventData.dayEvent(date)); data.name = 'Current corrected name';
  const sourceRef = db.doc(ROOT + '/events/' + sourceId), dayRef = db.doc(ROOT + '/days/' + date);
  await dayRef.set({ date, count: 1 });
  await sourceRef.set({ ...data, revision: 2, sessionCount: 0, updatedBy: adminAuth.uid, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  const before = await db.getAll(sourceRef, dayRef);
  const manifest = JSON.stringify({ version: 1, projectId: 'perrinn-d5fc1', scope: 'events-only', events: [
    { id: sourceId, expectedRevision: 0, data: { ...data, name: 'Old manifest name', metadataStatus: 'review_needed' } }
  ] });
  const plan = await prepareDayMigration(db, manifest), settings = { actor: async () => adminAuth, timestamp: () => admin.firestore.FieldValue.serverTimestamp() };
  assert.equal((await runDayMigration(db, plan, settings)).writes, 0);
  const applied = await runDayMigration(db, plan, { ...settings, apply: true }); assert.equal(applied.writes, 3);
  const canonical = (await db.doc(ROOT + '/events/' + date).get()).data(); assert.equal(canonical.name, 'Current corrected name');
  const audit = (await db.doc(ROOT + '/metadataChanges/' + applied.results[0].changeId).get()).data();
  assert.equal(audit.migrationSources[sourceId].revision, 2); assert.ok(audit.migrationSources[sourceId].updatedAt.toMillis() > 0);
  assert.equal((await runDayMigration(db, plan, { ...settings, apply: true })).writes, 0);
  const after = await db.getAll(sourceRef, dayRef); assert.ok(after.every((snapshot, i) => snapshot.updateTime.isEqual(before[i].updateTime)));
});
