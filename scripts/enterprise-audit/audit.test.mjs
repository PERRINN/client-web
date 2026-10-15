import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./audit.mjs', import.meta.url));
test('offline CLI produces useful evidence without live probes and preserves failing exit status', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'perrinn-audit-test-'));
  try {
    const output = path.join(dir, 'report.json');
    const result = spawnSync(process.execPath, [script, '--offline', '--output', output], { encoding: 'utf8' });
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.mode, 'offline');
    assert.deepEqual(report.requests, []);
    assert.deepEqual(report.dns, {});
    assert.deepEqual(report.tls, {});
    assert.equal(result.status, report.summary.FAIL ? 1 : 0);
    assert.ok(report.dependencies.core['firestore.googleapis.com']);
    assert.ok(report.findings.some(finding => finding.check === 'Live checks skipped'));
    assert.ok(!JSON.stringify(report).includes('AIza'));
    assert.ok(!JSON.stringify(report).includes('Signature='));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('CLI rejects unknown arguments before performing live work', () => {
  const result = spawnSync(process.execPath, [script, '--unknown'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
  assert.equal(result.stdout, '');
});
