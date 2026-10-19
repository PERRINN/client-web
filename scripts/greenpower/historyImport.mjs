import { CAR_ID } from './historySource.mjs';

const MAX_CHUNK_BYTES = 128 * 1024;
const CHUNK_SIZE = 32;
const chunkId = index => String(index).padStart(10, '0');

export function importChunks(plan, receivedAt) {
  const chunks = [];
  for (const record of plan.records) {
    const sample = { ...record, receivedAt, source: 'echook-history' };
    const size = Buffer.byteLength(JSON.stringify(sample));
    let chunk = chunks.at(-1);
    if (!chunk || chunk.samples.length >= CHUNK_SIZE || chunk.bytes + size > MAX_CHUNK_BYTES) {
      chunk = { samples: [], bytes: 0 }; chunks.push(chunk);
    }
    if (size > MAX_CHUNK_BYTES) throw new Error('Sample exceeds chunk budget');
    chunk.samples.push(sample); chunk.bytes += size;
  }
  if (chunks.length > 4096) throw new Error('Import exceeds 4,096-chunk budget');
  return chunks;
}

function checkState(state, day, plan, chunks) {
  if (!state) { if (day) throw new Error('Destination day exists: live/unrelated data must be reconciled first'); return; }
  if (state.sourceSha256 !== plan.sourceSha256 || state.expectedCount !== plan.records.length || state.chunkCount !== chunks.length || state.carId !== CAR_ID) throw new Error('Import snapshot conflicts with saved provenance');
  if (!Number.isSafeInteger(state.receivedAt) || !['importing', 'complete'].includes(state.status)) throw new Error('Invalid import provenance');
  if (!Number.isSafeInteger(state.nextChunk) || state.nextChunk < 1 || state.nextChunk > chunks.length) throw new Error('Invalid checkpoint');
  const count = chunks.slice(0, state.nextChunk).reduce((n, c) => n + c.samples.length, 0);
  const latest = chunks[state.nextChunk - 1].samples.at(-1);
  if (!day || day.count !== count || day.activeChunk !== state.nextChunk - 1 || !sameSample(day.latest, latest) || state.count !== count || (state.status === 'complete') !== (state.nextChunk === chunks.length)) throw new Error('Destination changed outside this import');
}

export async function verifyImport(db, plan, chunks, state, day) {
  checkState(state, day, plan, chunks);
  if (!state) return 0;
  const root = db.doc(`GreenpowerTelemetry/424/days/${plan.day}`).collection('chunks');
  let cursor, checked = 0;
  // Known prefix + one extra document; at most 41 queries for 4,096 chunks.
  const expected = state.nextChunk;
  for (let page = 0; page < Math.ceil((expected + 1) / 100); page++) {
    let query = root.orderBy('__name__').limit(Math.min(100, expected + 1 - checked));
    if (cursor) query = query.startAfter(cursor);
    const limit = Math.min(100, expected + 1 - checked);
    const snapshot = await query.get();
    for (const doc of snapshot.docs) {
      if (checked >= expected || doc.id !== chunkId(checked)) throw new Error('Unexpected destination chunk');
      const actual = doc.data(), wanted = chunks[checked];
      if (actual.bytes !== wanted.bytes || actual.samples.length !== wanted.samples.length || actual.samples.some((s, i) => !sameSample(s, wanted.samples[i]))) throw new Error(`Stored sample mismatch in chunk ${doc.id}`);
      checked++;
    }
    if (snapshot.size < limit) break;
    cursor = snapshot.docs.at(-1);
  }
  if (checked !== expected) throw new Error('Missing destination chunks');
  return checked;
}
function sameSample(actual, expected) {
  return !!actual && Object.keys(actual).length === Object.keys(expected).length && Object.keys(expected).every(key => actual[key] === expected[key]);
}

export async function runImport(db, plan, { write = false, now = Date.now, timestamp = () => new Date(), progress = () => {} } = {}) {
  const dayRef = db.doc(`GreenpowerTelemetry/424/days/${plan.day}`);
  const stateRef = db.doc(`GreenpowerTelemetry/424/imports/echook-${CAR_ID}-${plan.day}`);
  const [daySnapshot, stateSnapshot] = await Promise.all([dayRef.get(), stateRef.get()]);
  let day = daySnapshot.data(), state = stateSnapshot.data();
  const receivedAt = state?.receivedAt ?? now();
  const chunks = importChunks(plan, receivedAt);
  checkState(state, day, plan, chunks);
  if (state) await verifyImport(db, plan, chunks, state, day);
  else {
    const orphan = await dayRef.collection('chunks').limit(1).get();
    if (!orphan.empty) throw new Error('Destination contains orphan/unrelated chunks');
  }
  if (!write || state?.status === 'complete') return { mode: write ? 'verified-rerun' : 'dry-run', count: plan.records.length, added: 0, existing: state?.count || 0, chunks: chunks.length, sourceSha256: plan.sourceSha256 };
  const resumed = state?.count || 0;
  for (let index = state?.nextChunk || 0; index < chunks.length; index++) {
    const chunkRef = dayRef.collection('chunks').doc(chunkId(index));
    await db.runTransaction(async transaction => {
      const [currentDay, currentState, currentChunk] = await transaction.getAll(dayRef, stateRef, chunkRef);
      const prior = currentState.data();
      checkState(prior, currentDay.data(), plan, chunks);
      if ((prior?.nextChunk || 0) !== index || currentChunk.exists || prior && prior.receivedAt !== receivedAt) throw new Error('Import advanced concurrently; rerun to verify');
      const count = (prior?.count || 0) + chunks[index].samples.length;
      const next = { carId: CAR_ID, day: plan.day, source: 'echook-history', sourceSha256: plan.sourceSha256,
        expectedCount: plan.records.length, chunkCount: chunks.length, count, nextChunk: index + 1,
        firstAt: plan.firstAt, lastAt: plan.lastAt, receivedAt,
        status: index + 1 === chunks.length ? 'complete' : 'importing', updatedAt: timestamp() };
      transaction.create(chunkRef, chunks[index]);
      transaction.set(dayRef, { date: plan.day, activeChunk: index, count, latest: chunks[index].samples.at(-1), updatedAt: timestamp() });
      transaction.set(stateRef, next);
    }, { maxAttempts: 3 });
    progress({ completedChunks: index + 1, totalChunks: chunks.length });
  }
  [day, state] = await Promise.all([dayRef.get().then(s => s.data()), stateRef.get().then(s => s.data())]);
  await verifyImport(db, plan, chunks, state, day);
  return { mode: 'imported', count: plan.records.length, added: plan.records.length - resumed, existing: resumed, chunks: chunks.length, sourceSha256: plan.sourceSha256 };
}
