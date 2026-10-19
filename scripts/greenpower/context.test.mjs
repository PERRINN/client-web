import assert from 'node:assert/strict';
import test from 'node:test';
import { load, data } from './load.mjs';
import { event, recording, session } from './eventFixtures.mjs';
const { recordingHeader } = load('../../src/app/greenpower-telemetry/greenpowerContext.ts', { './greenpowerData': data });
const savedEvent = { ...event('Workshop dyno'), id: 'dyno', revision: 1, updatedBy: 'admin', sessionCount: 2 };
const first = Date.parse('2026-06-14T08:00:00Z');
const input = changes => ({ signedIn: true, live: false, day: '2026-06-14', recordingKey: '', loading: false, partial: false,
  error: false, hasSamples: true, start: first, end: first + 3600000, liveStatus: 'Live', sessionId: '', metadataError: false,
  dayContext: { events: [savedEvent], complete: true, loading: false, failed: false }, ...changes });

test('whole recorded days use event names and actual loaded bounds independently of plot zoom', () => {
  const value = recordingHeader(input());
  assert.equal(value.title, 'Workshop dyno'); assert.equal(value.scope, 'Whole recorded day');
  assert.equal(value.date, '2026-06-14'); assert.equal(value.range, 'Loaded 09:00:00 – 10:00:00');
  assert.deepEqual(recordingHeader(input({ window: { start: first + 10000, end: first + 20000 } })), value);
});

test('same-day events stay distinct and incomplete/failed name lookups never invent an assignment', () => {
  const context = { events: [savedEvent, { ...savedEvent, id: 'other', name: 'Battery test' }], complete: true };
  assert.equal(recordingHeader(input({ dayContext: context })).title, 'Workshop dyno / Battery test');
  assert.equal(recordingHeader(input({ dayContext: { ...context, complete: false } })).title, 'Workshop dyno / Battery test / …');
  const empty = { events: [], complete: true, loading: false, failed: false };
  assert.equal(recordingHeader(input({ dayContext: empty })).state, 'No event assigned');
  assert.equal(recordingHeader(input({ dayContext: { ...empty, complete: false, loading: true } })).state, 'Loading event names…');
  const failed = recordingHeader(input({ dayContext: { ...empty, complete: false, failed: true } }));
  assert.equal(failed.title, 'Recorded day'); assert.equal(failed.state, 'Event names unavailable');
});

test('a selected session names its run and carries midnight dates without expanding to the whole day', () => {
  const a = recording('2026-06-14', 'echook-history', Date.parse('2026-06-14T22:59:00Z'));
  const b = recording('2026-06-15', 'echook-history', Date.parse('2026-06-14T23:01:00Z'));
  const selected = { ...session('dyno', [a.segment(), b.segment()], 'Dyno run 2'), id: 'run', revision: 1, updatedBy: 'admin' };
  const value = recordingHeader(input({ event: savedEvent, session: selected, sessionId: 'run', recordingKey: 'run:3',
    start: selected.firstAt, end: selected.lastAt }));
  assert.equal(value.title, 'Workshop dyno'); assert.equal(value.scope, 'Session · Dyno run 2');
  assert.equal(value.date, '2026-06-14 – 2026-06-15'); assert.equal(value.range, 'Loaded 23:59:00 – 00:01:03');
  assert.equal(value.state, 'Needs review');
  assert.equal(recordingHeader(input({ event: savedEvent, session: selected, sessionId: 'run', recordingKey: 'run:3', partial: true })).state, 'Partial recording · Needs review');
});

test('loading, partial data and failures describe the loaded portion and hide cleared old ranges', () => {
  assert.equal(recordingHeader(input({ loading: true, hasSamples: false })).range, 'Loading recording…');
  const partial = recordingHeader(input({ partial: true }));
  assert.equal(partial.state, 'Partial recording'); assert.equal(partial.range, 'Loaded 09:00:00 – 10:00:00');
  assert.equal(recordingHeader(input({ error: true })).state, 'Load failed');
  const waiting = recordingHeader(input({ event: savedEvent, recordingKey: 'event:dyno' }));
  assert.equal(waiting.scope, 'No session selected'); assert.equal(waiting.range, 'No recording loaded');
  assert.equal(recordingHeader(input({ day: '2026-06-15', event: savedEvent, recordingKey: 'event:dyno' })).date, '2026-06-14');
  assert.equal(recordingHeader(input({ event: savedEvent, recordingKey: 'event:dyno', sessionId: 'missing', metadataError: true })).scope, 'Session unavailable');
  const unknown = recordingHeader(input({ recordingKey: 'event:missing', sessionId: 'missing', metadataError: true }));
  assert.equal(unknown.scope, 'Session unavailable'); assert.equal(unknown.range, 'No recording loaded');
});

test('live and signed-out contexts cannot inherit a historical event title or range', () => {
  const live = recordingHeader(input({ live: true, event: savedEvent, lastReceived: first, liveStatus: 'Stale' }));
  assert.equal(live.title, '424 Greenpower Telemetry'); assert.equal(live.scope, 'Stale'); assert.equal(live.range, 'Last received 09:00:00');
  const signedOut = recordingHeader(input({ signedIn: false, event: savedEvent }));
  assert.equal(signedOut.title, '424 Greenpower Telemetry'); assert.equal(signedOut.range, ''); assert.equal(signedOut.date, '');
});
