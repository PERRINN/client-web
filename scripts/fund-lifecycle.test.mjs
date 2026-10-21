import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { migrationFields, prepare, apply } from './funds/migrate.mjs';
const require = createRequire(import.meta.url);
const { DAY, storedFund, resolveFund } = require('../functions/utils/fundState');
const { validateFundCommand } = require('../functions/utils/fundCommand');
const exports = {};
new Function('exports','require',ts.transpileModule(readFileSync(new URL('../src/app/chat/chat-fund/chatFund.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports,require);
const now = 1800000000000;
const previous = { verifiedTimestamp: { seconds: now / 1000 }, fund: { description: 'Testing', amountGBPTarget: 100, amountGBPRaised: 20, daysLeft: 5 } };
test('legacy conversion fixes the closing date to saved verification time, including expired/cancelled records', () => {
  const before = storedFund(previous.fund, previous.verifiedTimestamp);
  assert.equal(before.closesAt, now + 5 * DAY);
  assert.equal(storedFund({ ...previous.fund, daysLeft: -2 }, previous.verifiedTimestamp).closesAt, now - 2 * DAY);
  assert.equal(storedFund({ ...previous.fund, amountGBPTarget: 0.0001 }, previous.verifiedTimestamp).cancelled, true);
  assert.throws(() => migrationFields({ fund: previous.fund }), /review required/);
});
test('historical numeric text remains readable without changing persisted amounts', () => {
  const record = { ...previous, fund: { ...previous.fund, amountGBPTarget: '559.6', amountGBPRaised: '559.55', daysLeft: '-806.4' } };
  const client = exports.chatFund(record, now);
  assert.equal(client.amountGBPTarget, 559.6); assert.equal(client.amountGBPRaised, 559.55);
  assert.equal(exports.fundStatus(client, now), 'Ended');
  const fields = migrationFields(record);
  assert.equal(fields['fund.closesAt'], Math.round(now - 806.4 * DAY));
  assert.equal(fields['fund.cancelled'], false);
  assert.deepEqual(Object.keys(fields).sort(), ['fund.cancelled', 'fund.closesAt']);
  assert.equal(record.fund.amountGBPTarget, '559.6');
  for (const target of ['', ' ', 'Infinity', 'invalid', null, true]) {
    assert.equal(exports.chatFund({ ...record, fund: { ...record.fund, amountGBPTarget: target } }), null);
    assert.throws(() => migrationFields({ ...record, fund: { ...record.fund, amountGBPTarget: target } }), /review required/);
  }
  assert.equal(migrationFields({ ...record, fund: { ...record.fund, amountGBPTarget: '0' } }), null);
});
test('text-target migration is a separate bounded indexed page with type-safe continuation', async () => {
  const calls = [], record = { ...previous, fund: { ...previous.fund, amountGBPTarget: '4610' } };
  const query = { where: (...args) => { calls.push(args); return query; }, orderBy: () => query,
    startAfter: () => query, limit: n => { calls.push(['limit', n]); return query; },
    get: async () => ({ docs: [{ id: 'historical', data: () => record, updateTime: { seconds: 1, nanoseconds: 0 } }] }) };
  const result = await prepare({ collection: () => query }, 'demo', undefined, { targetType: 'string' });
  assert.ok(calls.some(call => call[0] === 'fund.amountGBPTarget' && call[2] === ''));
  assert.deepEqual(calls.at(-1), ['limit', 101]);
  assert.equal(result.plan.entries.length, 1); assert.equal(result.plan.cursor.target, '4610');
  await assert.rejects(prepare({}, 'demo', result.plan.cursor), /target type/);
});
test('server and client agree at exact expiry, with stale flags ignored and reaching the target independent', () => {
  const record = { ...previous, fund: { ...previous.fund, closesAt: now + 100, cancelled: false, active: false } };
  for (const at of [now, now + 99, now + 100, now + 101]) {
    const server = resolveFund(record, undefined, at), client = exports.chatFund(record, at);
    assert.equal(server.active, exports.activeFund(client, at));
    assert.equal(server.active, at < now + 100);
  }
  assert.equal(resolveFund(record, { amountGBPRaised: 200 }, now, { raised: 200 }).active, true);
});
test('messages, raised corrections and daily reprocessing cannot extend a fixed deadline', () => {
  const first = resolveFund(previous, undefined, now + DAY);
  assert.equal(first.closesAt, now + 5 * DAY);
  const record = { fund: first, verifiedTimestamp: { seconds: (now + DAY) / 1000 } };
  assert.equal(resolveFund(record, { description: 'Updated' }, now + 2 * DAY).closesAt, first.closesAt);
  assert.equal(resolveFund(record, { amountGBPRaised: 0 }, now + 2 * DAY, { raised: 0 }).closesAt, first.closesAt);
  const daily = resolveFund({}, { ...first, amountGBPRaised: 0 }, now + 8 * DAY, { reprocessing: true });
  assert.equal(daily.closesAt, first.closesAt); assert.equal(daily.amountGBPRaised, 0); assert.equal(daily.active, false);
});
test('explicit cancellation preserves description, target, total and closing date', () => {
  const fund = resolveFund(previous, { cancelled: true }, now);
  assert.equal(fund.cancelled, true); assert.equal(fund.active, false);
  assert.equal(fund.description, 'Testing'); assert.equal(fund.amountGBPTarget, 100); assert.equal(fund.amountGBPRaised, 20);
  assert.equal(fund.closesAt, now + 5 * DAY);
  assert.equal(resolveFund({ fund }, undefined, now + DAY).cancelled, true);
});
test('new closing dates and legacy days are explicit edits, independent of an old conversation timestamp', () => {
  assert.equal(resolveFund(previous, { daysLeft: 30 }, now + 50 * DAY).closesAt, now + 80 * DAY);
  assert.equal(resolveFund(previous, { closesAt: now + 10 * DAY }, now).closesAt, now + 10 * DAY);
  assert.equal(exports.fundStatus({ ...previous.fund, closesAt: now + 1 }, now), '1 day left');
  assert.equal(exports.fundStatus({ ...previous.fund, closesAt: now + DAY, cancelled: true }, now), 'Cancelled');
});
test('explicit cancellation and past closing dates require admin, malformed fields fail closed', async () => {
  let calls=0;
  const auth = { getUser: async () => { calls++; return { customClaims: {} }; } };
  for (const fund of [{cancelled:true},{closesAt:now},{closesAt:now-1}]) await assert.rejects(validateFundCommand(fund,'person',auth,now), /Admin permission/);
  assert.equal(calls,3);
  await validateFundCommand({cancelled:false,closesAt:now+DAY},'person',auth,now);assert.equal(calls,3);
  for(const fund of [{cancelled:'true'},{cancelled:null},{closesAt:0},{closesAt:'tomorrow'},{closesAt:Infinity},{closesAt:now+.5}]) await assert.rejects(validateFundCommand(fund,'person',auth,now));
});
test('migration preparation reads one page of at most 101 and prepares at most 100 changes', async () => {
  const calls=[], docs=Array.from({length:101},(_,i)=>({id:'fund-'+i,data:()=>previous,updateTime:{seconds:100,nanoseconds:i}}));
  const query={where:()=>query,orderBy:()=>query,startAfter:()=>query,limit:n=>{calls.push(n);return query;},get:async()=>({docs})};
  const result=await prepare({collection:()=>query},'demo-funds');
  assert.deepEqual(calls,[101]);assert.equal(result.plan.entries.length,100);assert.equal(result.plan.hasMore,true);
  assert.equal(result.plan.entries[0].fields['fund.closesAt'],now+5*DAY);
  assert.equal(migrationFields({...previous,fund:{...previous.fund,closesAt:now+DAY,cancelled:false}}),null);
  const writes=[]; const db={doc:id=>id,batch:()=>({update:(...args)=>writes.push(args),commit:async()=>{}})};
  assert.equal(await apply(db,result,result.checksum,'demo-funds',v=>v),100);assert.equal(writes.length,100);
  assert.deepEqual(writes[0][2].lastUpdateTime,{seconds:100,nanoseconds:0});
  await assert.rejects(apply(db,result,'wrong','demo-funds',v=>v),/mismatch/);
  await assert.rejects(apply(db,result,result.checksum,'production',v=>v),/mismatch/);
});
test('migration ambiguity blocks apply and stale-write errors are not retried by the tool', async () => {
  const bad={...previous,verifiedTimestamp:undefined};
  const query={where:()=>query,orderBy:()=>query,limit:()=>query,get:async()=>({docs:[{id:'bad',data:()=>bad,updateTime:{seconds:1,nanoseconds:0}}]})};
  const result=await prepare({collection:()=>query},'demo');assert.equal(result.plan.errors.length,1);
  await assert.rejects(apply({},result,result.checksum,'demo',v=>v),/review/);
  query.get=async()=>({docs:[{id:'valid',data:()=>previous,updateTime:{seconds:1,nanoseconds:0}}]});
  const valid=await prepare({collection:()=>query},'demo');let commits=0;
  await assert.rejects(apply({doc:id=>id,batch:()=>({update(){},commit:async()=>{commits++;throw Error('stale');}})},valid,valid.checksum,'demo',v=>v),/stale/);
  assert.equal(commits,1);
});

test('ordinary conversations with legacy default days never acquire an indexed fund deadline', () => {
  const noFund={verifiedTimestamp:previous.verifiedTimestamp,fund:{amountGBPTarget:0,amountGBPRaised:0,daysLeft:30}};
  assert.equal(storedFund(noFund.fund,noFund.verifiedTimestamp).closesAt,null);
  const result=resolveFund(noFund,undefined,now);assert.equal(result.closesAt,null);assert.equal(result.active,false);
  assert.equal(resolveFund({}, {closesAt:now+DAY}, now).closesAt,null);
});
test('legacy day commands cannot produce unsafe or unsupported persisted closing dates', async () => {
  const auth={getUser:async()=>({customClaims:{perrinnAdmin:true}})};
  for(const daysLeft of [1e20,-1e20])await assert.rejects(validateFundCommand({daysLeft},'admin',auth,now),/closing date/);
});
