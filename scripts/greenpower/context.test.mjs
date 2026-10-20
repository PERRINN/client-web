import assert from 'node:assert/strict';
import test from 'node:test';
import { load, data, dayData } from './load.mjs';
const { recordingHeader } = load('../../src/app/greenpower-telemetry/greenpowerContext.ts', { './greenpowerData': data, './greenpowerDay': dayData });
const event = { ...dayData.emptyDay('2026-06-14'), eventName: 'Workshop' };
const first = Date.parse('2026-06-14T08:00:00Z');
const input = changes => ({ signedIn: true, live: false, day: event.date, loading: false, partial: false,
  error: false, hasSamples: true, start: first, end: first + 3600000, liveStatus: 'Live', event, ...changes });
test('loaded event identity and bounds stay independent of pending selections and chart zoom', () => {
  const header = recordingHeader(input()); assert.equal(header.title, 'Workshop'); assert.equal(header.scope, 'Whole event');
  assert.equal(header.range, 'Loaded 09:00:00 – 10:00:00');
  assert.deepEqual(recordingHeader(input({ selection: { eventName: 'Pending choice' }, window: { start: first, end: first + 1000 } })), header);
  assert.equal(recordingHeader(input({ event: undefined })).title, 'Event');
});
test('sessions use type and times while keeping the actual loaded range separate', () => {
  const header = recordingHeader(input({ session: { id: 'race', type: 'race', startAt: first, endAt: first + 3600000 } }));
  assert.match(header.scope, /Race · 09:00:00–10:00:00/); assert.equal(header.range, 'Loaded 09:00:00 – 10:00:00');
});
test('loading, partial, error and empty states describe the loaded dataset', () => {
  assert.equal(recordingHeader(input({ loading: true, hasSamples: false })).range, 'Loading recording…');
  assert.equal(recordingHeader(input({ partial: true })).state, 'Partial recording');
  assert.equal(recordingHeader(input({ error: true })).state, 'Load failed');
  assert.equal(recordingHeader(input({ hasSamples: false })).range, 'No recording loaded');
});
test('live and signed-out contexts cannot inherit historical titles, names or ranges', () => {
  const live = recordingHeader(input({ live: true, lastReceived: first, liveStatus: 'Stale' }));
  assert.equal(live.title, '424 Greenpower Telemetry'); assert.equal(live.scope, 'Stale');
  assert.deepEqual(recordingHeader(input({ signedIn: false })), { title: '424 Greenpower Telemetry', date: '', scope: '', range: '', state: '' });
});
test('historical headings show saved driver and result, with session driver overrides', () => {
  const metadata = { ...event, defaults: { driver: 'Alex' }, result: '3rd' };
  assert.equal(recordingHeader(input({ event: metadata })).title, 'Workshop · Alex · 3rd');
  const session = { type: 'race', startAt: first, endAt: first + 1000, overrides: { driver: 'Sam' } };
  assert.equal(recordingHeader(input({ event: metadata, session })).title, 'Workshop · Sam · 3rd');
  assert.equal(recordingHeader(input({ event: metadata, session: { ...session, overrides: {} } })).title, 'Workshop · Alex · 3rd');
  assert.equal(recordingHeader(input({ event: { ...metadata, eventName: '', defaults: {} } })).title, 'Event · 3rd');
  assert.equal(recordingHeader(input({ event: metadata, live: true })).title, '424 Greenpower Telemetry');
});
