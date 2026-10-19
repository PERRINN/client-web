// Bounded synthetic HTTP uploads. Credentials come only from environment vars.
import assert from 'node:assert/strict';
const target = new URL(process.env.GREENPOWER_TEST_URL || 'http://127.0.0.1:5003/demo-greenpower/us-central1/greenpowerTelemetry/');
const local = ['localhost', '127.0.0.1'].includes(target.hostname);
assert.ok(!target.username && !target.password && !target.search, 'Do not put credentials or parameters in the URL.');
assert.ok(local || target.protocol === 'https:', 'Remote targets require HTTPS.');
assert.ok(local || process.env.GREENPOWER_ALLOW_REMOTE === 'yes', 'Remote testing requires GREENPOWER_ALLOW_REMOTE=yes.');
const password = process.env.GREENPOWER_TELEMETRY_PASSWORD;
assert.ok(password && password.length >= 32, 'Set GREENPOWER_TELEMETRY_PASSWORD (at least 32 characters).');
const count = Number(process.env.GREENPOWER_TEST_COUNT || 3);
assert.ok(Number.isInteger(count) && count >= 1 && count <= 20, 'Test count must be 1–20.');
const mode = process.env.GREENPOWER_TEST_METHOD || 'POST';
assert.ok(['GET', 'POST'].includes(mode));
for (let index = 0; index < count; index++) {
  const raw = JSON.stringify({ Vt: 24.2 + index / 100, A: 30 + index, RPM: 1600 + index * 10, Spd: 10 + index / 10, Thrtl: 50, Tmp1: 35, Tmp2: 28, AH: index / 100, Lap: 1, Gear: 1, Brk: 0, Lat: 52, Lon: -1, synthetic: true, custom: { value: index, unit: 'widgets' }, sourceTime: new Date().toISOString() });
  const url = new URL(target);
  if (mode === 'GET') url.pathname = url.pathname.replace(/\/$/, '') + '/' + encodeURIComponent(raw);
  const start = performance.now();
  const response = await fetch(url, { method: mode, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Basic ${Buffer.from(`424:${password}`).toString('base64')}`, 'Content-Type': 'application/json' }, ...(mode === 'POST' ? { body: raw } : {}) });
  // Only status and timing, never secrets, URLs, payloads or provider errors.
  console.log(JSON.stringify({ sample: index + 1, status: response.status, requestMs: Math.round(performance.now() - start) }));
  if (response.status !== 204) throw new Error(`Upload rejected (${response.status}); stopped without retries.`);
  if (index + 1 < count) await new Promise(resolve => setTimeout(resolve, 3000));
}
