import assert from 'node:assert/strict';
import { test } from 'node:test';
import { data, load } from './load.mjs';
const gps=load('../../src/app/greenpower-telemetry/greenpowerGps.ts',{'./greenpowerData':data});
const tracks=load('../../src/app/greenpower-telemetry/greenpowerTracks.ts',{'./greenpowerGps':gps});
const fixes=Array.from({length:100},(_,i)=>({time:i*3000,lat:50+Math.sin(i/10)*.001,lon:-1+Math.cos(i/10)*.001}));
const line={a:{lat:50,lon:-1.0001},b:{lat:50,lon:-.9999},direction:1};
const coverage=tracks.trackCoverage(fixes,line);
const track={name:'Circuit',line,...coverage,revision:1,updatedBy:'admin'};
test('coverage indexes the whole circuit including neighbouring cells and negative longitude boundaries',()=>{
  assert.equal(tracks.validTrack(track),true);
  assert.ok(coverage.cells.includes(tracks.trackCell(fixes[0])));
  assert.ok(coverage.cells.includes(tracks.trackCell(fixes[50])));
  assert.ok(coverage.cells.length<=64);
  assert.equal(tracks.matchesTrack(track,fixes),true);
  assert.equal(tracks.matchesTrack({...track,line:null},fixes),false);
  assert.equal(tracks.matchesTrack(track,[...fixes,{time:400000,lat:51,lon:0}]),false);
});
test('lookup requires three consecutive plausible fixes and can start anywhere around a circuit',()=>{
  assert.equal(tracks.lookupAnchor(fixes.slice(0,2)),undefined);
  assert.deepEqual(tracks.lookupAnchor(fixes),fixes[1]);
  assert.equal(tracks.matchesTrack(track,fixes.slice(50)),true);
  assert.deepEqual(tracks.lookupAnchor([{time:0,lat:0,lon:1},...fixes]),fixes[1]);
});
test('invalid tracks, unbounded coverage, missing GPS and mixed geographic datasets fail closed',()=>{
  assert.equal(tracks.validTrack({...track,cells:['wrong']}),false);
  assert.equal(tracks.validTrack({...track,name:' '.repeat(5)}),false);
  assert.equal(tracks.trackCoverage([],line),undefined);
  assert.equal(tracks.trackCoverage([...fixes,{time:400000,lat:51,lon:0}],line),undefined);
  assert.deepEqual(tracks.coverageCells({south:0,north:50,west:0,east:50}),[]);
  assert.equal(tracks.validTrack({...track,line:{...line,a:{lat:51,lon:0}}}),false);
});
test('explicit saves can extend coverage without shrinking previously saved circuit coverage',()=>{
  const other={...coverage.bounds,east:coverage.bounds.east+.001};
  const merged=tracks.mergedCoverage(coverage.bounds,other);
  assert.equal(merged.bounds.west,coverage.bounds.west);assert.equal(merged.bounds.east,other.east);
  assert.equal(tracks.mergedCoverage(coverage.bounds,{south:0,north:1,west:0,east:1}),undefined);
});
