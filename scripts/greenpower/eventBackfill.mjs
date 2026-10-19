// Trusted operator command. This never runs in the browser or a Cloud Function.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { validateRequest } = require('./utils/greenpowerEvents');
const digest = value => createHash('sha256').update(value).digest('hex');

export function eventPlan(contents, checksum) {
  if (Buffer.byteLength(contents) > 1024 * 1024) throw Error('Manifest exceeds 1 MiB.');
  const sha256 = digest(contents);
  if (checksum && checksum !== sha256) throw Error('Manifest checksum does not match.');
  const manifest = JSON.parse(contents);
  if (manifest.version !== 1 || manifest.projectId !== 'perrinn-d5fc1' || manifest.scope !== 'events-only'
    || !Array.isArray(manifest.events) || !manifest.events.length || manifest.events.length > 36
    || new Set(manifest.events.map(event => event.id)).size !== manifest.events.length) throw Error('Invalid event-only manifest.');
  const requests = [];
  for (let offset = 0; offset < manifest.events.length; offset += 4) {
    const events = manifest.events.slice(offset, offset + 4);
    if (events.some(event => event.expectedRevision !== 0 || !event.data || event.data.metadataStatus !== 'review_needed'
      || event.data.state !== 'active')) throw Error('Backfill can only create events awaiting session review.');
    requests.push(validateRequest({ requestId: 'event-backfill-' + sha256.slice(0, 48) + '-' + offset / 4,
      action: 'edit', events, sessions: [] }));
  }
  return { manifest, sha256, requests, bounds: { events: manifest.events.length, requestsPerPhase: requests.length,
    concurrency: 1, transactionAttemptsPerRequest: 3, transactionReadsPerPhase: 3 * (manifest.events.length + requests.length),
    maximumCommittedWrites: manifest.events.length + 2 * requests.length, verificationReads: manifest.events.length,
    automaticApplicationRetries: 0 } };
}

// The historical arbitrary-ID writer is retired: use eventDayMigration.mjs.
export async function runEventBackfill() {
  throw Error('Event-only backfill is retired. Use eventDayMigration.mjs to preserve live metadata under recorded-day IDs.');
}

export async function withEventOperator(callback) {
  const projectId = 'perrinn-d5fc1';
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw Error('This operator command requires live identity verification.');
  const admin = require('firebase-admin'), auth = require('firebase-tools/lib/auth');
  const account = auth.getProjectDefaultAccount(fileURLToPath(new URL('../../', import.meta.url)));
  if (!account?.tokens?.refresh_token || !account.user?.email) throw Error('Sign in with firebase login first.');
  const credential = { async getAccessToken() {
    const token = await auth.getAccessToken(account.tokens.refresh_token, []);
    return { access_token: token.access_token, expires_in: Number(token.expires_in) || 3600 };
  } };
  const app = admin.initializeApp({ projectId, credential });
  // Admin Auth accepts token providers; Firestore uses the CLI's OAuth user credential directly.
  // Keep refresh credentials in memory and never write or report them.
  const api = require('firebase-tools/lib/api'), { Firestore, FieldValue } = require('@google-cloud/firestore');
  const db = new Firestore({ projectId, preferRest: true, credentials: {
    type: 'authorized_user', client_id: api.clientId(), client_secret: api.clientSecret(), refresh_token: account.tokens.refresh_token,
  } });
  try {
    const actor = async () => {
      const user = await app.auth().getUserByEmail(account.user.email);
      if (user.disabled || user.customClaims?.perrinnAdmin !== true) throw Error('Signed-in operator must have the live PERRINN admin role.');
      return { uid: user.uid, token: { perrinnAdmin: true } };
    };
    return await callback(db, { actor, timestamp: () => FieldValue.serverTimestamp() });
  } finally { await db.terminate(); await app.delete(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.error('Event-only backfill is retired. Use eventDayMigration.mjs.'); process.exitCode = 1;
}
