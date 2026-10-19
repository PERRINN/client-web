import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { BehaviorSubject, Subject } from 'rxjs';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { data, load } from './load.mjs';
const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(host || '', /^(127\.0\.0\.1|localhost):\d+$/, 'A local Firestore emulator is required; production is never allowed.');
const projectId = 'demo-greenpower';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const { storeSample, validatePayload, createHandler, londonDay } = require('./utils/greenpowerTelemetry');
const app = admin.initializeApp({ projectId }, `greenpower-${process.pid}`);
const db = app.firestore();
after(async () => { await db.terminate(); await app.delete(); });
function token(uid, claims = {}) {
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims, sub: uid, user_id: uid, aud: projectId, iss: `https://securetoken.google.com/${projectId}`, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600, firebase: { sign_in_provider: 'custom', identities: {} } })}.`;
}
async function request(path, uid, method = 'GET', body, claims) {
  return fetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents/${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${token(uid, claims)}` } : {}) }, body: body ? JSON.stringify(body) : undefined
  });
}
test('real Firestore stores every sample through chunk rollover and concurrent transactions', async () => {
  const at = Date.UTC(2026, 9, 18);
  const old = await db.collection('GreenpowerTelemetry/424/days/2026-10-18/chunks').limit(10).get();
  assert.ok(old.size < 10, 'Refuse unexpected large demo cleanup');
  const batch = db.batch(); old.docs.forEach(doc => batch.delete(doc.ref)); batch.delete(db.doc('GreenpowerTelemetry/424/days/2026-10-18')); await batch.commit();
  for (let i = 0; i < 34; i++) await storeSample(db, validatePayload(JSON.stringify({ Vt: 24, unknown: [[i]], status: 'synthetic' })), at + i, `seq-${i}`, () => admin.firestore.FieldValue.serverTimestamp());
  // Small concurrency: exercise transaction contention without an unbounded retry loop.
  await Promise.all([0, 1].map(i => storeSample(db, '{"A":30}', at + 100 + i, `parallel-${i}`)));
  const day = await db.doc('GreenpowerTelemetry/424/days/2026-10-18').get();
  assert.equal(day.data().count, 36);
  const chunks = await day.ref.collection('chunks').orderBy(admin.firestore.FieldPath.documentId()).limit(100).get();
  assert.equal(chunks.size, 2);
  assert.equal(chunks.docs.flatMap(doc => doc.data().samples).length, 36);
  assert.ok(day.data().updatedAt.toMillis() > 0);
});
test('anonymous telemetry reads/listing are denied; two signed-in users can read; all client writes are denied', async () => {
  const day = 'GreenpowerTelemetry/424/days/2026-10-18';
  for (const path of [day, `${day}/chunks/0000000000`, 'GreenpowerTelemetry/424/days', `${day}/chunks`]) {
    assert.equal((await request(path)).status, 403, path);
    for (const uid of ['alice', 'bob']) assert.equal((await request(path, uid)).status, 200, `${uid}: ${path}`);
  }
  for (const uid of [undefined, 'alice', 'bob']) for (const path of [day, `${day}/chunks/0000000000`, 'GreenpowerTelemetry/424']) {
    assert.equal((await request(path, uid, 'PATCH', { fields: { tampered: { booleanValue: true } } })).status, 403);
    assert.equal((await request(path, uid, 'DELETE')).status, 403);
  }
});
test('existing public collection and nested document reads remain available', async () => {
  for (const path of ['PERRINNMessages/greenpower-rule-test', 'ExistingRuleTest/doc/nested/doc']) {
    await db.doc(path).set({ synthetic: true });
    assert.equal((await request(path)).status, 200);
    await db.doc(path).delete();
  }
});
test('real client listeners recover every sample after a network interruption and clear on logout', async () => {
  const { GreenpowerTelemetryService } = load('../../src/app/greenpower-telemetry/greenpowerTelemetry.service.ts', {
    '@angular/core': { Injectable: () => target => target, runInInjectionContext: (_, callback) => callback() },
    'firebase/compat/app': { default: firebase }, 'firebase/compat/firestore': {}, rxjs: { Subject }, './greenpowerData': data
  });
  const clientApp = firebase.initializeApp({ projectId, apiKey: 'demo-key' }, `greenpower-client-${process.pid}`);
  const client = clientApp.firestore(), [hostname, port] = host.split(':');
  client.useEmulator(hostname, Number(port), { mockUserToken: { sub: 'alice', user_id: 'alice' } });
  const authState = new Subject(), service = new GreenpowerTelemetryService({ authState }, { firestore: client }, {});
  const until = predicate => new Promise((resolve, reject) => {
    if (predicate()) return resolve();
    const timeout = setTimeout(() => { subscription.unsubscribe(); reject(new Error('Timed out waiting for listener update')); }, 10000);
    const subscription = service.changed.subscribe(() => { if (predicate()) { clearTimeout(timeout); subscription.unsubscribe(); resolve(); } });
  });
  try {
    authState.next({ uid: 'alice' });
    await until(() => !service.loading);
    await service.select('2026-10-18', true);
    await until(() => service.connected && service.channels.find(c => c.label === 'Total voltage')?.points.length === 34);
    await client.disableNetwork();
    for (let i = 0; i < 3; i++) await storeSample(db, '{"Vt":25}', Date.UTC(2026, 9, 18, 1) + i, `offline-${i}`);
    await client.enableNetwork();
    await until(() => service.latest?.id === 'offline-2' && service.channels.find(c => c.label === 'Total voltage')?.points.length === 37);
    assert.equal(new Set(service.channels.find(c => c.label === 'Total voltage').points.map(p => p.time)).size, 37);
    authState.next(null); assert.deepEqual(service.channels, []); assert.equal(service.latest, undefined);
  } finally { service.ngOnDestroy(); await client.terminate(); await clientApp.delete(); }
});
test('bounded synthetic sender uploads POST and path-JSON GET through HTTP into Firestore', async () => {
  const password = 'isolated-synthetic-emulator-password-32-characters';
  const handler = createHandler({ db, password: () => password, timestamp: () => admin.firestore.FieldValue.serverTimestamp() });
  const server = createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part);
    const url = new URL(req.url, 'http://localhost');
    req.path = url.pathname; req.query = Object.fromEntries(url.searchParams); req.rawBody = Buffer.concat(parts); req.get = name => req.headers[name];
    res.set = (key, value) => { res.setHeader(key, value); return res; };
    res.status = code => { res.statusCode = code; return res; }; res.send = body => res.end(body);
    await handler(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const dayRef = db.doc(`GreenpowerTelemetry/424/days/${londonDay()}`);
    const before = (await dayRef.get()).data()?.count || 0;
    for (const method of ['POST', 'GET']) {
      const { stdout } = await promisify(execFile)(process.execPath, [new URL('./send.mjs', import.meta.url).pathname], {
        env: { ...process.env, GREENPOWER_TEST_URL: `http://127.0.0.1:${server.address().port}/`, GREENPOWER_TELEMETRY_PASSWORD: password, GREENPOWER_TEST_METHOD: method, GREENPOWER_TEST_COUNT: '1' }, timeout: 20000
      });
      assert.equal(JSON.parse(stdout).status, 204);
    }
    const after = (await dayRef.get()).data();
    assert.equal(after.count - before, 2);
    assert.equal(JSON.parse(after.latest.raw).synthetic, true);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('shared view is signed-in readable and only exact admin claims can save valid revisioned settings', async () => {
  const path='GreenpowerTelemetry/424/config/view',ref=db.doc(path);
  await ref.delete();
  const fieldMap = value => ({mapValue:{fields:Object.fromEntries(Object.entries(value).map(([key,flag])=>[key,{booleanValue:flag}]))}});
  const fields = (revision=1,extra={})=>({
    scalars:fieldMap({'["Vt"]:V':true}), charts:fieldMap({'["A"]:A':true}),
    revision:{integerValue:String(revision)},updatedBy:{stringValue:'admin'},...extra
  });
  async function commit(uid,claims,updates=fields(),target=path) {
    return fetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents:commit`,{
      method:'POST',headers:{'Content-Type':'application/json',...(uid?{Authorization:`Bearer ${token(uid,claims)}`}:{})},
      body:JSON.stringify({writes:[{update:{name:`projects/${projectId}/databases/(default)/documents/${target}`,fields:updates},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}]})
    });
  }
  for(const [uid,claims] of [[undefined,{}],['bob',{}],['admin',{perrinnAdmin:'true'}],['admin',{admin:true}]]) {
    assert.equal((await commit(uid,claims)).status,403,'only the exact trusted claim grants access');
  }
  assert.equal((await commit('admin',{perrinnAdmin:true})).status,200,'admin creates configuration');
  assert.equal((await request(path)).status,403);
  for(const uid of ['alice','bob']) assert.equal((await request(path,uid)).status,200);
  assert.equal((await commit('admin',{perrinnAdmin:true})).status,403,'stale revision rejected');
  for(const updates of [
    fields(2,{updatedBy:{stringValue:'bob'}}),
    fields(2,{charts:fieldMap({bad:false})}),
    fields(2,{unexpected:{stringValue:'denied'}}),
    fields(2,{scalars:{arrayValue:{values:[]}}}),
    fields(2,{charts:fieldMap(Object.fromEntries(Array.from({length:513},(_,i)=>[String(i),true])))})
  ]) assert.equal((await commit('admin',{perrinnAdmin:true},updates)).status,403);
  assert.equal((await commit('admin',{perrinnAdmin:true},fields(2))).status,200);
  assert.equal((await request(path,'admin','DELETE',undefined,{perrinnAdmin:true})).status,403);
  for(const target of ['GreenpowerTelemetry/424/config/other','GreenpowerTelemetry/other/config/view','GreenpowerTelemetry/424/days/2026-10-18']) {
    assert.equal((await commit('admin',{perrinnAdmin:true},fields(1),target)).status,403,'role grants no telemetry-data writes');
  }
  await ref.delete();
});

test('real admin saves are synchronized to another signed-in viewer without changing telemetry', async () => {
  const viewHelpers=load('../../src/app/greenpower-telemetry/greenpowerView.ts',{'./greenpowerData':data});
  const {GreenpowerViewService}=load('../../src/app/greenpower-telemetry/greenpowerView.service.ts',{
    '@angular/core':{Injectable:()=>target=>target},'firebase/compat/app':{default:firebase},'firebase/compat/firestore':{},rxjs:{Subject},'./greenpowerView':viewHelpers
  });
  const apps=[],services=[],clients=[];
  function connect(uid,isAdmin) {
    const app=firebase.initializeApp({projectId,apiKey:'demo-key'},`view-${uid}-${process.pid}`);apps.push(app);
    const client=app.firestore();clients.push(client);const [hostname,port]=host.split(':');
    client.useEmulator(hostname,Number(port),{mockUserToken:{sub:uid,user_id:uid,...(isAdmin?{perrinnAdmin:true}:{})}});
    const state=new BehaviorSubject({uid,isAdmin,ready:true}),permissions={state,get current(){return state.value;}};
    const service=new GreenpowerViewService(permissions,{firestore:client});services.push(service);
    return {service,state};
  }
  const until=(service,predicate)=>new Promise((resolve,reject)=>{
    if(predicate())return resolve();
    const timer=setTimeout(()=>{sub.unsubscribe();reject(new Error('Timed out waiting for shared view'));},10000);
    const sub=service.changed.subscribe(()=>{if(predicate()){clearTimeout(timer);sub.unsubscribe();resolve();}});
  });
  const ref=db.doc(viewHelpers.VIEW_PATH);await ref.delete();
  const channels=data.channelsFor([{id:'a',receivedAt:1,source:'demo',raw:'{"Vt":24,"A":30}'}]);
  try {
    const editor=connect('editor',true),viewer=connect('viewer',false);
    await Promise.all([until(editor.service,()=>editor.service.ready),until(viewer.service,()=>viewer.service.ready)]);
    editor.service.edit(channels);editor.service.toggle('scalars',channels[0].id,false);await editor.service.save();
    assert.equal(editor.service.error,'');
    await until(viewer.service,()=>viewer.service.scalars(channels).length===1);
    assert.equal(viewer.service.canEdit,false);assert.equal(viewer.service.scalars(channels)[0].label,'Current');
    assert.equal(viewer.service.charts(channels).length,2,'chart selection remains independent');
    viewer.state.next({uid:'',isAdmin:false,ready:true});assert.deepEqual(viewer.service.scalars(channels),[]);
  } finally {
    services.forEach(service=>service.ngOnDestroy());await Promise.all(clients.map(client=>client.terminate()));await Promise.all(apps.map(app=>app.delete()));await ref.delete();
  }
});

test('existing presence ownership and timestamp-only writes remain unchanged', async () => {
  async function presence(uid,extra={}) {
    return fetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents:commit`,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token(uid)}`},
      body:JSON.stringify({writes:[{update:{name:`projects/${projectId}/databases/(default)/documents/userPresence/alice`,fields:extra},updateTransforms:[{fieldPath:'lastActiveAt',setToServerValue:'REQUEST_TIME'}]}]})
    });
  }
  assert.equal((await presence('alice')).status,200);
  assert.equal((await presence('bob')).status,403);
  assert.equal((await presence('alice',{unexpected:{booleanValue:true}})).status,403);
  await db.doc('userPresence/alice').delete();
});
