import { parseArgs } from 'node:util';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { planImport, fetchHistory, MAX_SOURCE_BYTES, sha256 } from './historySource.mjs';
import { runImport } from './historyImport.mjs';

export async function main(args = process.argv.slice(2), createDb) {
  const { values } = parseArgs({ args, options: {
    file: { type: 'string' }, date: { type: 'string' }, count: { type: 'string' },
    sha256: { type: 'string' }, project: { type: 'string' }, write: { type: 'boolean' },
    start: { type: 'string' }, end: { type: 'string' }, download: { type: 'string' },
    report: { type: 'string' }
  } });
  if (values.download) {
    if (values.write || values.file || values.project) throw new Error('Download mode cannot access Firebase');
    const result = await fetchHistory({ start: Number(values.start), end: Number(values.end) });
    await writeFile(values.download, result.body, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ count: result.count, requests: result.requests, bytes: result.bytes, sha256: sha256(result.body) }));
    return;
  }
  if (!values.file || !values.date || !values.count || !values.sha256 || !values.project) throw new Error('Required: --file --date --count --sha256 --project; default is read-only, --write enables import');
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(values.project)) throw new Error('Invalid project ID');
  if ((await stat(values.file)).size > MAX_SOURCE_BYTES) throw new Error('Source exceeds 64 MiB');
  const plan = planImport(await readFile(values.file, 'utf8'), values.date, Number(values.count), values.sha256);
  const require = createRequire(import.meta.url);
  const admin = require('firebase-admin');
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Only local emulator hosts are supported');
  if (process.env.FIRESTORE_EMULATOR_HOST && !values.project.startsWith('demo-')) throw new Error('Emulator requires a demo project');
  const app = createDb ? undefined : admin.initializeApp({ projectId: values.project, credential: admin.credential.applicationDefault() });
  const db = createDb ? await createDb(values.project) : app.firestore();
  try {
    const result = await runImport(db, plan, { write: values.write, timestamp: () => admin.firestore.FieldValue.serverTimestamp(),
      progress: p => { if (p.completedChunks % 25 === 0 || p.completedChunks === p.totalChunks) console.log(JSON.stringify(p)); } });
    const report = { ...result, day: plan.day, project: values.project, firstAt: plan.firstAt, lastAt: plan.lastAt, verifiedAt: new Date().toISOString() };
    if (values.report) await writeFile(values.report, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(report));
    return report;
  } finally { if (app) { await db.terminate(); await app.delete(); } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Never print provider errors, request headers, credentials or source payloads.
    console.error(error.code ? `Importer stopped (code ${error.code}); rerun after resolving the connection or access issue.` : error.message);
    process.exitCode = 1;
  });
}
