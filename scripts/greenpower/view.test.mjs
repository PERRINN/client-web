import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BehaviorSubject, Subject, combineLatest } from 'rxjs';
import { data, load, sample } from './load.mjs';
import { setAdminRole } from '../admin/set-admin-role.mjs';
const datasetTrack=load('../../src/app/greenpower-telemetry/greenpowerDatasetTrack.ts');
const angular = { Injectable: () => target => target, runInInjectionContext: (_, callback) => callback() };
const view = load('../../src/app/greenpower-telemetry/greenpowerView.ts', { './greenpowerData': data });
const { PermissionsService } = load('../../src/app/permissions.service.ts', { '@angular/core': angular, rxjs: { BehaviorSubject, combineLatest } });
const { GreenpowerViewService } = load('../../src/app/greenpower-telemetry/greenpowerView.service.ts', {
  '@angular/core': angular, rxjs: { Subject }, 'firebase/compat/app': { default: { firestore: { FieldValue: {serverTimestamp:()=> 'server-time'} } } },
  'firebase/compat/firestore': {}, './greenpowerView': view, './greenpowerData': data, './greenpowerDatasetTrack': datasetTrack
});
const channels = data.channelsFor([sample(0), sample(1)]);
const saved = { ...view.selectionFor(channels), revision: 1, updatedBy: 'admin' };

test('admin permissions require an exact true claim belonging to the real signed-in account', () => {
  const authState = new Subject(), idTokenResult = new Subject();
  const permissions = new PermissionsService({ authState, idTokenResult }, {});
  authState.next({uid:'alice'}); idTokenResult.next({claims:{sub:'alice',perrinnAdmin:'true'}});
  assert.equal(permissions.current.isAdmin,false);
  idTokenResult.next({claims:{sub:'alice',perrinnAdmin:true}}); assert.equal(permissions.current.isAdmin,true);
  authState.next({uid:'bob'}); assert.equal(permissions.current.isAdmin,false); assert.equal(permissions.current.ready,false);
  idTokenResult.next({claims:{sub:'bob'}}); assert.equal(permissions.current.ready,true); assert.equal(permissions.current.isAdmin,false);
  authState.next(null); assert.deepEqual(permissions.current,{uid:'',isAdmin:false,ready:true});
  permissions.ngOnDestroy();
});
test('operator role assignment preserves unrelated claims and supports revocation', async () => {
  let customClaims={billing:true,feature:'a'};
  const auth={getUser:async()=>({customClaims}),setCustomUserClaims:async(uid,claims)=>{assert.equal(uid,'admin');customClaims=claims;}};
  await setAdminRole(auth,'admin',true); assert.deepEqual(customClaims,{billing:true,feature:'a',perrinnAdmin:true});
  await setAdminRole(auth,'admin',false); assert.deepEqual(customClaims,{billing:true,feature:'a'});
});
test('selection validates channel bounds, keeps scalar/chart choices independent, and labels absent channels', () => {
  const selection=view.selectionFor(channels);
  assert.equal(Object.keys(selection.scalars).length,9); assert.equal(Object.keys(selection.charts).length,8);
  const id=channels[0].id; delete selection.scalars[id];
  assert.ok(!view.selectedChannels(channels,selection.scalars).some(c=>c.id===id));
  assert.ok(view.selectedChannels(channels,selection.charts).some(c=>c.id===id));
  const absent=view.selectedChannels([],selection.charts);
  assert.ok(absent.every(c=>c.value==='—' && !c.points.length));
  assert.ok(absent.some(c=>c.label==='Total voltage'));
  assert.equal(view.validSelection(selection),true);
  assert.equal(view.validSelection({scalars:[],charts:{}}),false);
  assert.equal(view.validSelection({scalars:{a:false},charts:{}}),false);
  assert.equal(view.validSelection({scalars:Object.fromEntries(Array.from({length:513},(_,i)=>[i,true])),charts:{}}),false);
  assert.equal(view.validSelection({scalars:{['x'.repeat(1501)]:true},charts:{}}),false);
  assert.deepEqual(data.channelDetails('["key]:value"]:a:b'),{label:'key]:value',unit:'a:b'});
});
function harness() {
  const state=new BehaviorSubject({uid:'',isAdmin:false,ready:true});
  const permissions={state,get current(){return state.value;}};
  let record, trackRecord, attempts=0, blocked, writes=0;
  const listeners=[];
  const ref={firestore:{async runTransaction(callback,options){assert.equal(options,undefined);attempts++;await callback({get:async target=>{if(blocked) await blocked;return {data:()=>target?.path?trackRecord:record};},set:(target,value)=>{if(target?.path)trackRecord=value;else record=value;writes++;}});}},
    onSnapshot(options,next,error){assert.equal(options.includeMetadataChanges,true);const l={next,error,active:true};listeners.push(l);return()=>l.active=false;}};
  ref.firestore.doc=path=>({path});
  const service=new GreenpowerViewService(permissions,{firestore:{doc:path=>{assert.equal(path,view.VIEW_PATH);return ref;}}});
  return {service,state,listeners,get trackRecord(){return trackRecord;},set trackRecord(value){trackRecord=value;},get record(){return record;},set record(value){record=value;},get writes(){return writes;},get attempts(){return attempts;},block(value){blocked=value;},
    signIn(admin=true,uid='admin'){state.next({uid,isAdmin:admin,ready:true});},
    emit(value,metadata={fromCache:false,hasPendingWrites:false}){record=value;listeners.at(-1).next({metadata,exists:!!value,data:()=>value});}};
}
test('view uses one document listener per account, ignores cache, and clears on logout', () => {
  const h=harness(); assert.equal(h.listeners.length,0);
  h.signIn(); h.emit(saved,{fromCache:true,hasPendingWrites:false}); assert.equal(h.service.ready,false);
  h.emit(saved); assert.equal(h.service.canEdit,true);
  h.state.next({uid:'admin',isAdmin:true,ready:true}); assert.equal(h.listeners.length,1);
  h.service.edit(channels);h.signIn(false);assert.equal(h.service.editing,false);assert.equal(h.service.canEdit,false);
  h.state.next({uid:'',isAdmin:false,ready:true});assert.equal(h.listeners[0].active,false);assert.deepEqual(h.service.scalars(channels),[]);
  h.listeners[0].next({metadata:{fromCache:false},exists:true,data:()=>saved});assert.equal(h.service.ready,false);
  h.service.ngOnDestroy();
});
test('default view shows loaded channels; save is one bounded transaction and viewer updates from server', async () => {
  const h=harness();h.signIn();h.emit(undefined);
  assert.equal(h.service.scalars(channels).length,9);
  h.service.edit(channels);const id=channels[0].id;h.service.toggle('scalars',id,false);
  assert.equal(h.service.scalars(channels).length,9,'draft stays private until saved');
  await h.service.save(); assert.equal(h.attempts,1);assert.equal(h.writes,1);assert.equal(h.record.revision,1);
  assert.equal(h.record.updatedAt,'server-time');assert.equal(h.record.updatedBy,'admin');
  assert.equal(h.service.editing,false);
  h.emit(h.record);assert.equal(h.service.scalars(channels).length,8);
  assert.ok(h.service.charts(channels).some(c=>c.id===id));
  h.service.ngOnDestroy();
});
test('cancel, unauthorized saves, conflicts and listener errors leave saved settings intact', async () => {
  const h=harness();h.signIn();h.emit(saved);h.service.edit(channels);h.service.toggle('scalars',channels[0].id,false);h.service.cancel();
  await h.service.save();assert.equal(h.writes,0);
  h.service.edit(channels);h.emit({...saved,revision:2});await h.service.save();assert.match(h.service.error,/changed elsewhere/);assert.equal(h.writes,0);assert.equal(h.service.editing,true);
  h.signIn(false);await h.service.save();assert.equal(h.writes,0);
  h.listeners.at(-1).error();assert.equal(h.service.ready,false);assert.match(h.service.error,/Could not load/);
  h.service.retry();assert.equal(h.listeners.length,2);assert.equal(h.listeners[0].active,false);
  h.emit({scalars:[]});assert.equal(h.service.ready,false);assert.match(h.service.error,/invalid/);
  h.service.ngOnDestroy();assert.equal(h.listeners.at(-1).active,false);
});
test('sign-out while save is waiting for a read cannot write stale account settings', async () => {
  const h=harness();h.signIn();h.emit(saved);h.service.edit(channels);
  let release;h.block(new Promise(resolve=>release=resolve));
  const pending=h.service.save();h.state.next({uid:'',isAdmin:false,ready:true});release();await pending;
  assert.equal(h.writes,0);assert.equal(h.service.editing,false);h.service.ngOnDestroy();
});

test('save bounds database reads to three attempts and rejects duplicate clicks', async () => {
  const h=harness();h.signIn();h.emit(saved);h.service.edit(channels);
  let reads=0;
  h.service.ref.firestore.runTransaction=async callback=>{
    for(let attempt=0;attempt<5;attempt++) await callback({get:async()=>{reads++;return {data:()=>saved};},set(){}});
  };
  await h.service.save();assert.equal(reads,3);assert.match(h.service.error,/Could not save/);
  h.service.ref.firestore.runTransaction=async()=>new Promise(resolve=>setTimeout(resolve,20));
  const first=h.service.save();assert.equal(h.service.saving,true);await h.service.save();await first;
  h.service.ngOnDestroy();
});

test('legacy views retain their order; explicit scalar and chart orders are independent', () => {
  const legacy={...saved};
  assert.equal(view.validView(legacy),true);
  const prior=view.selectedChannels(channels,legacy.scalars).map(c=>c.id);
  const copy=view.copySelection(legacy);
  assert.deepEqual(copy.scalarOrder,prior);
  copy.scalarOrder.reverse();
  assert.deepEqual(view.selectedChannels(channels,copy.scalars,copy.scalarOrder).map(c=>c.id),prior.slice().reverse());
  assert.deepEqual(copy.chartOrder,Object.keys(legacy.charts).sort());
  assert.deepEqual(view.selectedChannels([],copy.scalars,copy.scalarOrder).map(c=>c.id),copy.scalarOrder,'missing historical channels retain their slots');
  for(const invalid of [[...prior,prior[0]],prior.slice(1),[...prior.slice(1),'unknown'],[...prior.slice(1),5],null]) {
    assert.equal(view.validSelection({...copy,scalarOrder:invalid}),false);
  }
  assert.equal(view.validSelection({scalars:{},charts:{},scalarOrder:[],chartOrder:[]}),true);
});
test('ordering is draft-only, bounded at each end, cancelable, and saved for every viewer', async () => {
  const h=harness();h.signIn();h.emit(saved);h.service.edit(channels);
  const original=h.service.scalars(channels).map(c=>c.id);
  const chartOrder=view.configurableCharts(h.service.charts(channels)).map(c=>c.id);
  const first=original[0],second=original[1];
  h.service.move('scalars',first,-1);assert.deepEqual(h.service.draft.scalarOrder,original);
  h.service.move('scalars',first,1);assert.deepEqual(h.service.draft.scalarOrder.slice(0,2),[second,first]);
  assert.deepEqual(h.service.draft.chartOrder,chartOrder);
  assert.deepEqual(h.service.scalars(channels).map(c=>c.id),original,'draft order is private');
  h.service.cancel();h.service.edit(channels);assert.deepEqual(h.service.draft.scalarOrder,original);
  h.service.move('scalars',first,1);h.service.move('charts',chartOrder[0],1);
  const draft=view.copySelection(h.service.draft);await h.service.save();h.emit(h.record);
  h.signIn(false);
  assert.deepEqual(h.service.scalars(channels).map(c=>c.id),draft.scalarOrder);
  assert.deepEqual(view.configurableCharts(h.service.charts(channels)).map(c=>c.id),draft.chartOrder);
  h.service.move('scalars',first,-1);assert.deepEqual(h.record.scalarOrder,draft.scalarOrder);
  h.service.ngOnDestroy();
});
test('removing and re-adding channels maintains a complete order and appends new choices', () => {
  const h=harness();h.signIn();h.emit(saved);h.service.edit(channels);
  const id=h.service.draft.scalarOrder[0];
  h.service.toggle('scalars',id,false);
  assert.ok(!h.service.draft.scalarOrder.includes(id));assert.equal(view.validSelection(h.service.draft),true);
  h.service.move('scalars',id,1);assert.ok(!h.service.draft.scalarOrder.includes(id));
  h.service.toggle('scalars',id,true);
  assert.equal(h.service.draft.scalarOrder.at(-1),id);assert.equal(view.validSelection(h.service.draft),true);
  h.service.ngOnDestroy();
});

test('immediately reopening after a committed save uses its revision without waiting for a listener', async () => {
  const h=harness();h.signIn();h.emit(saved);h.service.edit(channels);
  h.service.move('scalars',h.service.draft.scalarOrder[0],1);
  await h.service.save();assert.equal(h.record.revision,2);
  const confirmed=view.copySelection(h.record);
  h.emit(saved); // An older listener event cannot regress a confirmed commit.
  assert.deepEqual(h.service.scalars(channels).map(c=>c.id),confirmed.scalarOrder);
  h.record={...confirmed,revision:2,updatedBy:'admin'};
  h.service.edit(channels);await h.service.save();assert.equal(h.record.revision,3);assert.equal(h.service.error,'');
  h.service.ngOnDestroy();
});

test('drag sorting moves directly to a target and restores only a valid selected-channel order', () => {
  const h=harness();h.signIn();h.emit(saved);h.service.edit(channels);
  const original=h.service.draft.scalarOrder.slice(),charts=h.service.draft.chartOrder.slice();
  h.service.reorder('scalars',original[0],original.length-1);
  assert.equal(h.service.draft.scalarOrder.at(-1),original[0]);assert.deepEqual(h.service.draft.chartOrder,charts);
  h.service.restoreOrder('scalars',['unknown']);assert.equal(h.service.draft.scalarOrder.at(-1),original[0]);
  h.service.restoreOrder('scalars',original);assert.deepEqual(h.service.draft.scalarOrder,original);
  h.service.reorder('scalars',original[0],-1);h.service.reorder('scalars',original[0],NaN);assert.deepEqual(h.service.draft.scalarOrder,original);
  h.service.ngOnDestroy();
});

test('view and dataset choice commit together and acknowledge before closing Edit',async()=>{
  const h=harness();h.signIn();h.emit(saved);h.service.edit(channels);let acknowledged=false;
  const change={day:'2026-10-19',trackId:'circuit',revision:0,current:()=>true,acknowledged:()=>{assert.equal(h.service.editing,true);acknowledged=true;}};
  await h.service.save(change);assert.equal(h.writes,2);assert.equal(acknowledged,true);assert.equal(h.record.revision,2);
  assert.deepEqual(h.trackRecord,{trackId:'circuit',revision:1,updatedBy:'admin',updatedAt:'server-time'});assert.equal(h.service.editing,false);h.service.ngOnDestroy();
});
test('stale dataset revisions, invalid IDs and changed contexts cannot partially save the view',async()=>{
  const h=harness();h.signIn();h.emit(saved);h.service.edit(channels);h.trackRecord={trackId:'another',revision:2};
  const change={day:'2026-10-19',trackId:'circuit',revision:0,current:()=>true,acknowledged:()=>assert.fail('must not acknowledge')};
  await h.service.save(change);assert.equal(h.writes,0);assert.equal(h.service.editing,true);assert.match(h.service.error,/changed elsewhere/);
  await h.service.save({...change,trackId:'bad/path'});assert.equal(h.writes,0);
  await h.service.save({...change,current:()=>false});assert.equal(h.writes,0);h.service.ngOnDestroy();
});

test('a dataset switch after commit cannot acknowledge or close the new editor context',async()=>{
  const h=harness();h.signIn();h.emit(saved);h.service.edit(channels);let current=true,acknowledged=false;
  const run=h.service.ref.firestore.runTransaction.bind(h.service.ref.firestore);
  h.service.ref.firestore.runTransaction=async callback=>{await run(callback);current=false;};
  await h.service.save({day:'2026-10-19',trackId:'circuit',revision:0,current:()=>current,acknowledged:()=>acknowledged=true});
  assert.equal(h.writes,2);assert.equal(acknowledged,false);assert.equal(h.service.editing,true);h.service.ngOnDestroy();
});
test('combined view/track Save retries are bounded to six client document reads',async()=>{
  const h=harness();h.signIn();h.emit(saved);h.service.edit(channels);let reads=0;
  h.service.ref.firestore.runTransaction=async callback=>{for(let i=0;i<5;i++)await callback({get:async target=>{reads++;return {data:()=>target?.path?undefined:saved};},set(){}});};
  await h.service.save({day:'2026-10-19',trackId:null,revision:0,current:()=>true,acknowledged:()=>assert.fail('failed save acknowledged')});
  assert.equal(reads,6);assert.equal(h.service.editing,true);h.service.ngOnDestroy();
});

test('voltage charts respect shared visibility with one left/right control', () => {
  const channels=data.channelsFor([{source:'424-phone',receivedAt:1,raw:'{"Vt":25,"V1":12}'}]);
  const plots=view.telemetryCharts(channels,channels);
  assert.equal(plots.filter(c=>c.id===data.VOLTAGE_LEFT).length,1);
  assert.equal(plots.filter(c=>c.id===data.VOLTAGE_DIFF).length,1);
  assert.equal(plots.filter(c=>c.id===data.VOLTAGE_RIGHT).length,0);
  assert.deepEqual(view.telemetryCharts(channels,[]).map(c=>c.id),[]);
  assert.equal(view.selectionFor(channels).charts[data.VOLTAGE_LEFT],true);
  assert.equal(view.selectionFor(channels).scalars[data.VOLTAGE_RIGHT],true);
  assert.deepEqual(view.telemetryCharts([],[]),[]);
});


test('all calculated channels remain selectable without samples, with combined chart controls', () => {
  const h=harness();h.signIn();h.emit({...saved,scalars:{},charts:{}});h.service.edit([]);
  const scalars=h.service.available([], 'scalars');
  assert.equal(data.COMPUTED_CHANNEL_IDS.length,12);
  for(const id of data.COMPUTED_CHANNEL_IDS) {
    const channel=scalars.find(c=>c.id===id);
    assert.ok(channel, id);assert.equal(channel.value,'—');assert.deepEqual(channel.points,[]);
    assert.deepEqual({label:channel.label,unit:channel.unit},data.channelDetails(id));
  }
  const charts=h.service.available([], 'charts');
  assert.equal(charts.find(c=>c.id===data.VOLTAGE_LEFT).label,'Voltage left / right');
  assert.equal(charts.find(c=>c.id===data.VEHICLE_SPEED).label,'Vehicle speed / Motor-derived speed');
  assert.ok(!charts.some(c=>c.id===data.MOTOR_DERIVED_SPEED||c.id===data.VOLTAGE_RIGHT));
  for(const id of data.COMPUTED_CHANNEL_IDS.filter(id=>id!==data.MOTOR_DERIVED_SPEED&&id!==data.VOLTAGE_RIGHT)) assert.ok(charts.some(c=>c.id===id),id);
  h.service.ngOnDestroy();
});

test('calculated selections save independently, retain missing slots and follow the shared order', async () => {
  const h=harness();h.signIn();h.emit({...saved,scalars:{},charts:{}});h.service.edit([]);
  const order=[...data.COMPUTED_CHANNEL_IDS].reverse();
  for(const id of order) h.service.toggle('scalars',id,true);
  for(const id of order.filter(id=>id!==data.MOTOR_DERIVED_SPEED&&id!==data.VOLTAGE_RIGHT)) h.service.toggle('charts',id,true);
  h.service.reorder('charts',data.POWER,0);
  const chartOrder=h.service.draft.chartOrder.slice();
  assert.deepEqual(h.service.charts([]),[],'draft is private');
  await h.service.save();assert.equal(h.writes,1);assert.equal(h.attempts,1);
  h.emit(h.record);h.signIn(false);
  assert.deepEqual(h.service.scalars([]).map(c=>c.id),order);
  assert.deepEqual(h.service.charts([]),[],'no empty graphs');
  const loaded=order.map((id,i)=>({id,...data.channelDetails(id),value:String(i),points:[{time:1000,value:i}]}));
  assert.deepEqual(h.service.charts(loaded).map(c=>c.id),chartOrder);
  assert.deepEqual(h.service.scalars(loaded).map(c=>c.value),loaded.map(c=>c.value));
  h.signIn();h.service.edit(loaded);
  h.service.toggle('charts',data.POWER,false);h.service.toggle('scalars',data.ENERGY,false);
  await h.service.save();h.emit(h.record);
  assert.ok(!h.service.charts(loaded).some(c=>c.id===data.POWER));
  assert.ok(h.service.scalars(loaded).some(c=>c.id===data.POWER));
  assert.ok(h.service.charts(loaded).some(c=>c.id===data.ENERGY));
  assert.ok(!h.service.scalars(loaded).some(c=>c.id===data.ENERGY));
  h.service.ngOnDestroy();
});
