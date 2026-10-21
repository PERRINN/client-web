import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { BehaviorSubject, Subject } from 'rxjs';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { data, load, recordings, markers } from './load.mjs';
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
  const batch = db.batch(); old.docs.forEach(doc => batch.delete(doc.ref)); batch.delete(db.doc('GreenpowerTelemetry/424/days/2026-10-18')); batch.delete(db.doc('GreenpowerTelemetry/424/days/2026-10-18/live/latest')); await batch.commit();
  for (let i = 0; i < 34; i++) await storeSample(db, validatePayload(JSON.stringify({ Vt: 24, unknown: [[i]], status: 'synthetic' })), at + i, `seq-${i}`, () => admin.firestore.FieldValue.serverTimestamp());
  // Small concurrency: exercise transaction contention without an unbounded retry loop.
  await Promise.all([0, 1].map(i => storeSample(db, '{"A":30}', at + 100 + i, `parallel-${i}`)));
  const day = await db.doc('GreenpowerTelemetry/424/days/2026-10-18').get();
  assert.equal((await day.ref.collection('live').doc('latest').get()).data().count, 36);
  const chunks = await day.ref.collection('chunks').orderBy(admin.firestore.FieldPath.documentId()).limit(100).get();
  assert.equal(chunks.size, 2);
  assert.equal(chunks.docs.flatMap(doc => doc.data().samples).length, 36);
  assert.ok(day.data().updatedAt.toMillis() > 0);
});
test('anonymous telemetry reads/listing are denied; two signed-in users can read; all client writes are denied', async () => {
  const day = 'GreenpowerTelemetry/424/days/2026-10-18';
  for (const path of [day, `${day}/live/latest`, `${day}/chunks/0000000000`, 'GreenpowerTelemetry/424/days', `${day}/chunks`]) {
    assert.equal((await request(path)).status, 403, path);
    for (const uid of ['alice', 'bob']) assert.equal((await request(path, uid)).status, 200, `${uid}: ${path}`);
  }
  for (const uid of [undefined, 'alice', 'bob']) for (const path of [day, `${day}/live/latest`, `${day}/chunks/0000000000`, 'GreenpowerTelemetry/424']) {
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
    'firebase/compat/app': { default: firebase }, 'firebase/compat/firestore': {}, rxjs: { Subject }, './greenpowerMarkers': markers, './greenpowerData': data, './greenpowerRecording': recordings
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
    const before = (await dayRef.collection('live').doc('latest').get()).data()?.count || 0;
    for (const method of ['POST', 'GET']) {
      const { stdout } = await promisify(execFile)(process.execPath, [new URL('./send.mjs', import.meta.url).pathname], {
        env: { ...process.env, GREENPOWER_TEST_URL: `http://127.0.0.1:${server.address().port}/`, GREENPOWER_TELEMETRY_PASSWORD: password, GREENPOWER_TEST_METHOD: method, GREENPOWER_TEST_COUNT: '1' }, timeout: 20000
      });
      assert.equal(JSON.parse(stdout).status, 204);
    }
    const after = (await dayRef.collection('live').doc('latest').get()).data();
    assert.equal(after.count - before, 2);
    assert.equal(JSON.parse(after.latest.raw).synthetic, true);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('shared view is signed-in readable and only exact admin claims can save valid revisioned settings', async () => {
  const path='GreenpowerTelemetry/424/config/view',ref=db.doc(path);
  await ref.delete();
  const fieldMap = value => ({mapValue:{fields:Object.fromEntries(Object.entries(value).map(([key,flag])=>[key,{booleanValue:flag}]))}});
  const fieldList = values => ({arrayValue:{values:values.map(value=>typeof value==='string'?{stringValue:value}:{integerValue:String(value)})}});
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
    fields(2,{scalarOrder:fieldList([])}),
    fields(2,{scalarOrder:fieldList(['unknown'])}),
    fields(2,{scalarOrder:fieldList(['["Vt"]:V','["Vt"]:V'])}),
    fields(2,{chartOrder:fieldList([4])}),
    fields(2,{chartOrder:fieldMap({bad:true})}),
    fields(2,{scalars:{arrayValue:{values:[]}}}),
    fields(2,{charts:fieldMap(Object.fromEntries(Array.from({length:513},(_,i)=>[String(i),true])))})
  ]) assert.equal((await commit('admin',{perrinnAdmin:true},updates)).status,403);
  assert.equal((await commit('admin',{perrinnAdmin:true},fields(2,{scalarOrder:fieldList(['["Vt"]:V']),chartOrder:fieldList(['["A"]:A'])}))).status,200);
  // An older client can still write the previous shape, and empty ordered sections are valid.
  assert.equal((await commit('admin',{perrinnAdmin:true},fields(3))).status,200);
  assert.equal((await commit('admin',{perrinnAdmin:true},fields(4,{scalars:fieldMap({}),charts:fieldMap({}),scalarOrder:fieldList([]),chartOrder:fieldList([])}))).status,200);
  assert.equal((await request(path,'admin','DELETE',undefined,{perrinnAdmin:true})).status,403);
  for(const target of ['GreenpowerTelemetry/424/config/other','GreenpowerTelemetry/other/config/view','GreenpowerTelemetry/424/days/2026-10-18']) {
    assert.equal((await commit('admin',{perrinnAdmin:true},fields(1),target)).status,403,'role grants no telemetry-data writes');
  }
  await ref.delete();
});

test('real admin saves are synchronized to another signed-in viewer without changing telemetry', async () => {
  const viewHelpers=load('../../src/app/greenpower-telemetry/greenpowerView.ts',{'./greenpowerMarkers':markers,'./greenpowerData':data});
  const {GreenpowerViewService}=load('../../src/app/greenpower-telemetry/greenpowerView.service.ts',{
    '@angular/core':{Injectable:()=>target=>target},'firebase/compat/app':{default:firebase},'firebase/compat/firestore':{},rxjs:{Subject},'./greenpowerMarkers':markers,'./greenpowerData':data,'./greenpowerView':viewHelpers,'./greenpowerDatasetTrack':load('../../src/app/greenpower-telemetry/greenpowerDatasetTrack.ts')
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
    editor.service.edit(channels);editor.service.toggle('scalars',channels[0].id,false);editor.service.setMarker(data.POWER,{enabled:true,value:510});await editor.service.save();
    assert.equal(editor.service.error,'');
    await until(viewer.service,()=>viewer.service.scalars(channels).length===channels.length-1 && viewer.service.marker(data.POWER).value===510);
    assert.equal(viewer.service.canEdit,false);assert.equal(viewer.service.scalars(channels)[0].label,'Current');
    assert.equal(viewer.service.charts(channels).length,channels.length,'chart selection remains independent');
    // Re-enable the hidden scalar, then save different orders through a second real transaction.
    editor.service.edit(channels);editor.service.toggle('scalars',channels[0].id,true);
    const helperOrder=viewHelpers.orderFor(editor.service.draft,'scalars');
    editor.service.move('scalars',helperOrder[0],1);
    assert.notDeepEqual(editor.service.draft.scalarOrder,editor.service.draft.chartOrder,'two sections can have different orders');
    const expected=viewHelpers.copySelection(editor.service.draft);
    await editor.service.save();assert.equal(editor.service.error,'');
    await until(viewer.service,()=>viewer.service.scalars(channels).length===channels.length && viewer.service.scalars(channels)[0].id===expected.scalarOrder[0]);
    assert.deepEqual(viewer.service.scalars(channels).map(c=>c.id),expected.scalarOrder);
    assert.deepEqual(viewer.service.charts(channels).map(c=>c.id),expected.chartOrder);
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

test('reusable tracks enforce admin ownership, bounded coverage, exact shape and sequential revisions', async () => {
  const path='GreenpowerTelemetry/424/tracks/test-circuit';
  await db.doc(path).delete();
  const value = item => item === null ? {nullValue:null} : typeof item==='number' ? (Number.isInteger(item)?{integerValue:String(item)}:{doubleValue:item})
    : typeof item==='string' ? {stringValue:item} : Array.isArray(item) ? {arrayValue:{values:item.map(value)}} : {mapValue:{fields:Object.fromEntries(Object.entries(item).map(([key,child])=>[key,value(child)]))}};
  const line={a:{lat:50,lon:-1.0001},b:{lat:50,lon:-.9999},direction:1};
  const bounds={south:49.99,north:50.01,west:-1.01,east:-.99};
  const cells=['999:-21','999:-20','1000:-21','1000:-20'];
  async function save(uid,claims,revision=1,extra={},target=path) {
    const fields={name:value('Test circuit'),line:value(line),bounds:value(bounds),cells:value(cells),revision:{integerValue:String(revision)},updatedBy:{stringValue:uid||'admin'},...extra};
    return fetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents:commit`,{
      method:'POST',headers:{'Content-Type':'application/json',...(uid?{Authorization:`Bearer ${token(uid,claims)}`}:{})},
      body:JSON.stringify({writes:[{update:{name:`projects/${projectId}/databases/(default)/documents/${target}`,fields},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}]})
    });
  }
  for(const [uid,claims] of [[undefined,{}],['alice',{}],['admin',{perrinnAdmin:'true'}]]) assert.equal((await save(uid,claims)).status,403);
  assert.equal((await save('admin',{perrinnAdmin:true})).status,200);
  assert.equal((await request(path)).status,403);
  for(const uid of ['alice','bob']) assert.equal((await request(path,uid)).status,200);
  assert.equal((await save('admin',{perrinnAdmin:true})).status,403);
  for(const extra of [
    {line:value({...line,a:{lat:91,lon:0}})}, {line:value({...line,direction:0})},
    {line:value({...line,b:line.a})}, {line:value({...line,extra:1})},
    {updatedBy:value('someone-else')}, {extra:value('unexpected')}, {revision:value(2.5)},
    {bounds:value({...bounds,south:51})}, {cells:value([])}, {cells:value(Array.from({length:65},(_,i)=>String(i)))},
    {cells:value(['same','same'])}, {name:value('')}, {name:value('x'.repeat(61))},
    {line:value({...line,a:{lat:51,lon:0}})}
  ]) assert.equal((await save('admin',{perrinnAdmin:true},2,extra)).status,403);
  const query={structuredQuery:{from:[{collectionId:'tracks'}],where:{fieldFilter:{field:{fieldPath:'cells'},op:'ARRAY_CONTAINS',value:value('1000:-20')}},limit:6}};
  for(const uid of [undefined,'alice','bob']) {
    const response=await fetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents/GreenpowerTelemetry/424:runQuery`,{
      method:'POST',headers:{'Content-Type':'application/json',...(uid?{Authorization:`Bearer ${token(uid)}`}:{})},body:JSON.stringify(query)});
    assert.equal(response.status,uid?200:403);
    if(uid) assert.equal((await response.json()).filter(item=>item.document).length,1);
  }
  assert.equal((await save('admin',{perrinnAdmin:true},2,{line:value(null)})).status,200);
  assert.equal((await request(path,'admin','DELETE',undefined,{perrinnAdmin:true})).status,403);
  for(const target of ['GreenpowerTelemetry/424/days/2026-10-17','GreenpowerTelemetry/424/days/2026-10-17/config/laps','GreenpowerTelemetry/other/tracks/test-circuit']) {
    assert.equal((await save('admin',{perrinnAdmin:true},1,{},target)).status,403);
  }
  await db.doc(path).delete();
});

test('shared dataset selections are signed-in readable and accept only validated revisioned admin writes',async()=>{
  const path='GreenpowerTelemetry/424/days/2026-10-16/config/track',trackPath='GreenpowerTelemetry/424/tracks/selection-rule-fixture';
  await db.doc(path).delete();await db.doc(trackPath).set({name:'Synthetic rule fixture'});
  async function save(uid,claims,revision=1,extra={},target=path){
    const fields={trackId:{stringValue:'selection-rule-fixture'},revision:{integerValue:String(revision)},updatedBy:{stringValue:uid||'admin'},...extra};
    return fetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents:commit`,{method:'POST',headers:{'Content-Type':'application/json',...(uid?{Authorization:`Bearer ${token(uid,claims)}`}:{})},body:JSON.stringify({writes:[{update:{name:`projects/${projectId}/databases/(default)/documents/${target}`,fields},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}]})});
  }
  for(const [uid,claims] of [[undefined,{}],['alice',{}],['admin',{perrinnAdmin:'true'}]])assert.equal((await save(uid,claims)).status,403);
  assert.equal((await save('admin',{perrinnAdmin:true})).status,200);
  assert.equal((await request(path)).status,403);
  for(const uid of ['alice','bob'])assert.equal((await request(path,uid)).status,200);
  assert.equal((await save('admin',{perrinnAdmin:true})).status,403);
  for(const extra of [{trackId:{stringValue:'missing'}},{trackId:{stringValue:'bad/path'}},{trackId:{integerValue:'2'}},{updatedBy:{stringValue:'someone-else'}},{extra:{booleanValue:true}},{revision:{doubleValue:2.5}}]){
    assert.equal((await save('admin',{perrinnAdmin:true},2,extra)).status,403);
  }
  assert.equal((await save('admin',{perrinnAdmin:true},2,{trackId:{nullValue:null}})).status,200);
  assert.equal((await request(path,'admin','DELETE',undefined,{perrinnAdmin:true})).status,403);
  assert.equal((await save('admin',{perrinnAdmin:true},1,{},'GreenpowerTelemetry/424/days/invalid/config/track')).status,403);
  await db.doc(path).delete();await db.doc(trackPath).delete();
});

test('Edit Save atomically publishes the dataset choice to another real signed-in viewer; Automatic clears it',async()=>{
  const gps=load('../../src/app/greenpower-telemetry/greenpowerGps.ts',{'./greenpowerData':data});
  const tracks=load('../../src/app/greenpower-telemetry/greenpowerTracks.ts',{'./greenpowerGps':gps});
  const datasetTrack=load('../../src/app/greenpower-telemetry/greenpowerDatasetTrack.ts');
  const viewHelpers=load('../../src/app/greenpower-telemetry/greenpowerView.ts',{'./greenpowerMarkers':markers,'./greenpowerData':data});
  const imports={'@angular/core':{Injectable:()=>target=>target},'firebase/compat/app':{default:firebase},'firebase/compat/firestore':{},rxjs:{Subject},'./greenpowerGps':gps,'./greenpowerTracks':tracks,'./greenpowerDatasetTrack':datasetTrack,'./greenpowerMarkers':markers,'./greenpowerData':data,'./greenpowerView':viewHelpers};
  const {GreenpowerLapService}=load('../../src/app/greenpower-telemetry/greenpowerLap.service.ts',imports);
  const {GreenpowerViewService}=load('../../src/app/greenpower-telemetry/greenpowerView.service.ts',imports);
  const channels=data.channelsFor(Array.from({length:10},(_,i)=>({id:String(i),receivedAt:i*3000,source:'demo',raw:JSON.stringify({Lat:50+i*.00001,Lon:0,A:25,Spd:10})})));
  const line={a:{lat:50,lon:-.0001},b:{lat:50,lon:.0001},direction:1};
  const definition={name:'Synthetic shared track',line,...tracks.trackCoverage(gps.gpsFixes(channels),line),revision:1,updatedBy:'admin'};
  const day='2026-10-15',selection=db.doc(datasetTrack.datasetTrackPath(day)),viewRef=db.doc(viewHelpers.VIEW_PATH);
  const trackRefs=['shared-a','shared-b'].map(id=>db.doc(tracks.TRACKS_PATH+'/'+id));
  await selection.delete();await viewRef.delete();await Promise.all(trackRefs.map(ref=>ref.set(definition)));
  const apps=[],clients=[],services=[];
  const until=(service,predicate)=>new Promise((resolve,reject)=>{if(predicate())return resolve();const timer=setTimeout(()=>{sub.unsubscribe();reject(Error('Shared dataset state timed out'));},10000);const sub=service.changed.subscribe(()=>{if(predicate()){clearTimeout(timer);sub.unsubscribe();resolve();}});});
  function connect(uid,isAdmin){
    const app=firebase.initializeApp({projectId,apiKey:'demo-key'},`dataset-${uid}-${process.pid}`);apps.push(app);
    const client=app.firestore();clients.push(client);const [hostname,port]=host.split(':');client.useEmulator(hostname,Number(port),{mockUserToken:{sub:uid,user_id:uid,...(isAdmin?{perrinnAdmin:true}:{})}});
    const state=new BehaviorSubject({uid,isAdmin,ready:true}),permissions={state,get current(){return state.value;}};
    const laps=new GreenpowerLapService(permissions,{firestore:client});services.push(laps);
    laps.changed.subscribe(()=>laps.update(channels,27000));laps.select(day+':true');laps.update(channels,27000);
    return {laps,permissions,client};
  }
  try{
    const editor=connect('dataset-editor',true),viewer=connect('dataset-viewer',false);
    const view=new GreenpowerViewService(editor.permissions,{firestore:editor.client});services.push(view);
    await Promise.all([until(view,()=>view.ready),until(editor.laps,()=>editor.laps.ready&&!editor.laps.searching&&editor.laps.candidates.length===2),until(viewer.laps,()=>viewer.laps.ready&&!viewer.laps.searching&&viewer.laps.candidates.length===2)]);
    editor.laps.syncEditing(true);editor.laps.choose('shared-b');await until(editor.laps,()=>editor.laps.ready);
    assert.equal(viewer.laps.selectedId,'','draft choice remains local');
    view.edit(channels);await view.save(editor.laps.selectionWrite());editor.laps.syncEditing(false);assert.equal(view.error,'');
    await until(viewer.laps,()=>viewer.laps.selectedId==='shared-b'&&viewer.laps.ready);
    assert.equal((await selection.get()).data().trackId,'shared-b');assert.equal((await viewRef.get()).data().revision,1);
    viewer.laps.select(day+':false');await until(viewer.laps,()=>viewer.laps.selectedId==='shared-b'&&viewer.laps.ready);
    editor.laps.syncEditing(true);editor.laps.choose('');await until(editor.laps,()=>!editor.laps.searching);
    view.edit(channels);await view.save(editor.laps.selectionWrite());editor.laps.syncEditing(false);assert.equal(view.error,'');
    await until(viewer.laps,()=>viewer.laps.selectedId===''&&viewer.laps.selectionReady);
    assert.equal((await selection.get()).data().trackId,null);assert.equal((await selection.get()).data().revision,2);
  }finally{
    services.forEach(service=>service.ngOnDestroy());await Promise.all(clients.map(client=>client.terminate()));await Promise.all(apps.map(app=>app.delete()));
    await selection.delete();await viewRef.delete();await Promise.all(trackRefs.map(ref=>ref.delete()));
  }
});

test('name-only tracks retain admin-only writes and reject partial or inconsistent geometry', async () => {
  const path = 'GreenpowerTelemetry/424/tracks/name-only';
  await db.doc(path).delete();
  const value = x => x === null ? { nullValue: null } : typeof x === 'string' ? { stringValue: x } : typeof x === 'number' ? { integerValue: String(x) } : { arrayValue: { values: [] } };
  const save = (uid, claims, extra = {}) => fetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents:commit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${token(uid, claims)}` } : {}) },
    body: JSON.stringify({ writes: [{ update: { name: `projects/${projectId}/databases/(default)/documents/${path}`,
      fields: { name: value('Workshop'), bounds: value(null), line: value(null), cells: value([]), revision: value(1), updatedBy: value(uid || 'admin'), ...extra } },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] }] }) });
  for (const [uid, claims] of [[undefined, {}], ['alice', {}], ['admin', { perrinnAdmin: 'true' }]]) assert.equal((await save(uid, claims)).status, 403);
  assert.equal((await save('admin', { perrinnAdmin: true }, { cells: { arrayValue: { values: [value('unexpected')] } } })).status, 403);
  assert.equal((await save('admin', { perrinnAdmin: true })).status, 200);
  for (const uid of ['alice', 'bob']) assert.equal((await request(path, uid)).status, 200);
  assert.equal((await request(path)).status, 403);
  await db.doc(path).delete();
});

test('marker settings stay shared, admin-only, bounded and protected from legacy overwrites', async () => {
  const path = 'GreenpowerTelemetry/424/config/view', ref = db.doc(path);
  await ref.delete();
  const encode = value => value === null ? {nullValue:null}
    : typeof value === 'boolean' ? {booleanValue:value}
    : typeof value === 'number' ? Number.isSafeInteger(value) ? {integerValue:String(value)} : {doubleValue:value}
    : typeof value === 'string' ? {stringValue:value}
    : {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([key,item])=>[key,encode(item)]))}};
  const write = async (uid, claims, revision, markers, includeMarkers = true) => fetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents:commit`, {
    method:'POST',headers:{'Content-Type':'application/json',...(uid?{Authorization:`Bearer ${token(uid,claims)}`}:{})},
    body:JSON.stringify({writes:[{update:{name:`projects/${projectId}/databases/(default)/documents/${path}`,fields:
      Object.fromEntries(Object.entries({scalars:{},charts:{},revision,updatedBy:uid || 'admin',...(includeMarkers?{markers}:{})}).map(([key,value])=>[key,encode(value)]))},
      updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}]})
  });
  const settings = {[data.POWER]:{enabled:true,value:525}};
  for(const [uid,claims] of [[undefined,{}],['viewer',{}],['admin',{perrinnAdmin:'true'}]]) {
    assert.equal((await write(uid,claims,1,settings)).status,403);
  }
  const adminClaims={perrinnAdmin:true};
  assert.equal((await write('admin',adminClaims,1,settings)).status,200);
  assert.equal((await request(path)).status,403);
  for(const uid of ['alice','bob']) {
    const response=await request(path,uid);assert.equal(response.status,200);
    assert.equal((await response.json()).fields.markers.mapValue.fields[data.POWER].mapValue.fields.value.integerValue,'525');
    assert.equal((await write(uid,{},2,settings)).status,403);
  }
  assert.equal((await write('admin',adminClaims,2,{},false)).status,403,'older clients cannot erase markers by omitting the field');
  assert.equal((await write('admin',adminClaims,2,'invalid')).status,403);
  assert.equal((await write('admin',adminClaims,2,Object.fromEntries(Array.from({length:513},(_,i)=>[i,{enabled:false,value:0}])))).status,403);
  assert.equal((await write('admin',adminClaims,2,{[data.POWER]:{enabled:false,value:525}})).status,200);
  assert.equal((await write('admin',adminClaims,2,settings)).status,403,'stale revisions cannot undo a marker edit');
  await ref.delete();
});
