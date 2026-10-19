import assert from 'node:assert/strict';
import { test } from 'node:test';
import { data, load } from './load.mjs';
const { lapAt, visibleLaps } = load('../../src/app/greenpower-telemetry/greenpowerLaps.ts', { './greenpowerData': data });
const intervals = values => values.map(([time,end,lap],index)=>({time,end,lap,alternate:!!(index%2)}));
test('GPS intervals preserve lap identity, inclusive boundaries and gaps', () => {
  const laps=intervals([[10,30,1],[30,50,2],[70,100,3]]);
  assert.equal(lapAt(laps,9),undefined);assert.equal(lapAt(laps,30),2);
  assert.equal(lapAt(laps,60),undefined);assert.equal(lapAt(laps,100),3);assert.equal(lapAt(laps,101),undefined);
  const zoom=visibleLaps(laps,40,80,400);
  assert.deepEqual(zoom.map(l=>[l.x,l.width,l.alternate]),[[0,25,true],[75,25,false]]);
  assert.ok(zoom.every(l=>l.label==='Lap '+l.lap));
});
test('empty and zero-width windows do not render lap bands', () => {
  assert.deepEqual(visibleLaps([],0,100,300),[]);
  assert.deepEqual(visibleLaps(intervals([[10,30,1]]),10,10,300),[]);
});
test('narrow laps omit labels, zoom reveals them and dense intervals bound rendered bands', () => {
  const laps=intervals([[0,1,1],[1,2,2],[2,100,3]]);
  const wide=visibleLaps(laps,0,100,300);
  assert.deepEqual(wide.map(l=>l.label),['','','Lap 3']);
  assert.equal(visibleLaps(laps,1,2,300)[0].label,'Lap 2');
  const dense=intervals(Array.from({length:10000},(_,time)=>[time,time+1,time+1]));
  assert.ok(visibleLaps(dense,0,10000,300).length<=300);
});
