// Operator tool. Prepare reads at most 101 current fund records; apply writes at
// most 100 reviewed records atomically, with update-time preconditions and no application retry loop.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { storedFund } = require('../../functions/utils/fundState');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function migrationFields(data) {
  if (Number.isSafeInteger(data.fund?.closesAt) && data.fund.closesAt > 0 && data.fund.closesAt <= 8640000000000000 && typeof data.fund?.cancelled === 'boolean') return null;
  const fund = storedFund(data.fund, data.verifiedTimestamp);
  if (!Number.isSafeInteger(fund.closesAt) || fund.closesAt <= 0 || fund.closesAt > 8640000000000000) throw new Error('Missing valid saved verification time/remaining days; review required');
  return { 'fund.closesAt': fund.closesAt, 'fund.cancelled': fund.cancelled };
}
export async function prepare(db, projectId, cursor) {
  let query = db.collection('PERRINNMessages').where('lastMessage', '==', true).where('verified', '==', true)
    .where('fund.amountGBPTarget', '>', 0).orderBy('fund.amountGBPTarget').orderBy('__name__');
  if (cursor) query = query.startAfter(cursor.target, db.doc('PERRINNMessages/' + cursor.id));
  const page = await query.limit(101).get(), entries = [], errors = [];
  for (const doc of page.docs.slice(0, 100)) {
    try {
      const fields = migrationFields(doc.data());
      if (fields) entries.push({ id: doc.id, updateTime: { seconds: doc.updateTime.seconds, nanoseconds: doc.updateTime.nanoseconds }, fields });
    } catch (error) { errors.push({ id: doc.id, error: error.message }); }
  }
  const last = page.docs[Math.min(page.docs.length, 100) - 1];
  const plan = { version: 1, projectId, entries, errors, hasMore: page.docs.length > 100,
    cursor: last ? { id: last.id, target: last.data().fund.amountGBPTarget } : null };
  return { plan, checksum: hash(plan) };
}
export async function apply(db, envelope, checksum, projectId, timestamp) {
  const { plan } = envelope;
  if (checksum !== envelope.checksum || checksum !== hash(plan) || plan.projectId !== projectId || plan.version !== 1) throw new Error('Plan checksum/project mismatch');
  if (plan.errors.length || plan.entries.length > 100) throw new Error('Plan requires review or exceeds the write budget');
  const ids = new Set();
  for (const entry of plan.entries) {
    if (!/^[^/]+$/.test(entry.id) || ids.has(entry.id) || !Number.isSafeInteger(entry.fields['fund.closesAt'])
      || entry.fields['fund.closesAt'] <= 0 || entry.fields['fund.closesAt'] > 8640000000000000 || typeof entry.fields['fund.cancelled'] !== 'boolean'
      || Object.keys(entry.fields).length !== 2) throw new Error('Invalid migration entry');
    ids.add(entry.id);
  }
  if (!plan.entries.length) return 0;
  const batch = db.batch();
  for (const entry of plan.entries) batch.update(db.doc('PERRINNMessages/' + entry.id), entry.fields,
    { lastUpdateTime: timestamp(entry.updateTime) });
  await batch.commit();
  return plan.entries.length;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, projectId, file, argument] = process.argv.slice(2);
  if (!['prepare', 'apply'].includes(mode) || !projectId || !file) throw new Error('Usage: node scripts/funds/migrate.mjs prepare PROJECT PLAN.json [CURSOR.json] | apply PROJECT PLAN.json CHECKSUM');
  const admin = require('firebase-admin');
  const app = admin.initializeApp({ projectId });
  try {
    const db = app.firestore();
    if (mode === 'prepare') {
      const cursor = argument ? JSON.parse(await readFile(argument, 'utf8')) : undefined;
      const result = await prepare(db, projectId, cursor);
      await writeFile(file, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
      console.log(JSON.stringify({ entries: result.plan.entries.length, errors: result.plan.errors.length, hasMore: result.plan.hasMore, cursor: result.plan.cursor, checksum: result.checksum }));
    } else console.log(JSON.stringify({ updated: await apply(db, JSON.parse(await readFile(file, 'utf8')), argument, projectId, value => new admin.firestore.Timestamp(value.seconds ?? value._seconds, value.nanoseconds ?? value._nanoseconds)) }));
  } finally { await app.delete(); }
}
