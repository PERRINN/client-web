// Explicit operator preparation/apply only. No collection scans, raw writes or deletions.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { eventPlan, withEventOperator } from './eventBackfill.mjs';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { ROOT, editMetadata, validateRequest } = require('./utils/greenpowerEvents');
export const checksum = text => createHash('sha256').update(text).digest('hex');

export async function prepareDayMigration(db, contents) {
  const { manifest } = eventPlan(contents);
  const dates = manifest.events.map(event => event.data.date);
  if (new Set(dates).size !== dates.length) throw Error('Resolve duplicate dates before preparing a migration.');
  const snapshots = await db.getAll(...manifest.events.map(event => db.doc(ROOT + '/events/' + event.id)));
  const days = await db.getAll(...dates.map(date => db.doc(ROOT + '/days/' + date)));
  const changes = [], skipped = [];
  for (let i = 0; i < snapshots.length; i++) {
    const source = snapshots[i].data(), id = manifest.events[i].id, date = dates[i];
    if (!source || source.date !== date || !Number.isSafeInteger(source.revision) || source.revision < 1 || source.sessionCount !== 0) throw Error('Source is missing, changed date or has sessions: ' + id);
    // One bounded orphan check per explicitly named source, no automatic pagination.
    const sessions = await db.collection(ROOT + '/sessions').where('eventId', '==', id).limit(1).get();
    if (!sessions.empty) throw Error('Source has linked sessions; review their types and boundaries explicitly: ' + id);
    if (!days[i].data()?.count || days[i].data().date !== date) { skipped.push({ id, date, reason: 'No recorded day' }); continue; }
    const data = Object.fromEntries(Object.entries(source).filter(([key]) => !['revision', 'sessionCount', 'locationKey', 'updatedAt', 'updatedBy'].includes(key)));
    changes.push({ event: { id: date, expectedRevision: 0, data }, source: { id, date, revision: source.revision } });
  }
  const sha = checksum(JSON.stringify(changes));
  const batches = [];
  for (let offset = 0; offset < changes.length; offset += 4) {
    const records = changes.slice(offset, offset + 4);
    batches.push({ request: validateRequest({ requestId: 'day-migration-' + sha.slice(0, 48) + '-' + offset / 4,
      action: 'edit', events: records.map(record => record.event), sessions: [] }), sources: records.map(record => record.source) });
  }
  return { version: 1, projectId: manifest.projectId, scope: 'event-day-migration', batches, skipped };
}

export async function runDayMigration(db, plan, { actor, timestamp, apply = false }) {
  if (plan.version !== 1 || plan.projectId !== 'perrinn-d5fc1' || plan.scope !== 'event-day-migration'
    || !Array.isArray(plan.batches) || plan.batches.length > 9) throw Error('Invalid migration plan.');
  const ids = new Set();
  for (const batch of plan.batches) {
    validateRequest(batch.request);
    if (batch.request.action !== 'edit' || batch.request.sessions.length || !Array.isArray(batch.sources)
      || batch.sources.length !== batch.request.events.length) throw Error('Migration only creates explicitly sourced events.');
    for (const event of batch.request.events) {
      if (event.expectedRevision !== 0 || event.id !== event.data.date || ids.has(event.id)
        || !batch.sources.some(source => source.date === event.id)) throw Error('Migration cannot overwrite or duplicate events.');
      ids.add(event.id);
    }
  }
  const first = await actor();
  // Preflight all batches before any write. The helper revalidates each source in its transaction.
  const preview = [];
  for (const batch of plan.batches) preview.push(await editMetadata(db, first, batch.request, { timestamp, dryRun: true, migrationSources: batch.sources }));
  const results = [];
  if (apply) for (const batch of plan.batches) {
    const current = await actor();
    if (current.uid !== first.uid) throw Error('Operator identity changed.');
    results.push(await editMetadata(db, current, batch.request, { timestamp, migrationSources: batch.sources }));
  }
  return { mode: apply ? 'apply' : 'dry-run', events: ids.size, skipped: plan.skipped, preview, results,
    writes: results.reduce((sum, result) => sum + result.writes, 0), rawWrites: 0, sessionWrites: 0,
    bounds: { prepareDocumentReads: 72, prepareQueries: 36, queryLimit: 1, batchesPerPhase: 9, transactionAttempts: 3,
      transactionDocumentReadsPerPhase: 351, committedWrites: 54, concurrency: 1, automaticApplicationRetries: 0 } };
}

async function main() {
  const [mode, path, flag, value, reportFlag, reportPath] = process.argv.slice(2);
  if (mode === 'prepare' && flag === '--out' && value && !reportFlag) {
    await withEventOperator(async (db, settings) => {
      await settings.actor();
      const plan = await prepareDayMigration(db, await readFile(path, 'utf8'));
      const report = await runDayMigration(db, plan, settings);
      const text = JSON.stringify(plan, null, 2) + '\n'; await writeFile(value, text);
      console.log(JSON.stringify({ ...report, sha256: checksum(text), plan: value }));
    });
  } else if (mode === 'apply' && flag === '--sha256' && /^[a-f0-9]{64}$/.test(value || '') && reportFlag === '--report' && reportPath) {
    const text = await readFile(path, 'utf8');
    if (checksum(text) !== value) throw Error('Plan checksum does not match.');
    await withEventOperator(async (db, settings) => {
      const report = await runDayMigration(db, JSON.parse(text), { ...settings, apply: true });
      await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ writes: report.writes, report: reportPath }));
    });
  } else throw Error('Usage: eventDayMigration.mjs prepare MANIFEST --out PLAN | apply PLAN --sha256 SHA256 --report REPORT');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
