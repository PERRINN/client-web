import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const { ROOT, LIMITS, MetadataError, validateRequest, editMetadata } = require('../../functions/utils/greenpowerEvents.js');
export const adminAuth = { uid: 'test-admin', token: { perrinnAdmin: true } };
export const timestamp = () => new Date('2026-10-19T12:00:00Z');
export const options = { timestamp };
export const event = (name = 'Full dyno') => ({ name, type: 'full_dyno', date: '2026-06-14', timeZone: 'Europe/London', state: 'active', metadataStatus: 'review_needed' });
export const eventChange = (id, expectedRevision = 0, data = event(id)) => ({ id, expectedRevision, ...(data ? { data } : {}) });
export const request = (requestId, events, sessions = [], action = 'edit') => ({ requestId, action, events, sessions });
export function recording(day = '2026-06-14', source = 'echook-history', first = Date.parse(day + 'T08:35:00Z')) {
  const samples = Array.from({ length: 4 }, (_, i) => ({ id: source + '-' + day + '-' + i, source,
    receivedAt: source === 'echook-history' ? Date.parse('2026-10-19T12:00:00Z') : first + i * 1000,
    ...(source === 'echook-history' ? { eventAt: first + i * 1000 } : {}), raw: '{"Vt":24}' }));
  const imported = { day, source, carId: 'test-car', status: 'complete', sourceSha256: 'a'.repeat(64), count: 4,
    expectedCount: 4, chunkCount: 1, nextChunk: 1, firstAt: first, lastAt: first + 3000 };
  const importId = 'echook-test-car-' + day;
  const chunk = { samples, bytes: samples.reduce((n, s) => n + Buffer.byteLength(JSON.stringify(s)), 0) };
  const records = [[ROOT + '/days/' + day, { date: day, count: 4, activeChunk: 0 }],
    [ROOT + '/days/' + day + '/chunks/0000000000', chunk],
    ...(source === 'echook-history' ? [[ROOT + '/imports/' + importId, imported]] : [])];
  const segment = (from = 0, to = 3) => ({ day, source, ...(source === 'echook-history' ? { importId } : {}),
    firstChunk: '0000000000', lastChunk: '0000000000', firstIndex: from, lastIndex: to,
    firstSampleId: samples[from].id, lastSampleId: samples[to].id, firstAt: first + from * 1000, lastAt: first + to * 1000 });
  return { records, segment, samples };
}
export function session(eventId, segments, name = 'Run 1') {
  return { name, eventId, runNumber: 1, metadataStatus: 'review_needed', firstAt: segments[0].firstAt, lastAt: segments.at(-1).lastAt, segments };
}
export const sessionChange = (id, data, expectedRevision = 0) => ({ id, data, expectedRevision });

// Buffer writes until callback success, as a Firestore transaction does.
export function memoryDb(initial = [], { failCommit = false, retryOnce = false, onRead } = {}) {
  const records = new Map(structuredClone(initial));
  const counts = { reads: 0, writes: 0, attempts: 0, rpcs: 0 };
  const doc = path => ({ path });
  return { records, counts, doc, async runTransaction(callback, settings) {
    assert.equal(settings.maxAttempts, 3);
    let result;
    for (let attempt = 0; attempt < (retryOnce ? 2 : 1); attempt++) {
      counts.attempts++;
      const writes = [];
      const snapshot = ref => { counts.reads++; onRead?.(ref); return { ref, data: () => structuredClone(records.get(ref.path)) }; };
      const tx = { async get(ref) { assert.equal(writes.length, 0, 'all reads precede writes'); counts.rpcs++; return snapshot(ref); },
        async getAll(...refs) { assert.equal(writes.length, 0); counts.rpcs++; return refs.map(snapshot); },
        set(ref, data) { writes.push({ ref, data }); }, create(ref, data) { assert.ok(!records.has(ref.path)); writes.push({ ref, data }); } };
      result = await callback(tx);
      if (failCommit) throw new Error('synthetic commit failure with private provider detail');
      if (retryOnce && attempt === 0) continue;
      for (const { ref, data } of writes) { records.set(ref.path, structuredClone(data)); counts.writes++; }
    }
    return result;
  } };
}
export const readEvent = (db, id) => db.records.get(ROOT + '/events/' + id);
export const readSession = (db, id) => db.records.get(ROOT + '/sessions/' + id);
