// Trusted operator tool: never import this into the browser or a Cloud Function.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
export async function setAdminRole(auth, uid, enabled) {
  const account = await auth.getUser(uid);
  const claims = { ...account.customClaims };
  if (enabled) claims.perrinnAdmin = true;
  else delete claims.perrinnAdmin;
  await auth.setCustomUserClaims(uid, claims);
  const verified = await auth.getUser(uid);
  if ((verified.customClaims?.perrinnAdmin === true) !== enabled) throw new Error('Role verification failed');
  return { uid, perrinnAdmin: enabled };
}
async function main() {
  const [projectId, uid, action] = process.argv.slice(2);
  if (!projectId || !uid || !['grant', 'revoke'].includes(action) || process.argv.length !== 5) {
    throw new Error('Usage: node scripts/admin/set-admin-role.mjs PROJECT_ID UID grant|revoke');
  }
  let credential;
  if (process.env.PERRINN_ADMIN_AUTH === 'firebase-cli') {
    const auth = require('firebase-tools/lib/auth');
    const account = auth.getProjectDefaultAccount(process.cwd());
    if (!account?.tokens?.refresh_token) throw new Error('Sign in with firebase login first.');
    credential = { async getAccessToken() {
      const token = await auth.getAccessToken(account.tokens.refresh_token, []);
      return { access_token: token.access_token, expires_in: Number(token.expires_in) || 3600 };
    } };
  }
  const app = admin.initializeApp({ projectId, ...(credential ? { credential } : {}) });
  try { console.log(JSON.stringify({ projectId, ...await setAdminRole(app.auth(), uid, action === 'grant') })); }
  finally { await app.delete(); }
}
if (process.argv[1] === new URL(import.meta.url).pathname) main().catch(error => { console.error(error.message); process.exitCode = 1; });
