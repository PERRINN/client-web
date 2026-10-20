import assert from 'node:assert/strict';
import test from 'node:test';
import { load, dayData } from './load.mjs';
const { sessionIntervals, visibleSessions, sessionLapGroups } = load('../../src/app/greenpower-telemetry/greenpowerSessions.ts', { './greenpowerDay': dayData });
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
