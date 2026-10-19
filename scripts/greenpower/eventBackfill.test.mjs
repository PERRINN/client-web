import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { eventPlan, runEventBackfill } from './eventBackfill.mjs';
import { event } from './eventFixtures.mjs';
const contents = count => JSON.stringify({ version: 1, projectId: 'perrinn-d5fc1', scope: 'events-only',
  events: Array.from({ length: count }, (_, i) => ({ id: 'approved-' + i, expectedRevision: 0, data: event('Event ' + i) })) });
test('historical manifest retains its 36 approved names and all unresolved source rows', async () => {
  const text = await readFile(new URL('../../audits/greenpower-event-approved-manifest-2026-10-19.json', import.meta.url), 'utf8');
  const plan = eventPlan(text);
  assert.equal(plan.bounds.events, 36); assert.equal(plan.requests.length, 9);
  assert.equal(plan.bounds.transactionReadsPerPhase, 135); assert.equal(plan.bounds.maximumCommittedWrites, 54);
  assert.ok(plan.requests.every(request => !request.sessions.length));
  assert.equal(plan.manifest.pendingAssignments.length, 53);
  assert.equal(plan.manifest.pendingAssignments.filter(row => !row.eventId).length, 4);
  assert.equal(plan.manifest.unassignedImportedDates.length, 37);
});

test('manifest checksum and create-only scope refuse changed data, wrong project and oversized plans', () => {
  const text = contents(1), plan = eventPlan(text);
  assert.equal(eventPlan(text, plan.sha256).sha256, plan.sha256);
  assert.throws(() => eventPlan(text + '\n', plan.sha256), /checksum/);
  assert.throws(() => eventPlan(contents(37)), /manifest/);
  assert.throws(() => eventPlan(text.replace('perrinn-d5fc1', 'another-project')), /manifest/);
  assert.throws(() => eventPlan(text.replace('"expectedRevision":0', '"expectedRevision":1')), /only create/);
  assert.throws(() => eventPlan(text.replace('"review_needed"', '"matched"')), /only create/);
  const changed = JSON.parse(text); changed.events[0].data.segments = [];
  assert.throws(() => eventPlan(JSON.stringify(changed)), /fields/);
});

test('the retired arbitrary-ID backfill cannot write more metadata', async () => {
  await assert.rejects(runEventBackfill(), /retired/);
});
