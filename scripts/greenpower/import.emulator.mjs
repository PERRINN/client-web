import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { planImport, CAR_ID } from './historySource.mjs';
import { runImport } from './historyImport.mjs';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { Subject } from 'rxjs';
import { data, load, recordings } from './load.mjs';
const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(host || '', /^(127\.0\.0\.1|localhost):\d+$/, 'Local Firestore emulator required');
const require = createRequire(import.meta.url), admin = require('firebase-admin');
const app = admin.initializeApp({ projectId: 'demo-greenpower' }, 'history-import-tests');
const db = app.firestore();
after(async () => { await db.terminate(); await app.delete(); });

test('real transactions resume atomically; full rerun validates raw data without changing document versions', async () => {
  const day = '2026-07-02', root = `GreenpowerTelemetry/424/days/${day}`;
  const at = Date.parse(day + 'T10:00:00Z');
  const body = JSON.stringify(Array.from({ length: 65 }, (_, i) => ({ id: i + 1, carId: CAR_ID, updated: String(at + i * 3000), speed: i % 2, brake: null })));
  const plan = planImport(body, day, 65);
  const old = await db.doc(root).collection('chunks').limit(4).get();
  assert.ok(old.size < 4, 'Unexpected demo data; refuse cleanup');
  const batch = db.batch(); old.docs.forEach(d => batch.delete(d.ref)); batch.delete(db.doc(root)); batch.delete(db.doc(root + '/live/latest'));
  const stateRef = db.doc(`GreenpowerTelemetry/424/imports/echook-${CAR_ID}-${day}`);
  batch.delete(stateRef); await batch.commit();
  await assert.rejects(runImport(db, plan, { write: true, timestamp: () => admin.firestore.FieldValue.serverTimestamp(), progress: () => { throw new Error('stop after first atomic chunk'); } }), /stop after/);
  assert.equal((await db.doc(root + '/live/latest').get()).data().count, 32);
  const result = await runImport(db, plan, { write: true, timestamp: () => admin.firestore.FieldValue.serverTimestamp() });
  assert.equal(result.added, 33);
  const before = await db.doc(root).collection('chunks').orderBy('__name__').limit(4).get();
  assert.equal(before.size, 3);
  assert.deepEqual(before.docs.flatMap(d => d.data().samples.map(s => s.raw)), plan.records.map(r => r.raw));
  const metadataBefore = await db.doc(root).get(), stateBefore = await stateRef.get();
  const rerun = await runImport(db, plan, { write: true });
  assert.equal(rerun.mode, 'verified-rerun'); assert.equal(rerun.added, 0);
  const after = await db.doc(root).collection('chunks').orderBy('__name__').limit(4).get();
  assert.deepEqual(after.docs.map(d => d.updateTime.toMillis()), before.docs.map(d => d.updateTime.toMillis()));
  assert.ok((await db.doc(root).get()).updateTime.isEqual(metadataBefore.updateTime));
  assert.ok((await stateRef.get()).updateTime.isEqual(stateBefore.updateTime));
  assert.equal((await db.doc(root + '/live/latest').get()).data().count, 65);
  const clientApp = firebase.initializeApp({ projectId: 'demo-greenpower', apiKey: 'demo-key' }, 'history-reader-test');
  const client = clientApp.firestore();
  client.useEmulator('127.0.0.1', Number(host.split(':')[1]), { mockUserToken: { sub: 'history-viewer', user_id: 'history-viewer' } });
  const { GreenpowerTelemetryService } = load('../../src/app/greenpower-telemetry/greenpowerTelemetry.service.ts', {
    '@angular/core': { Injectable: () => target => target, runInInjectionContext: (_, callback) => callback() },
    'firebase/compat/app': { default: firebase }, 'firebase/compat/firestore': {}, rxjs: { Subject }, './greenpowerData': data, './greenpowerRecording': recordings
  });
  const authState = new Subject(), reader = new GreenpowerTelemetryService({ authState }, { firestore: client }, {});
  try {
    reader.access = 'signed-in';
    await reader.loadDates();
    assert.equal(reader.datesError, '');
    assert.ok(reader.dates.includes(day));
    await reader.select(day);
    assert.equal(reader.error, ''); assert.equal(reader.more, false);
    assert.equal(reader.start, at); assert.equal(reader.end, at + 64 * 3000);
    assert.equal(reader.channels.find(c => c.id === '["Spd"]:m/s').points.length, 65);
  } finally { reader.ngOnDestroy(); await client.terminate(); await clientApp.delete(); }
});
