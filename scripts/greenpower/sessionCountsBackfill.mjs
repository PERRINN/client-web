// Trusted operator only. Run after deploying the count-aware session writer.
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { withEventOperator } from './eventBackfill.mjs';
const require = createRequire(import.meta.url);
const { ROOT, TYPES, hash, canonical, validateSessionTypeCounts } = require('../../functions/utils/greenpowerDayMetadata');
export const bounds = { days: 30, sessionsPerDay: 200, queryLimit: 201, concurrency: 1,
  attemptsPerDay: 3, maximumDocumentReads: 18180, maximumWrites: 60, rawReads: 0, rawWrites: 0 };
function check(ok, message) { if (!ok) throw Error(message); }
export async function backfillSessionCounts(db, auth, review, { timestamp, dryRun = true, actor, runId = randomUUID() } = {}) {
  check(auth?.token?.perrinnAdmin === true && typeof auth.uid === 'string' && auth.uid, 'Live admin permission required.');
  check(review?.version === 1 && review.projectId === 'perrinn-d5fc1' && Array.isArray(review.dates)
    && review.dates.length > 0 && review.dates.length <= bounds.days && new Set(review.dates).size === review.dates.length
    && review.dates.every(date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
      && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date), 'Review must name 1–30 distinct UK dates.');
  const results = [];
  for (const date of review.dates) {
    if (actor) {
      const current = await actor();
      check(current.uid === auth.uid && current.token?.perrinnAdmin === true, 'Operator permission changed.');
    }
    const changeId = hash(['session-type-counts', runId, auth.uid, date]);
    results.push(await db.runTransaction(async tx => {
      const ref = db.doc(ROOT + '/days/' + date), before = (await tx.get(ref)).data();
      check(before?.schemaVersion === 2 && before.date === date, 'Day requires migration: ' + date);
      const snapshot = await tx.get(db.collection(ref.path + '/sessions').select('type', 'schemaVersion', 'telemetryRoot').limit(bounds.queryLimit));
      check(snapshot.size <= bounds.sessionsPerDay, 'Session budget exceeded; review a separate continuation: ' + date);
      const sessionTypeCounts = {};
      for (const doc of snapshot.docs) {
        const session = doc.data();
        check(session.schemaVersion === 2 && session.telemetryRoot === ROOT && TYPES.includes(session.type), 'Invalid session metadata: ' + date);
        sessionTypeCounts[session.type] = (sessionTypeCounts[session.type] || 0) + 1;
      }
      validateSessionTypeCounts(sessionTypeCounts);
      const changed = canonical(before.sessionTypeCounts ?? null) !== canonical(sessionTypeCounts);
      if (!dryRun && changed) {
        const after = { ...before, sessionTypeCounts };
        check(Buffer.byteLength(JSON.stringify(after)) <= 8 * 1024, 'Event exceeds 8 KiB.');
        tx.set(ref, after);
        tx.create(db.doc(ROOT + '/metadataChanges/' + changeId), { actor: auth.uid, action: 'initialise-session-counts',
          createdAt: timestamp(), date, before: before.sessionTypeCounts ?? null, after: sessionTypeCounts });
      }
      return { date, sessionTypeCounts, changed, reads: 1 + snapshot.size, writes: !dryRun && changed ? 2 : 0, ...(!dryRun && changed ? { changeId } : {}) };
    }, { maxAttempts: bounds.attemptsPerDay }));
  }
  return { projectId: review.projectId, dryRun, runId, results, bounds };
}
async function main() {
  const [mode, path, ...args] = process.argv.slice(2);
  check(['dry-run', 'apply'].includes(mode) && path, 'Use dry-run REVIEW.json --report REPORT.json or apply REVIEW.json --sha256 SHA256 --report REPORT.json');
  const flags = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, index) => [args[index * 2], args[index * 2 + 1]]));
  check(args.length % 2 === 0 && Object.keys(flags).every(key => ['--sha256', '--report'].includes(key)) && flags['--report'], 'Provide a report path.');
  const contents = await readFile(path, 'utf8'), sha256 = createHash('sha256').update(contents).digest('hex');
  check(mode !== 'apply' || flags['--sha256'] === sha256, 'Review checksum does not match.');
  await withEventOperator(async (db, settings) => {
    const result = await backfillSessionCounts(db, await settings.actor(), JSON.parse(contents), { ...settings, dryRun: mode !== 'apply' });
    await writeFile(flags['--report'], JSON.stringify({ ...result, reviewSha256: sha256 }, null, 2) + '\n');
    console.log(JSON.stringify({ dryRun: result.dryRun, days: result.results.length, changed: result.results.filter(item => item.changed).length, reviewSha256: sha256 }));
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
