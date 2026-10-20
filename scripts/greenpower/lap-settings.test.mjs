import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BehaviorSubject, Subject } from 'rxjs';
import { data, load } from './load.mjs';
const datasetTrack=load('../../src/app/greenpower-telemetry/greenpowerDatasetTrack.ts');
const gps=load('../../src/app/greenpower-telemetry/greenpowerGps.ts',{'./greenpowerData':data});
const tracks=load('../../src/app/greenpower-telemetry/greenpowerTracks.ts',{'./greenpowerGps':gps});
const {GreenpowerLapService}=load('../../src/app/greenpower-telemetry/greenpowerLap.service.ts',{
  '@angular/core':{Injectable:()=>target=>target},rxjs:{Subject},'firebase/compat/app':{default:{firestore:{FieldValue:{serverTimestamp:()=> 'server-time'}}}},
  'firebase/compat/firestore':{},'./greenpowerGps':gps,'./greenpowerTracks':tracks,'./greenpowerDatasetTrack':datasetTrack
});
const fixes=Array.from({length:10},(_,i)=>({time:i*3000,lat:50+i*.00001,lon:0}));
const channels=[{id:'["Lat"]:°',points:fixes.map(f=>({time:f.time,value:f.lat}))},{id:'["Lon"]:°',points:fixes.map(f=>({time:f.time,value:f.lon}))}];
const line={a:{lat:50,lon:-.0001},b:{lat:50,lon:.0001},direction:1};
const track={name:'Circuit',line,...tracks.trackCoverage(fixes,line),revision:1,updatedBy:'admin'};
const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
function harness(initial=[{id:'circuit',...track}],initialSelection){
  const state=new BehaviorSubject({ready:true,uid:'',isAdmin:false});
  const permissions={state,get current(){return state.value;}};
  const records=new Map(initial.map(({id,...value})=>[id,value]));
  const listeners=[];const selectionListeners=[];let sharedSelection=initialSelection;let writes=0,reads=0,queries=0,block,queryBlock;
  let results=initial;
  const db={async runTransaction(callback){await callback({get:async ref=>{reads++;if(block)await block;return {data:()=>records.get(ref.id)};},set:(ref,value)=>{writes++;records.set(ref.id,value);}});}};
  const refs=new Map();
  const collection={doc(id='new-track'){
    if(!refs.has(id))refs.set(id,{id,firestore:db,onSnapshot(options,next,error){const l={id,next,error,active:true};listeners.push(l);queueMicrotask(()=>{if(l.active)l.next({exists:records.has(id),data:()=>records.get(id),metadata:{fromCache:false,hasPendingWrites:false}});});return()=>l.active=false;}});
    return refs.get(id);
  },where(field,operator,cell){assert.equal(field,'cells');assert.equal(operator,'array-contains');assert.equal(cell,tracks.trackCell(fixes[1]));
    return {limit(n){assert.equal(n,6);let after=false;return {startAfter(){after=true;return this;},async get(options){assert.equal(options.source,'server');queries++;if(queryBlock)await queryBlock;
      const docs=(after?[]:results).map(({id,...value})=>({id,data:()=>value}));return {docs,size:docs.length};}};}};}};
  const service=new GreenpowerLapService(permissions,{firestore:{doc:path=>({onSnapshot(options,next,error){const l={next,error,active:true,path};selectionListeners.push(l);queueMicrotask(()=>{if(l.active)next({metadata:{fromCache:false,hasPendingWrites:false},exists:!!sharedSelection,data:()=>sharedSelection});});return()=>l.active=false;}}),collection:path=>{assert.equal(path,tracks.TRACKS_PATH);return collection;}}});
  service.changed.subscribe(()=>service.update(channels,27000));
  return {state,service,listeners,selectionListeners,records,refs,db,
    selection(value,metadata={fromCache:false,hasPendingWrites:false}){sharedSelection=value;const l=selectionListeners.at(-1);l.next({metadata,exists:!!value,data:()=>value});},get writes(){return writes;},get reads(){return reads;},get queries(){return queries;},
    results(value){results=value;},block(value){block=value;},queryBlock(value){queryBlock=value;},
    signIn(admin=true,uid='admin'){state.next({ready:true,uid,isAdmin:admin});},
    async open(dataset='2026-10-19:true'){service.select(dataset);service.update(channels,27000);await settle();},
    emit(value,metadata={fromCache:false,hasPendingWrites:false}){const l=listeners.at(-1);l.next({metadata,exists:!!value,data:()=>value});}};
}
test('one bounded lookup chooses a unique track and live updates never repeat it',async()=>{
  const h=harness();h.signIn();await h.open();assert.equal(h.queries,1);assert.equal(h.service.selectedId,'circuit');assert.equal(h.service.searching,false);
  assert.deepEqual(h.service.line,line);assert.equal(h.listeners.length,1);
  h.emit({...track,name:'Renamed circuit',revision:2});assert.equal(h.service.candidates[0].name,'Renamed circuit');
  for(let i=0;i<20;i++)h.service.update([...channels],27000);
  assert.equal(h.queries,1);assert.equal(h.listeners.length,1);
  await h.open('2026-10-18:false');assert.equal(h.queries,2);assert.equal(h.listeners[0].active,false);assert.equal(h.service.selectedId,'circuit');
  h.service.ngOnDestroy();assert.equal(h.listeners.at(-1).active,false);
});
test('overlaps, a full candidate page and nonmatching candidates require explicit selection',async()=>{
  for(const definitions of [[{id:'a',...track},{id:'b',...track}],Array.from({length:6},(_,i)=>({id:String(i),...track})),[{id:'disabled',...track,line:null}]]){
    const h=harness(definitions);h.signIn(false);await h.open();assert.equal(h.service.selectedId,'');assert.equal(h.service.ready,true);assert.equal(h.listeners.length,0);
    h.signIn();h.service.syncEditing(true);h.service.choose(definitions[0].id);await settle();assert.equal(h.service.selectedId,definitions[0].id);assert.equal(h.listeners.length,1);
    h.service.ngOnDestroy();
  }
});
test('candidate pagination only follows user actions; empty pages stop and query count stays bounded',async()=>{
  const h=harness(Array.from({length:6},(_,i)=>({id:String(i),...track})));h.signIn();await h.open();assert.equal(h.queries,1);assert.equal(h.service.hasMore,true);
  h.service.update([...channels],27000);assert.equal(h.queries,1);
  h.service.syncEditing(true);h.service.loadMore();await settle();assert.equal(h.queries,2);assert.equal(h.service.hasMore,false);h.service.loadMore();assert.equal(h.queries,2);h.service.ngOnDestroy();
});
test('GPS outside a selected track pauses analysis without looking up or switching lines',async()=>{
  const h=harness();h.signIn();await h.open();const moved=channels.map(c=>({...c,points:c.points.map(p=>({...p,value:p.value+1}))}));
  h.service.update(moved,27000);assert.equal(h.service.mismatch,true);assert.equal(h.service.selectedId,'circuit');assert.equal(h.queries,1);assert.equal(h.service.analysis.laps.length,0);h.service.ngOnDestroy();
});
test('new tracks are reusable, revisioned and admin-only; stale revisions and duplicate saves cannot write',async()=>{
  const h=harness([]);h.signIn(false);await h.open();assert.equal(await h.service.save(line,0,'Circuit'),false);
  h.signIn();assert.equal(await h.service.save(line,0,'Circuit'),true);assert.equal(h.records.get('new-track').revision,1);assert.equal(h.records.get('new-track').updatedAt,'server-time');
  assert.equal(h.service.selectedId,'new-track');assert.equal(h.listeners.length,1);
  assert.equal(await h.service.save(null,0,'Circuit'),false);assert.match(h.service.error,/changed elsewhere/);
  assert.equal(await h.service.save(null,1,'Circuit'),true);assert.equal(h.records.get('new-track').line,null);
  let release;h.block(new Promise(r=>release=r));const saving=h.service.save(line,2,'Circuit');assert.equal(await h.service.save(line,2,'Circuit'),false);release();await saving;
  assert.equal(h.writes,3);h.service.ngOnDestroy();
});
test('late queries and cached snapshots cannot expose old-account track settings',async()=>{
  const h=harness();h.signIn();let release;h.queryBlock(new Promise(r=>release=r));h.service.select('2026-10-19:true');h.service.update(channels,27000);await settle();
  h.state.next({ready:true,uid:'',isAdmin:false});release();await settle();assert.equal(h.service.selectedId,'');assert.equal(h.listeners.length,0);assert.deepEqual(h.service.fixes,[]);
  h.queryBlock(undefined);h.signIn();await h.open();const old=h.listeners.at(-1);
  h.emit({...track,revision:2},{fromCache:true});assert.equal(h.service.revision,1);
  h.state.next({ready:true,uid:'',isAdmin:false});old.next({metadata:{},exists:true,data:()=>track});assert.equal(h.service.ready,false);h.service.ngOnDestroy();
});
test('sign-out during save prevents writes; automatic transaction retries stop at three reads',async()=>{
  const h=harness();h.signIn();await h.open();let release;h.block(new Promise(r=>release=r));
  const saving=h.service.save(line,1,'Circuit');h.state.next({ready:true,uid:'',isAdmin:false});release();assert.equal(await saving,false);assert.equal(h.writes,0);
  h.block(undefined);h.signIn();await h.open();let reads=0;
  h.db.runTransaction=async callback=>{for(let i=0;i<5;i++)await callback({get:async()=>{reads++;return {data:()=>track};},set(){}});};
  assert.equal(await h.service.save(line,1,'Circuit'),false);assert.equal(reads,3);h.service.ngOnDestroy();
});

test('saved dataset choice is followed by viewers and bypasses candidate lookup in Live and history',async()=>{
  const h=harness(undefined,{trackId:'circuit',revision:1,updatedBy:'admin'});h.signIn(false);await h.open();
  assert.equal(h.service.selectedId,'circuit');assert.equal(h.queries,0);assert.equal(h.service.canEdit,false);
  await h.open('2026-10-19:false');assert.equal(h.service.selectedId,'circuit');assert.equal(h.queries,0);
  assert.ok(h.selectionListeners.every(l=>['GreenpowerTelemetry/424/days/2026-10-19','GreenpowerTelemetry/424/days/2026-10-19/config/track'].includes(l.path)));
  assert.equal(h.selectionListeners[0].active,false);h.service.ngOnDestroy();assert.equal(h.selectionListeners.at(-1).active,false);
});
test('draft choices are local, Cancel restores the shared choice, and committed choices update viewers',async()=>{
  const definitions=[{id:'a',...track},{id:'b',...track,name:'Alternative'}];
  const admin=harness(definitions), viewer=harness(definitions);admin.signIn();viewer.signIn(false);await admin.open();await viewer.open();
  admin.service.syncEditing(true);admin.service.choose('b');await settle();
  assert.equal(admin.service.selectedId,'b');assert.equal(viewer.service.selectedId,'');assert.equal(admin.writes,0);
  admin.service.syncEditing(false);assert.equal(admin.service.selectedId,'');
  admin.service.syncEditing(true);admin.service.choose('b');await settle();const write=admin.service.selectionWrite();
  assert.equal(write.day,'2026-10-19');assert.equal(write.trackId,'b');assert.equal(write.revision,0);assert.equal(write.current(),true);
  write.acknowledged();admin.service.syncEditing(false);viewer.selection({trackId:'b',revision:1,updatedBy:'admin'});await settle();
  assert.equal(admin.service.selectedId,'b');assert.equal(viewer.service.selectedId,'b');
  viewer.selection({trackId:'a',revision:2,updatedBy:'admin'});await settle();assert.equal(viewer.service.selectedId,'a');
  viewer.service.syncEditing(true);viewer.service.choose('b');assert.equal(viewer.service.selectedId,'a','viewer cannot stage manual changes');
  admin.service.ngOnDestroy();viewer.service.ngOnDestroy();
});
test('Automatic clears the shared override, and returning from a draft does not repeat candidate scans',async()=>{
  const h=harness(undefined,{trackId:'circuit',revision:1,updatedBy:'admin'});h.signIn();await h.open();
  h.service.syncEditing(true);h.service.choose('');await settle();assert.equal(h.queries,1);
  const write=h.service.selectionWrite();assert.equal(write.trackId,null);write.acknowledged();h.service.syncEditing(false);await settle();
  assert.equal(h.service.selectedId,'circuit');assert.equal(h.queries,1);h.service.ngOnDestroy();
});
test('cached/invalid dataset choices fail closed; late callbacks and pending saves cannot affect another dataset',async()=>{
  const h=harness();h.signIn();await h.open();const listener=h.selectionListeners.at(-1);
  h.selection({trackId:'other',revision:2,updatedBy:'admin'},{fromCache:true});assert.equal(h.service.selectedId,'circuit');
  h.selection({trackId:'other',revision:2,updatedBy:'admin'},{hasPendingWrites:true});assert.equal(h.service.selectedId,'circuit');
  h.selection({trackId:7});assert.equal(h.service.line,null);assert.equal(h.service.selectionReady,false);
  h.service.retry();await settle();listener.next({metadata:{},exists:true,data:()=>({trackId:'wrong',revision:9,updatedBy:'admin'})});
  assert.notEqual(h.service.selectedId,'wrong');
  h.selection({trackId:null,revision:2,updatedBy:'admin'});await settle();h.service.syncEditing(true);h.service.choose('circuit');await settle();
  const write=h.service.selectionWrite();await h.open('2026-10-18:false');assert.equal(write.current(),false);h.service.ngOnDestroy();
});

test('a published override cancels an in-flight lookup; Automatic can resolve the interrupted search once',async()=>{
  const h=harness();h.signIn(false);let release;h.queryBlock(new Promise(resolve=>release=resolve));await h.open();
  assert.equal(h.queries,1);h.selection({trackId:'circuit',revision:1,updatedBy:'admin'});await settle();
  assert.equal(h.service.selectedId,'circuit');assert.equal(h.service.searching,false);
  release();await settle();assert.equal(h.queries,1);
  h.selection({trackId:null,revision:2,updatedBy:'admin'});await settle();
  assert.equal(h.service.selectedId,'circuit');assert.equal(h.queries,2);
  h.service.update([...channels],27000);assert.equal(h.queries,2);h.service.ngOnDestroy();
});
