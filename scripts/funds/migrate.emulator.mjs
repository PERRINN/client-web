import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test, after } from 'node:test';
import { prepare, apply } from './migrate.mjs';
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):\d+$/, 'Local emulator required; never production');
const require=createRequire(import.meta.url), admin=require('firebase-admin');
const app=admin.initializeApp({projectId:'demo-funds'},'fund-migration'), db=app.firestore();
after(async()=>{await db.terminate();await app.delete();});
test('real migration preserves fields, skips history, and atomically rejects stale prepared records',async()=>{
 const at=Date.now(), ids=['migration-active','migration-ended','migration-cancelled','migration-history'];
 const seed=db.batch();
 ids.forEach((id,index)=>seed.set(db.doc('PERRINNMessages/'+id),{
  lastMessage:index!==3,verified:true,verifiedTimestamp:admin.firestore.Timestamp.fromMillis(at),
  fund:{description:'Migration fixture',amountGBPTarget:index===2?0.0001:100,amountGBPRaised:25,daysLeft:index===1?-2:5}
 }));await seed.commit();
 const toStamp=value=>new admin.firestore.Timestamp(value.seconds??value._seconds,value.nanoseconds??value._nanoseconds);
 const first=await prepare(db,'demo-funds');assert.equal(first.plan.entries.length,3,JSON.stringify(first.plan.errors));
 await db.doc('PERRINNMessages/'+ids[0]).update({'fund.amountGBPRaised':26});
 await assert.rejects(apply(db,first,first.checksum,'demo-funds',toStamp));
 assert.equal((await db.doc('PERRINNMessages/'+ids[1]).get()).data().fund.closesAt,undefined);
 const fresh=await prepare(db,'demo-funds');assert.equal(await apply(db,fresh,fresh.checksum,'demo-funds',toStamp),3);
 for(let index=0;index<3;index++){
  const fund=(await db.doc('PERRINNMessages/'+ids[index]).get()).data().fund;
  assert.equal(fund.closesAt,at+(index===1?-2:5)*86400000);
  assert.equal(fund.cancelled,index===2);assert.equal(fund.amountGBPRaised,index===0?26:25);
 }
 assert.equal((await db.doc('PERRINNMessages/'+ids[3]).get()).data().fund.closesAt,undefined);
 const again=await prepare(db,'demo-funds');assert.equal(again.plan.entries.length,0);
 const cleanup=db.batch();ids.forEach(id=>cleanup.delete(db.doc('PERRINNMessages/'+id)));await cleanup.commit();
});
test('numeric and text passes cover legacy types without modifying saved amounts or history',async()=>{
 const at=Date.now(),ids=['text-ended','text-zero','text-history'];
 const seed=db.batch();
 ids.forEach((id,index)=>seed.set(db.doc('PERRINNMessages/'+id),{
  lastMessage:index!==2,verified:true,verifiedTimestamp:admin.firestore.Timestamp.fromMillis(at),
  fund:{description:'Legacy text',amountGBPTarget:index===1?'0':'559.6',amountGBPRaised:'559.55',daysLeft:-806.4}
 }));await seed.commit();
 try {
  assert.equal((await prepare(db,'demo-funds')).plan.entries.length,0);
  const plan=await prepare(db,'demo-funds',undefined,{targetType:'string'});
  assert.equal(plan.plan.entries.length,1);assert.equal(plan.plan.errors.length,0);
  assert.equal(await apply(db,plan,plan.checksum,'demo-funds',v=>new admin.firestore.Timestamp(v.seconds,v.nanoseconds)),1);
  const fund=(await db.doc('PERRINNMessages/text-ended').get()).data().fund;
  assert.equal(fund.amountGBPTarget,'559.6');assert.equal(fund.amountGBPRaised,'559.55');
  assert.equal(fund.closesAt,Math.round(at-806.4*86400000));assert.equal(fund.cancelled,false);
  for(const id of ids.slice(1))assert.equal((await db.doc('PERRINNMessages/'+id).get()).data().fund.closesAt,undefined);
  assert.equal((await prepare(db,'demo-funds',undefined,{targetType:'string'})).plan.entries.length,0);
 } finally {const cleanup=db.batch();ids.forEach(id=>cleanup.delete(db.doc('PERRINNMessages/'+id)));await cleanup.commit();}
});
