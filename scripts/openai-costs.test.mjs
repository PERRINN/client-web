import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { dailyOpenaiCostText } = require('../functions/utils/openaiCosts');
const config = { apiKey: 'test-secret', projectId: 'proj_perrinn', now: new Date('2026-10-22T23:45:00Z') };
const start = Date.parse('2026-10-20T00:00:00Z') / 1000;
const bucket = (time = start, value = 0.12, currency = 'usd') => ({
  object: 'bucket', start_time: time, end_time: time + 86400,
  results: [{ object: 'organization.costs.result', amount: { value, currency }, project_id: null }],
});
const page = (...data) => ({ object: 'page', data, has_more: false, next_page: null });
const response = data => ({ ok: true, json: async () => data });
const render = data => dailyOpenaiCostText({ ...config, fetcher: async () => response(data) });

test('one project-filtered request covers two UTC days with deadline and no redirects', async () => {
  let calls = 0;
  const text = await dailyOpenaiCostText({ ...config, fetcher: async (url, options) => {
    calls++;
    assert.equal(url.origin + url.pathname, 'https://api.openai.com/v1/organization/costs');
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      start_time: String(start - 86400), end_time: String(start + 86400),
      bucket_width: '1d', limit: '2', 'project_ids[]': 'proj_perrinn',
    });
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return response(page(bucket(start - 86400, 0.32), bucket()));
  } });
  assert.equal(calls, 1);
  assert.equal(text, 'OpenAI cost: USD\u00a00.12 on 2026-10-20 UTC · down USD\u00a00.20 from previous day · provisional.');
});

test('missing configuration never falls back to organization costs', async () => {
  for (const overrides of [{ apiKey: '' }, { projectId: '' }, { projectId: undefined }, { projectId: 'invalid' }]) {
    assert.equal(await dailyOpenaiCostText({ ...config, ...overrides, fetcher: () => assert.fail('unexpected request') }), 'OpenAI cost unavailable.');
  }
});

test('missing, partial, malformed and unexpected data never becomes a zero bill', async () => {
  const empty = bucket(); empty.results = [];
  const wrongProject = bucket(); wrongProject.results[0].project_id = 'proj_other';
  const duplicateRows = bucket(); duplicateRows.results.push(duplicateRows.results[0]);
  const malformed = bucket(); malformed.end_time++;
  for (const data of [null, {}, page(), page(empty), page(bucket(start - 86400)),
    { ...page(bucket()), has_more: true }, { ...page(bucket()), next_page: 'next' },
    page(bucket(), bucket()), page(bucket(start + 86400)), page(wrongProject), page(duplicateRows), page(malformed),
    page(bucket(start, null)), page(bucket(start, '1')), page(bucket(start, NaN)), page(bucket(start, Infinity)),
    page(bucket(start, 1, 'bad-currency')), page(bucket(), bucket(start - 86400, 1, 'gbp'))]) {
    assert.equal(await render(data), 'OpenAI cost unavailable.');
  }
});

test('explicit zero, negative, up, unchanged and absent prior day are reported', async () => {
  assert.equal(await render(page(bucket(start, 0))), 'OpenAI cost: USD\u00a00.00 on 2026-10-20 UTC · provisional.');
  assert.match(await render(page(bucket(start, -1))), /-USD\s1.00/);
  assert.match(await render(page(bucket(), bucket(start - 86400, 0))), /up USD\s0.12/);
  assert.match(await render(page(bucket(), bucket(start - 86400, 0.12))), /unchanged from previous day/);
  const empty = bucket(start - 86400); empty.results = [];
  assert.doesNotMatch(await render(page(bucket(), empty)), /previous day/);
});

test('UTC reporting crosses year, month and leap-day boundaries', async () => {
  for (const [now, date] of [['2027-01-02T00:00:00Z', '2026-12-31'], ['2028-03-02T00:00:00Z', '2028-02-29']]) {
    const text = await dailyOpenaiCostText({ ...config, now: new Date(now), fetcher: async url => {
      assert.equal(Number(url.searchParams.get('end_time')), Date.parse(date) / 1000 + 86400);
      return response(page(bucket(Date.parse(date) / 1000)));
    } });
    assert.ok(text.includes(date));
  }
});

test('HTTP errors, timeouts and invalid JSON fail once without private details in logs', async () => {
  for (const failure of [async () => ({ ok: false, status: 403, json: () => assert.fail('read error body') }),
    async () => { throw new Error('test-secret private billing'); },
    async () => ({ ok: true, json: async () => { throw new Error('private billing JSON'); } })]) {
    const warnings = []; let calls = 0;
    const text = await dailyOpenaiCostText({ ...config, logger: { warn: (...args) => warnings.push(args) },
      fetcher: async () => { calls++; return failure(); } });
    assert.equal(text, 'OpenAI cost unavailable.');
    assert.equal(calls, 1);
    assert.equal(warnings.length, 1);
    assert.doesNotMatch(JSON.stringify(warnings), /test-secret|private billing/);
  }
});
