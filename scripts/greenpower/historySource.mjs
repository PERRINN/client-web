import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { validatePayload, londonDay } = require('../../functions/utils/greenpowerTelemetry');

export const CAR_ID = '69e36aa623ee354582952a26';
export const MAX_RECORDS = 100000;
export const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
export const sha256 = value => createHash('sha256').update(value).digest('hex');

// Retain each original JSON object verbatim, including number spelling and whitespace.
export function rawRecords(body) {
  if (Buffer.byteLength(body) > MAX_SOURCE_BYTES) throw new Error('Source exceeds 64 MiB');
  const parsed = JSON.parse(body);
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > MAX_RECORDS) throw new Error('Expected 1–100,000 source records');
  const raw = [];
  let depth = 0, quoted = false, escape = false, start = -1;
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (quoted) {
      if (escape) escape = false;
      else if (char === '\\') escape = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') {
      if (depth === 1) start = i;
      depth++;
    } else if (char === '}' || char === ']') {
      depth--;
      if (depth === 1 && start >= 0) { raw.push(body.slice(start, i + 1)); start = -1; }
    }
  }
  if (raw.length !== parsed.length || parsed.some(r => !r || Array.isArray(r) || typeof r !== 'object')) throw new Error('Expected JSON objects');
  return raw;
}

export function planImport(body, day, expectedCount, expectedSha256) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day + 'T00:00:00Z')) || day >= londonDay(Date.now())) throw new Error('Choose a completed historical UK day');
  const digest = sha256(body);
  if (expectedSha256 && digest !== expectedSha256) throw new Error('Source checksum differs from reviewed snapshot');
  const ids = new Set();
  const records = rawRecords(body).map(raw => {
    validatePayload(raw);
    const record = JSON.parse(raw), eventAt = Number(record.updated);
    if (record.carId !== CAR_ID || !Number.isSafeInteger(record.id) || record.id < 0) throw new Error('Wrong car or invalid source ID');
    if (typeof record.updated !== 'string' || !/^\d+$/.test(record.updated) || !Number.isSafeInteger(eventAt) || londonDay(eventAt) !== day) throw new Error('Invalid source timestamp or wrong UK day');
    const id = `echook:${CAR_ID}:${record.id}`;
    if (ids.has(id)) throw new Error('Duplicate source ID; reconcile before import');
    ids.add(id);
    return { id, eventAt, raw };
  }).sort((a, b) => a.eventAt - b.eventAt || a.id.localeCompare(b.id));
  if (records.length !== expectedCount) throw new Error('Source count differs from reviewed count');
  return { day, sourceSha256: digest, records, firstAt: records[0].eventAt, lastAt: records.at(-1).eventAt };
}

// One action: <=20 pages, 100,000 records, 64 MiB, concurrency 1, <=3 attempts/page.
// No conditional cache headers: a 304 without a saved body is an error, never EOF.
export async function fetchHistory({ start, end, fetcher = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end - start > 26 * 3600000) throw new Error('History window must be at most 26 hours');
  const parts = [];
  let bytes = 0, requests = 0, count = 0;
  for (let page = 1; page <= 20; page++) {
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        requests++;
        const url = new URL(`https://data.echook.uk/api/history/${CAR_ID}`);
        url.search = new URLSearchParams({ start, end, page, limit: 5000 }).toString();
        response = await fetcher(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
      } catch {
        if (attempt === 2) throw new Error('History request failed after three attempts');
        await sleep(1000 * 2 ** attempt); continue;
      }
      if (response.status === 429 || response.status >= 500) {
        const retry = response.headers.get('retry-after');
        const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : 1000 * 2 ** attempt;
        await response.body?.cancel();
        if (attempt === 2 || delay > 30000) throw new Error('Source unavailable or rate-limited; resume later');
        await sleep(delay); continue;
      }
      break;
    }
    if (!response?.ok || !/^application\/json\b/i.test(response.headers.get('content-type') || '')) throw new Error(`Expected JSON history (HTTP ${response?.status})`);
    let body = '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for await (const buffer of response.body) {
      bytes += buffer.length;
      if (bytes > MAX_SOURCE_BYTES) { await response.body.cancel().catch(() => {}); throw new Error('History exceeds 64 MiB action budget'); }
      body += decoder.decode(buffer, { stream: true });
    }
    body += decoder.decode();
    const rows = JSON.parse(body);
    if (!Array.isArray(rows) || rows.length > 5000) throw new Error('Unexpected history page');
    if (rows.length) parts.push(...rawRecords(body));
    count += rows.length;
    if (count > MAX_RECORDS) throw new Error('History exceeds record budget');
    if (rows.length < 5000) return { body: '[' + parts.join(',') + ']', count, requests, bytes };
  }
  throw new Error('History page budget reached; completeness is unproven');
}
