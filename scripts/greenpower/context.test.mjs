import assert from 'node:assert/strict';
import test from 'node:test';
import { load, data, eventData } from './load.mjs';
import { event, recording, session } from './eventFixtures.mjs';
const { recordingHeader } = load('../../src/app/greenpower-telemetry/greenpowerContext.ts', { './greenpowerData': data, './greenpowerEvents': eventData });
const savedEvent = { ...event('Workshop dyno'), id: '2026-06-14', revision: 1, updatedBy: 'admin', sessionCount: 2 };
const first = Date.parse('2026-06-14T08:00:00Z');
const input = changes => ({ signedIn: true, live: false, day: '2026-06-14', recordingKey: '', loading: false, partial: false,
  error: false, hasSamples: true, start: first, end: first + 3600000, liveStatus: 'Live', sessionId: '', metadataError: false,
  dayContext: { events: [savedEvent], complete: true, loading: false, failed: false }, ...changes });

test('whole-event identity and loaded bounds stay independent of chart zoom; unnamed days are events', () => {
  const value = recordingHeader(input()); assert.equal(value.title, 'Workshop dyno'); assert.equal(value.scope, 'Whole event');
  assert.equal(value.date, '2026-06-14'); assert.equal(value.range, 'Loaded 09:00:00 – 10:00:00');
  assert.deepEqual(recordingHeader(input({ window: { start: first + 10000, end: first + 20000 } })), value);
  const unnamed = recordingHeader(input({ dayContext: { events: [], complete: true } }));
  assert.equal(unnamed.title, 'Event'); assert.equal(unnamed.state, '');
  assert.equal(recordingHeader(input({ dayContext: { events: [{ ...savedEvent, id: 'legacy', name: 'Legacy' }, savedEvent], complete: true } })).title, 'Workshop dyno');
});

test('a session has its name and exact loaded bounds without metadata review statuses', () => {
  const rec = recording(), selected = { ...session(savedEvent.id, [rec.segment()], 'Race 1'), id: 'run', revision: 1, updatedBy: 'admin' };
  const args = { event: savedEvent, session: selected, sessionId: 'run', recordingKey: 'run:1', start: selected.firstAt, end: selected.lastAt };
  const value = recordingHeader(input(args)); assert.equal(value.title, 'Workshop dyno'); assert.equal(value.scope, 'Session · Race 1');
  assert.equal(value.range, 'Loaded 09:35:00 – 09:35:03'); assert.equal(value.state, '');
  assert.equal(recordingHeader(input({ ...args, partial: true })).state, 'Partial recording');
});

test('loading, partial and error states remain explicit, including unavailable sessions', () => {
  assert.equal(recordingHeader(input({ loading: true, hasSamples: false })).range, 'Loading recording…');
  assert.equal(recordingHeader(input({ partial: true })).state, 'Partial recording');
  assert.equal(recordingHeader(input({ error: true })).state, 'Load failed');
  const missing = recordingHeader(input({ recordingKey: 'event:missing', sessionId: 'missing', metadataError: true }));
  assert.equal(missing.scope, 'Session unavailable'); assert.equal(missing.range, 'No recording loaded');
  const names = recordingHeader(input({ dayContext: { events: [], complete: false, failed: true } })); assert.equal(names.state, 'Event names unavailable');
});

test('live and signed-out contexts cannot inherit historical titles or ranges', () => {
  const live = recordingHeader(input({ live: true, event: savedEvent, lastReceived: first, liveStatus: 'Stale' }));
  assert.equal(live.title, '424 Greenpower Telemetry'); assert.equal(live.scope, 'Stale');
  const out = recordingHeader(input({ signedIn: false })); assert.equal(out.title, '424 Greenpower Telemetry'); assert.equal(out.date, ''); assert.equal(out.range, '');
});


test('historical original-ID names drive whole-day and session headers before day metadata migration', () => {
  const historical = { ...savedEvent, id: 'historical-dyno' };
  const dayContext = { events: [historical], complete: true, loading: false, failed: false };
  assert.equal(recordingHeader(input({ dayContext })).title, 'Workshop dyno');
  assert.equal(recordingHeader(input({ dayContext, event: { ...savedEvent, name: 'Event', revision: 0 }, recordingKey: 'event:' + savedEvent.id })).title, 'Workshop dyno');
  const selected = { ...session(savedEvent.id, [recording().segment()], 'Dyno run'), id: 'run', revision: 1, updatedBy: 'admin' };
  const value = recordingHeader(input({ dayContext, event: { ...savedEvent, name: 'Event', revision: 0 }, session: selected, sessionId: 'run', recordingKey: 'run:1' }));
  assert.equal(value.title, 'Workshop dyno'); assert.equal(value.scope, 'Session · Dyno run'); assert.match(value.range, /^Loaded /);
  const both = { ...dayContext, events: [historical, { ...historical, id: 'other', name: 'Battery dyno' }] };
  assert.equal(recordingHeader(input({ dayContext: both })).title, 'Workshop dyno / Battery dyno');
});
