import assert from 'node:assert/strict';
import { test } from 'node:test';
import { data, load } from './load.mjs';
const { lapIntervals, lapAt, visibleLaps } = load('../../src/app/greenpower-telemetry/greenpowerLaps.ts', { './greenpowerData': data });
const points = values => values.map(([time, value]) => ({ time, value }));
test('lap transitions preserve recorded resets, skipped numbers and stable alternating identity', () => {
  const laps = lapIntervals(points([[10,0],[20,0],[30,1],[50,3],[70,0]]), 100);
  assert.deepEqual(laps.map(l=>[l.time,l.end,l.lap,l.alternate]), [[10,30,0,false],[30,50,1,true],[50,70,3,false],[70,100,0,true]]);
  assert.equal(lapAt(laps,9),undefined);
  assert.equal(lapAt(laps,30),1);
  assert.equal(lapAt(laps,100),0);
  assert.equal(lapAt(laps,101),undefined);
  const zoom=visibleLaps(laps,40,80,400);
  assert.deepEqual(zoom.map(l=>[l.x,l.width,l.alternate]),[[0,25,true],[25,50,false],[75,25,true]]);
  assert.ok(zoom.every(l=>l.label==='Lap '+l.lap));
});
test('invalid counters and duplicate timestamps do not create phantom intervals', () => {
  const laps=lapIntervals(points([[0,-1],[1,1.2],[2,NaN],[10,1],[20,2],[20,1],[30,3],[30,4]]),50);
  assert.deepEqual(laps.map(l=>[l.time,l.end,l.lap]),[[10,30,1],[30,50,4]]);
  assert.deepEqual(lapIntervals([],50),[]);
  assert.deepEqual(visibleLaps(laps,10,10,300),[]);
});
test('narrow laps omit labels, zoom reveals them and dense intervals bound rendered bands', () => {
  const laps=lapIntervals(points([[0,1],[1,2],[2,3]]),100);
  const wide=visibleLaps(laps,0,100,300);
  assert.deepEqual(wide.map(l=>l.label),['','','Lap 3']);
  assert.equal(visibleLaps(laps,1,2,300)[0].label,'Lap 2');
  const dense=lapIntervals(Array.from({length:10000},(_,time)=>({time,value:time})),10000);
  assert.ok(visibleLaps(dense,0,10000,300).length<=300);
});
