import assert from 'node:assert/strict';
import test from 'node:test';
import { load, dayData, data, gps } from './load.mjs';
const { sessionIntervals, visibleSessions, sessionLapGroups, sessionLapAnalysis } = load('../../src/app/greenpower-telemetry/greenpowerSessions.ts', { './greenpowerDay': dayData, './greenpowerData': data, './greenpowerGps': gps });
const event = { ...dayData.emptyDay('2026-06-14'), defaults: { driver: 'Alex' } };
const sessions = [
  { id: 'race', type: 'race', startAt: 200, endAt: 400, overrides: { driver: 'Sam' } },
  { id: 'practice', type: 'practice', startAt: 0, endAt: 100, overrides: {} }
];
test('session annotations sort chronologically and resolve event or session driver without mutating metadata', () => {
  const intervals = sessionIntervals(event, sessions);
  assert.deepEqual(intervals.map(s => s.label), ['Practice · Alex', 'Race · Sam']);
  assert.equal(sessions[0].id, 'race');
  assert.equal(sessionIntervals({ ...event, defaults: {} }, [sessions[1]])[0].label, 'Practice');
});
test('zoom clips session bands, keeps gaps and only marks actual boundaries', () => {
  const intervals = sessionIntervals(event, sessions);
  const bands = visibleSessions(intervals, 50, 300);
  assert.deepEqual(bands.map(({x,width,starts,ends}) => ({x,width,starts,ends})), [
    { x: 0, width: 20, starts: false, ends: true }, { x: 60, width: 40, starts: true, ends: false }
  ]);
  assert.deepEqual(visibleSessions(intervals, 110, 190), []);
  assert.deepEqual(visibleSessions(intervals, 100, 100), []);
  assert.equal(visibleSessions(intervals, 0, 400).length, 2);
});
test('lap groups preserve every lap and its identity without assigning crossing or ambiguous laps to a driver', () => {
  const laps = [{ time: 0, end: 50, lap: 1 }, { time: 50, end: 100, lap: 2 },
    { time: 100, end: 210, lap: 3 }, { time: 210, end: 300, lap: 4 }];
  const intervals = sessionIntervals(event, sessions);
  const groups = sessionLapGroups(laps, intervals);
  assert.deepEqual(groups.map(group => group.session?.id), ['practice', undefined, 'race']);
  assert.deepEqual(groups.flatMap(group => group.laps), laps);
  assert.equal(sessionLapGroups([laps[0]], [...intervals, { ...intervals[0], id: 'overlap' }])[0].session, undefined);
  assert.deepEqual(sessionLapGroups([], intervals), []);
  assert.equal(sessionLapGroups(laps, []).length, 1);
});

test('overview hides crowded session text and zoom reveals only full type and driver labels that fit', () => {
  const intervals = sessionIntervals(event, sessions);
  assert.ok(visibleSessions(intervals, 0, 400, 150).every(session => !session.showLabel));
  const zoomed = visibleSessions(intervals, 0, 100, 180);
  assert.equal(zoomed[0].label, 'Practice · Alex'); assert.equal(zoomed[0].showLabel, true);
  assert.equal(visibleSessions(intervals, 99, 400, 180)[0].showLabel, false);
});


test('gear ratios use inherited teeth and flag chronological changes, including missing metadata', () => {
  const day = { ...event, defaults: { motorGearTeeth: 12, wheelGearTeeth: 60 } };
  const source = [sessions[1], { ...sessions[0], overrides: { motorGearTeeth: 15 } },
    { ...sessions[0], id: 'later', startAt: 500, overrides: { motorGearTeeth: 15 } }];
  const values = sessionIntervals(day, source);
  assert.deepEqual(values.map(s => [s.gearRatio, s.gearChanged]), [[5, false], [4, true], [4, false]]);
  assert.equal(sessionIntervals(event, source)[0].gearRatio, undefined);
});


const lapHelpers = load('../../src/app/greenpower-telemetry/greenpowerLaps.ts', { './greenpowerData': data });
function sessionFixture() {
  const fixes = Array.from({length: 15}, (_, i) => ({time:i*1000,lat:52,lon:-1}));
  const channels = ['["A"]:A','["Spd"]:m/s'].map((id,index)=>({id,points:fixes.map(fix=>({time:fix.time,value:index?20:10}))}));
  const laps = [
    {time:2000,end:4000,lap:1,alternate:false,complete:true,current:10,speed:20},
    {time:4000,end:10000,lap:2,alternate:true,complete:true,current:10,speed:20},
    {time:10000,end:12000,lap:3,alternate:false,complete:true,current:10,speed:20},
    {time:12000,end:14000,lap:4,alternate:true,complete:false}
  ];
  const analysis = {laps,channel:{id:'computed:gps-lap',label:'GPS lap',unit:'',value:'4',points:laps.map(lap=>({time:lap.time,value:lap.lap}))}};
  const intervals = [{id:'practice',start:0,end:5000,label:'Practice · Alex'}, {id:'race',start:8000,end:14000,label:'Race · Sam'}];
  return {analysis,intervals,source:{fixes,channels,end:14000,configured:true}};
}
test('Lap 1 runs from session start to first crossing throughout list, chart labels, cursor and channel', () => {
  const {analysis,intervals,source}=sessionFixture(), before=structuredClone(analysis);
  const result=sessionLapAnalysis(analysis,intervals,source);
  assert.deepEqual(result.laps.map(({time,end,lap,complete})=>({time,end,lap,complete})),[
    {time:0,end:2000,lap:1,complete:true},
    {time:2000,end:4000,lap:2,complete:true},
    {time:4000,end:5000,lap:3,complete:false},
    {time:5000,end:8000,lap:2,complete:false},
    {time:8000,end:10000,lap:1,complete:true},
    {time:10000,end:12000,lap:2,complete:true},
    {time:12000,end:14000,lap:3,complete:false}
  ]);
  assert.equal(result.laps[0].current,10); assert.equal(result.laps[0].speed,undefined);
  assert.equal(lapHelpers.lapAt(result.laps,1000),1);
  assert.equal(lapHelpers.lapAt(result.laps,2000),2);
  assert.equal(lapHelpers.lapAt(result.laps,9000),1);
  assert.deepEqual(lapHelpers.visibleLaps(result.laps,8000,12000,500).map(lap=>lap.label),['Lap 1','Lap 2']);
  assert.equal(result.channel.value,'3');
  assert.equal(result.channel.points.find(point=>point.time===8000).value,1);
  assert.equal(result.channel.points.find(point=>point.time===10000).value,2);
  assert.deepEqual(analysis,before,'the raw analysis remains unchanged');
  assert.equal(sessionLapAnalysis(analysis,[],source),analysis);
  assert.equal(sessionLapAnalysis(analysis,intervals,{...source,configured:false}),analysis);
  const changed=sessionLapAnalysis(analysis,[{...intervals[1],start:9000}],source);
  assert.equal(changed.laps.find(lap=>lap.sessionLabel)?.time,9000);
  assert.equal(changed.laps.find(lap=>lap.time===10000).lap,2);
});
test('a session starting on a crossing has no zero-duration or duplicate opening lap', () => {
  const {analysis,intervals,source}=sessionFixture();
  const result=sessionLapAnalysis(analysis,[{...intervals[0],start:2000,end:4000}],source);
  assert.deepEqual(result.laps.filter(lap=>lap.sessionLabel).map(lap=>[lap.time,lap.end,lap.lap]),[[2000,4000,1]]);
  assert.ok(result.laps.every(lap=>lap.end>lap.time));
});
test('sessions before any crossing show an incomplete Lap 1, with no fabricated complete time or averages', () => {
  const {analysis,intervals,source}=sessionFixture();
  const result=sessionLapAnalysis({...analysis,laps:[],channel:{...analysis.channel,value:'—',points:[]}},[intervals[0]],{...source,end:1000,fixes:source.fixes.slice(0,2)});
  assert.deepEqual(result.laps.map(lap=>[lap.time,lap.end,lap.lap,lap.complete]),[[0,1000,1,false]]);
  assert.equal(result.laps[0].current,undefined);assert.equal(result.channel.value,'1');
});
test('opening laps with missing GPS coverage remain incomplete and stale GPS has no latest counter', () => {
  const {analysis,intervals,source}=sessionFixture();
  const missing=sessionLapAnalysis(analysis,intervals,{...source,fixes:source.fixes.slice(1)});
  assert.equal(missing.laps[0].complete,false);assert.equal(missing.laps[0].current,undefined);
  const gap=sessionLapAnalysis(analysis,[{...intervals[1],start:100}],{...source,fixes:[source.fixes[0],{...source.fixes[1],time:20000}],end:20000});
  assert.equal(gap.laps.find(lap=>lap.sessionLabel).complete,false);
  const stale=sessionLapAnalysis(analysis,intervals,{...source,end:source.end+20000});
  assert.equal(stale.channel.value,'—');
  assert.equal(sessionLapAnalysis(analysis,[intervals[0],{...intervals[0],id:'overlap'}],source),analysis);
});
