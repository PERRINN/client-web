// Trusted release tool. Uses the operator's Firebase CLI login; never client code.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const [project, mode] = process.argv.slice(2);
if (!/^[a-z][a-z0-9-]+$/.test(project || '') || !['--apply', '--check'].includes(mode) || process.argv.length !== 4)
  throw Error('Usage: node scripts/admin/configure-voice-inbox.mjs PROJECT --check|--apply');
const apply = mode === '--apply', region = 'us-central1';
async function main() {
  const auth = require('firebase-tools/lib/auth'), account = auth.getProjectDefaultAccount(process.cwd());
  if (!account?.tokens?.refresh_token) throw Error('Sign in with firebase login first.');
  const token = await auth.getAccessToken(account.tokens.refresh_token, []);
  async function api(url, method = 'GET', body) {
    const response = await fetch(url, { method, headers: { Authorization: 'Bearer ' + token.access_token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw Error(`${method} ${new URL(url).hostname} failed (${response.status}).`);
    return response.status === 204 ? {} : response.json();
  }
  const prefix = `projects/${project}/locations/${region}`;
  const [enqueue, worker, desired] = await Promise.all([
    api(`https://cloudfunctions.googleapis.com/v2/${prefix}/functions/voiceInputEnqueue`),
    api(`https://cloudfunctions.googleapis.com/v2/${prefix}/functions/processVoiceInputInbox`),
    readFile(new URL('../../storage.lifecycle.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  if (enqueue.state !== 'ACTIVE' || worker.state !== 'ACTIVE') throw Error('Both inbox functions must be active.');
  const identity = enqueue.serviceConfig.serviceAccountEmail;
  if (!identity?.endsWith('.gserviceaccount.com') || !worker.serviceConfig.service) throw Error('Missing runtime identity/service.');
  const member = 'serviceAccount:' + identity, queue = `${prefix}/queues/processVoiceInputInbox`;
  const runBase = `https://run.googleapis.com/v2/${worker.serviceConfig.service}`;
  const queueBase = `https://cloudtasks.googleapis.com/v2/${queue}`;
  const saBase = `https://iam.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(identity)}`;
  const changes = [];
  async function grant(base, role, postGet = false, privateWorker = false) {
    const policy = await api(base + ':getIamPolicy' + (postGet ? '' : '?options.requestedPolicyVersion=3'), postGet ? 'POST' : 'GET', postGet ? { options: { requestedPolicyVersion: 3 } } : undefined);
    const bindings = policy.bindings || [];
    if (privateWorker && bindings.some(b => b.members?.some(m => ['allUsers', 'allAuthenticatedUsers'].includes(m)))) throw Error('Worker has a public IAM binding; release stopped.');
    let binding = bindings.find(b => b.role === role && !b.condition);
    if (binding?.members?.includes(member)) return;
    changes.push(role);
    if (!apply) return;
    if (!binding) { binding = { role, members: [] }; bindings.push(binding); }
    binding.members = [...(binding.members || []), member];
    await api(base + ':setIamPolicy', 'POST', { policy: { ...policy, bindings } });
    const verified = await api(base + ':getIamPolicy', postGet ? 'POST' : 'GET', postGet ? {} : undefined);
    if (!verified.bindings?.some(b => b.role === role && !b.condition && b.members?.includes(member))) throw Error('IAM verification failed.');
  }
  await grant(runBase, 'roles/run.invoker', false, true);
  await grant(queueBase, 'roles/cloudtasks.enqueuer', true);
  await grant(saBase, 'roles/iam.serviceAccountUser');
  const bucketBase = `https://storage.googleapis.com/storage/v1/b/${project}.appspot.com`;
  const bucket = await api(bucketBase + '?fields=name,lifecycle,softDeletePolicy,metageneration');
  const rules = bucket.lifecycle?.rule || [];
  for (const rule of desired.rule) {
    const exists = rules.some(r => r.action?.type === 'Delete' && r.condition?.age === 7 && r.condition?.matchesPrefix?.length === 1 && r.condition.matchesPrefix[0] === 'voice-input/' && Object.keys(r.condition).length === 2);
    if (!exists) { rules.push(rule); changes.push('voice-input lifecycle'); }
  }
  if (apply && changes.includes('voice-input lifecycle')) {
    await api(bucketBase + '?ifMetagenerationMatch=' + bucket.metageneration, 'PATCH', { lifecycle: { rule: rules } });
    const verified = await api(bucketBase + '?fields=lifecycle,softDeletePolicy');
    if (!verified.lifecycle?.rule?.some(r => r.condition?.matchesPrefix?.includes('voice-input/') && r.condition.age === 7)) throw Error('Lifecycle verification failed.');
    if (JSON.stringify(verified.softDeletePolicy) !== JSON.stringify(bucket.softDeletePolicy)) throw Error('Soft-delete policy unexpectedly changed.');
  }
  const config = await api(queueBase);
  if (config.retryConfig?.maxAttempts !== 8 || !['0s', undefined].includes(config.retryConfig.maxRetryDuration)
      || config.retryConfig.minBackoff !== '300s' || config.retryConfig.maxBackoff !== '3600s'
      || config.rateLimits?.maxConcurrentDispatches !== 2 || config.rateLimits.maxDispatchesPerSecond !== 2) throw Error('Unexpected task queue limits.');
  console.log(JSON.stringify({ project, mode, changes, identity, workerService: worker.serviceConfig.service,
    queue: { state: config.state, retryConfig: config.retryConfig, rateLimits: config.rateLimits }, softDeletePolicy: bucket.softDeletePolicy }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
