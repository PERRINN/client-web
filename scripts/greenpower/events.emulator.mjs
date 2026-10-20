import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { BehaviorSubject, Subject } from 'rxjs';
import { load, eventData, dayData, tracks } from './load.mjs';
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

test('ordinary signed-in client discovers day events and session subcollections, filters sessions and clears on logout', async () => {
  const metadata = dayData.emptyDay(day); metadata.eventName = 'Workshop'; metadata.sessionTypeCounts = { practice: 1, race: 1 };
  for (const [index, type] of ['practice', 'race'].entries()) {
    const range = fixture.segment(index * 2, index * 2 + 1);
    await db.doc(ROOT + '/days/' + day + '/sessions/' + type).set({ id: type, type, startAt: range.firstAt, endAt: range.lastAt, batteryIds: [], overrides: {}, ranges: [range], schemaVersion: 2, telemetryRoot: ROOT, revision: 1, updatedBy: 'admin' });
  }
  await db.doc(ROOT + '/days/' + day).set(metadata);
  await db.doc(ROOT + '/days/' + day + '/live/latest').set({ count: 4, activeChunk: 0, latest: fixture.samples.at(-1) });
  const { GreenpowerEventsService } = load('../../src/app/greenpower-telemetry/greenpowerEvents.service.ts', {
    '@angular/core': { Injectable: () => target => target }, 'firebase/compat/app': { default: firebase }, 'firebase/compat/firestore': {}, rxjs: { Subject }, './greenpowerEvents': eventData, './greenpowerDay': dayData, './greenpowerTracks': tracks
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
    assert.equal(service.listError, ''); assert.ok(service.events.some(event => event.date === day));
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

test('day/session callable edits defaults atomically, verifies ranges and blocks legacy edits after migration', async () => {
  const before = await db.doc(ROOT + '/days/' + day + '/chunks/0000000000').get();
  const parent = (await db.doc(ROOT + '/days/' + day).get()).data();
  const input = { schemaVersion: 2, requestId: 'day-defaults', kind: 'event', date: day, expectedRevision: parent.revision, data: dayData.editableDay(parent) };
  input.data.defaults = { driver: 'Alex', motorGearTeeth: 12, wheelGearTeeth: 60 };
  const result = await invoke(input); assert.equal(result.writes, 3); assert.equal((await invoke(input)).writes, 0);
  assert.ok((await before.ref.get()).updateTime.isEqual(before.updateTime));
  const audit = (await db.doc(ROOT + '/metadataChanges/' + result.changeId).get()).data();
  assert.ok(audit.records.days[ROOT + '/days/' + day].after.updatedAt.toMillis() > 0);
  await assert.rejects(invoke({ ...input, requestId: 'revoked-embedded' }, { uid: 'viewer', token: {} }), error => error.code === 'permission-denied');
  await assert.rejects(invoke(request('old-client-after-migration', [eventChange(day, 1, null)])), error => error.code === 'failed-precondition');
  const race = (await db.doc(ROOT + '/days/' + day + '/sessions/race').get()).data();
  const bad = { schemaVersion: 2, kind: 'session', requestId: 'bad-boundary', date: day, expectedRevision: result.revision, expectedSessionRevision: race.revision, session: dayData.editableSession(race) };
  bad.session.ranges[0].lastSampleId = 'missing';
  await assert.rejects(invoke(bad), error => error.code === 'failed-precondition');
});

test('schema-v2 operator migration preserves chunk/source versions, resumes safely and exposes no client writes', async () => {
  const { prepareMetadataMigration, applyMetadataMigration } = await import('./dayMetadataMigration.mjs');
  const date = '2026-06-18', rec = recording(date), sourceId = 'embedded-migration-source';
  const batch = db.batch(); rec.records.forEach(([path, value]) => batch.set(db.doc(path), value));
  batch.set(db.doc(ROOT + '/days/' + date), { ...rec.records[0][1], latest: rec.samples.at(-1) });
  batch.set(db.doc(ROOT + '/events/' + sourceId), { ...eventData.editable(eventData.dayEvent(date)), name: 'Preserved name', notes: 'Historical notes',
    revision: 1, sessionCount: 1, updatedBy: adminAuth.uid, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  const sessionSource = db.doc(ROOT + '/sessions/migrated-session');
  batch.set(sessionSource, { ...session(sourceId, [rec.segment()]), type: 'practice', revision: 1, updatedBy: adminAuth.uid, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  await batch.commit();
  const rawRef = db.doc(rec.records[1][0]), sourceRef = db.doc(ROOT + '/events/' + sourceId);
  const [rawBefore, sourceBefore, sessionBefore] = await db.getAll(rawRef, sourceRef, sessionSource);
  const plan = JSON.parse(JSON.stringify(await prepareMetadataMigration(db, { version: 2, projectId: 'perrinn-d5fc1', days: [{ date, trackId: null }] })));
  const settings = { timestamp: () => admin.firestore.FieldValue.serverTimestamp() };
  assert.equal((await applyMetadataMigration(db, adminAuth, plan, settings)).writes, 0);
  assert.equal((await applyMetadataMigration(db, adminAuth, plan, { ...settings, dryRun: false })).writes, 5);
  assert.equal((await db.doc(ROOT + '/days/' + date).get()).data().eventName, 'Preserved name');
  assert.equal((await applyMetadataMigration(db, adminAuth, plan, { ...settings, dryRun: false })).writes, 0);
  assert.ok((await rawRef.get()).updateTime.isEqual(rawBefore.updateTime));
  assert.ok((await sourceRef.get()).updateTime.isEqual(sourceBefore.updateTime));
  assert.ok((await sessionSource.get()).updateTime.isEqual(sessionBefore.updateTime));
  assert.deepEqual((await db.doc(ROOT + '/days/' + date + '/sessions/migrated-session').get()).data().ranges, [rec.segment()]);
  for (const path of [ROOT + '/days/' + date, ROOT + '/days/' + date + '/live/latest']) {
    assert.equal((await access(path)).status, 403);
    for (const uid of ['alice', 'bob']) assert.equal((await access(path, uid)).status, 200);
    assert.equal((await access(path, 'admin', 'PATCH', { perrinnAdmin: true })).status, 403);
  }
});

test('scoped collection-group queries retrieve race sessions across days for signed-in users only', async () => {
  const nextDay = '2026-06-19', rec = recording(nextDay), range = rec.segment();
  const data = { id: 'race-other-day', type: 'race', startAt: range.firstAt, endAt: range.lastAt, ranges: [range], batteryIds: [], overrides: {}, schemaVersion: 2, telemetryRoot: ROOT, revision: 1, updatedBy: 'admin' };
  const path = ROOT + '/days/' + nextDay + '/sessions/race-other-day'; await db.doc(path).set(data);
  await db.doc(ROOT + '/sessions/legacy-not-in-group-results').set({ type: 'race', startAt: range.firstAt });
  const field = (name, value) => ({ fieldFilter: { field: { fieldPath: name }, op: 'EQUAL', value: typeof value === 'number' ? { integerValue: String(value) } : { stringValue: value } } });
  const query = { structuredQuery: { from: [{ collectionId: 'sessions', allDescendants: true }], where: { compositeFilter: { op: 'AND', filters: [field('telemetryRoot', ROOT), field('schemaVersion', 2), field('type', 'race')] } }, orderBy: [{ field: { fieldPath: 'startAt' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: 30 } };
  for (const uid of [undefined, 'alice', 'bob']) {
    const response = await fetch('http://' + host + '/v1/projects/' + projectId + '/databases/(default)/documents:runQuery', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: 'Bearer ' + token(uid) } : {}) }, body: JSON.stringify(query) });
    assert.equal(response.status, uid ? 200 : 403);
    if (uid) {
      const docs = (await response.json()).filter(item => item.document).map(item => item.document);
      assert.ok(docs.some(doc => doc.name.endsWith('/days/' + day + '/sessions/race')));
      assert.ok(docs.some(doc => doc.name.endsWith('/days/' + nextDay + '/sessions/race-other-day')));
      assert.ok(docs.every(doc => doc.fields.type.stringValue === 'race' && doc.fields.telemetryRoot.stringValue === ROOT));
    }
  }
  for (const uid of [undefined, 'alice', 'admin']) assert.equal((await access(path, uid, 'PATCH', { perrinnAdmin: true })).status, 403);
});

test('session-count backfill and concurrent type edits keep one exact summary with no raw changes', async () => {
  const { backfillSessionCounts } = await import('./sessionCountsBackfill.mjs');
  const date = '2026-06-20', rec = recording(date), parentRef = db.doc(ROOT + '/days/' + date);
  const metadata = dayData.emptyDay(date);
  const batch = db.batch(); rec.records.forEach(([path, value]) => batch.set(db.doc(path), value));
  batch.set(parentRef, metadata);
  batch.set(db.doc(parentRef.path + '/live/latest'), { count: 4, activeChunk: 0 });
  for (const index of [0, 1]) {
    const range = rec.segment(index * 2, index * 2 + 1);
    batch.set(db.doc(parentRef.path + '/sessions/s' + index), { id: 's' + index, type: 'practice', startAt: range.firstAt, endAt: range.lastAt,
      ranges: [range], batteryIds: [], overrides: {}, schemaVersion: 2, telemetryRoot: ROOT, revision: 1, updatedBy: adminAuth.uid });
  }
  await batch.commit();
  const rawRef = db.doc(rec.records[1][0]), rawBefore = await rawRef.get();
  const settings = { timestamp: () => admin.firestore.FieldValue.serverTimestamp() };
  const review = { version: 1, projectId: 'perrinn-d5fc1', dates: [date] };
  const preview = await backfillSessionCounts(db, adminAuth, review, settings);
  assert.deepEqual(preview.results[0].sessionTypeCounts, { practice: 2 });
  assert.equal((await parentRef.get()).data().sessionTypeCounts, undefined);
  await backfillSessionCounts(db, adminAuth, review, { ...settings, dryRun: false });
  assert.equal((await backfillSessionCounts(db, adminAuth, review, { ...settings, dryRun: false })).results[0].writes, 0);
  const inputs = await Promise.all(['race', 'battery_dyno'].map(async (type, index) => {
    const session = (await db.doc(parentRef.path + '/sessions/s' + index).get()).data();
    return { schemaVersion: 2, kind: 'session', requestId: 'count-type-' + index, date, expectedRevision: 0,
      expectedSessionRevision: 1, session: { ...dayData.editableSession(session), type } };
  }));
  await Promise.all(inputs.map(input => invoke(input)));
  assert.deepEqual((await parentRef.get()).data().sessionTypeCounts, { race: 1, battery_dyno: 1 });
  assert.equal((await parentRef.get()).data().revision, 0);
  assert.equal((await invoke(inputs[0])).writes, 0);
  await assert.rejects(invoke({ ...inputs[0], requestId: 'viewer-count-edit' }, { uid: 'viewer', token: {} }), error => error.code === 'permission-denied');
  assert.ok((await rawRef.get()).updateTime.isEqual(rawBefore.updateTime));
});


test('event circumference uses the real callable with audited, revisioned saves and unchanged access rules', async () => {
  const date = '2026-06-25', rec = recording(date), parentRef = db.doc(ROOT + '/days/' + date);
  const batch = db.batch(); rec.records.forEach(([path, value]) => batch.set(db.doc(path), value));
  const parent = dayData.emptyDay(date);
  batch.set(parentRef, parent); batch.set(db.doc(parentRef.path + '/live/latest'), { count: 4, activeChunk: 0 });
  await batch.commit();
  const rawRef = db.doc(rec.records[1][0]), rawBefore = await rawRef.get();
  const input = { schemaVersion: 2, kind: 'event', requestId: 'circumference-edit', date, expectedRevision: 0,
    data: { ...dayData.editableDay(parent), wheelCircumferenceM: 1.36 } };
  await assert.rejects(invoke(input, null), error => error.code === 'unauthenticated');
  await assert.rejects(invoke(input, { uid: 'alice', token: {} }), error => error.code === 'permission-denied');
  const saved = await invoke(input);
  assert.equal((await parentRef.get()).data().wheelCircumferenceM, 1.36);
  assert.equal((await invoke(input)).writes, 0);
  const audit = (await db.doc(ROOT + '/metadataChanges/' + saved.changeId).get()).data();
  assert.equal(audit.records.days[parentRef.path].after.wheelCircumferenceM, 1.36);
  const legacy = { ...input, requestId: 'old-circumference-client', expectedRevision: saved.revision, data: { ...input.data } };
  delete legacy.data.wheelCircumferenceM;
  await invoke(legacy);
  assert.equal((await parentRef.get()).data().wheelCircumferenceM, 1.36);
  assert.ok((await rawRef.get()).updateTime.isEqual(rawBefore.updateTime));
  assert.equal((await access(parentRef.path)).status, 403);
  for (const uid of ['alice', 'bob']) assert.equal((await access(parentRef.path, uid)).status, 200);
  assert.equal((await access(parentRef.path, 'admin', 'PATCH', { perrinnAdmin: true })).status, 403);
});
