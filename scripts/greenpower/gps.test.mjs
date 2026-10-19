import assert from 'node:assert/strict';
import { test } from 'node:test';
import { data, load } from './load.mjs';
const gps = load('../../src/app/greenpower-telemetry/greenpowerGps.ts', { './greenpowerData': data });
const metre = 180 / (Math.PI * 6371000);
const origin = { lat: 50, lon: 0 };
const fix = (time, x, y) => ({ time, lat: origin.lat + y * metre, lon: x * metre / Math.cos(origin.lat * Math.PI / 180) });
const line = { a: fix(0, -10, 0), b: fix(0, 10, 0), direction: 1 };
const channel = (id, values) => ({ id, points: values.map(([time, value]) => ({time,value})) });
function race() {
  // Two laps, crossing at 2, 22 and 42 seconds; each crossing is confirmed north of the line.
  return [[0,0,-30],[3000,0,15],[6000,40,30],[10000,60,0],[14000,40,-30],[18000,0,-30],
    [24000,0,15],[28000,40,30],[32000,60,0],[36000,40,-30],[38000,0,-30],[44000,0,15]].map(v=>fix(...v));
}
test('GPS coordinates require matching timestamps, valid fixes and final duplicate values', () => {
  const fixes = gps.gpsFixes([channel('["Lat"]:°', [[0,0],[10,50],[20,50],[20,51],[30,90]]), channel('["Lon"]:°', [[0,0],[20,1],[20,2],[30,1]])]);
  assert.deepEqual(fixes, [{time:20,lat:51,lon:2}]);
  assert.equal(gps.validLine({...line,b:line.a}),false);
  assert.equal(gps.validLine({...line,direction:0}),false);
  assert.equal(gps.validLine({...line,b:fix(0,1000,0)}),false);
});
test('finite directed crossings interpolate time, start lap 1 and complete only full laps', () => {
  const fixes = race();
  const channels = [channel('["A"]:A', fixes.map(f=>[f.time,12])),...data.channelsFor(fixes.map(f => ({ source: '424-phone', receivedAt: f.time, raw: '{"Spd":10}' })))];
  const result = gps.gpsAnalysis(fixes,line,channels,44000);
  assert.equal(result.laps.length,3);
  assert.deepEqual(result.laps.map(l=>l.complete),[true,true,false]);
  assert.ok(Math.abs(result.laps[0].time-2000)<.01);
  assert.ok(Math.abs(result.laps[0].end-22000)<.01);
  assert.ok(Math.abs(result.laps[0].current-12)<1e-8);
  assert.ok(Math.abs(result.laps[0].speed-10/0.44704)<1e-8);
  assert.equal(result.channel.value,'3');
  assert.equal(result.channel.id,'computed:gps-lap');
  assert.deepEqual(gps.gpsAnalysis(fixes,null,channels,44000).laps,[]);
  assert.equal(gps.gpsAnalysis(fixes,{...line,direction:-1},channels,44000).laps.length,0,'return path is beyond the finite line');
});
test('jitter near finish, infinite-line crossings and implausible jumps do not add laps', () => {
  const jitter = [[0,0,-30],[3000,0,10],[4000,0,-2],[5000,0,2],[6000,0,-7],[7000,0,8]].map(v=>fix(...v));
  assert.equal(gps.gpsAnalysis(jitter,line,[],7000).laps.length,1);
  const outside = [[0,40,-30],[3000,40,15]].map(v=>fix(...v));
  assert.equal(gps.gpsAnalysis(outside,line,[],3000).laps.length,0);
  const jump = [fix(0,0,-1000),fix(1000,0,1000)];
  assert.equal(gps.gpsAnalysis(jump,line,[],1000).laps.length,0);
});
test('GPS outages mark interrupted laps incomplete and cannot fabricate crossings', () => {
  const fixes = race(); fixes[5]={...fixes[5],time:170000};
  const ordered = fixes.slice(0,6);
  const result=gps.gpsAnalysis(ordered,line,[],170000);
  assert.equal(result.laps.length,1);assert.equal(result.laps[0].complete,false);
  assert.equal(result.laps[0].end,14000);assert.equal(result.channel.value,'—');
  assert.equal(gps.gpsAnalysis([fix(0,0,-30),fix(30000,0,20)],line,[],30000).laps.length,0);
});
test('time averages weight irregular intervals, interpolate boundaries and reject missing coverage', () => {
  const points=[{time:0,value:0},{time:1000,value:10},{time:10000,value:10}];
  assert.equal(gps.timeAverage(points,0,10000),9.5);
  assert.equal(gps.timeAverage(points,500,1000),7.5);
  assert.equal(gps.timeAverage(points,-1,10000),undefined);
  assert.equal(gps.timeAverage(points,0,11000),undefined);
  assert.equal(gps.timeAverage([{time:0,value:10},{time:20000,value:10}],0,20000),undefined);
});
test('cursor interpolation uses valid GPS segments and geometry stays equal-scale and bounded', () => {
  const fixes=race(), position=gps.fixAt(fixes,1500);
  assert.ok(Math.abs(position.lat-fix(1500,0,-7.5).lat)<1e-10);
  assert.equal(gps.fixAt(fixes,100000),undefined);
  const projection=gps.trackProjection(fixes,line), p=fixes[3], screen=projection.project(p), back=projection.unproject(screen.x,screen.y);
  assert.ok(Math.abs(back.lat-p.lat)<1e-10);assert.ok(Math.abs(back.lon-p.lon)<1e-10);
  const dense=Array.from({length:28800},(_,i)=>fix(i*1000,Math.sin(i/100)*100,Math.cos(i/100)*100));
  const path=gps.trackProjection(dense).path;
  assert.ok((path.match(/[ML]/g)||[]).length<=4001);assert.doesNotMatch(path,/NaN|Infinity/);
});
