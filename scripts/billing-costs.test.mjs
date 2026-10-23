import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { dailyCloudCostText } = require('../functions/utils/billingCosts');
const config = { table: 'perrinn-d5fc1.billing_export.gcp_billing_export_v1_006A37_57ED1D_5E4A00', location: 'EU', now: new Date('2026-10-20T23:45:00Z') };
const row = (day, currency, amount) => ({ f: [day, currency, amount].map(v => ({ v })) });
const current = row('2026-10-18', 'GBP', '2.35');
const previous = row('2026-10-17', 'GBP', '2.75');
const result = rows => ({ data: { jobComplete: true, rows } });

test('one capped parameterized query returns net cost and comparison in UTC', async () => {
  let calls = 0;
  const text = await dailyCloudCostText({ ...config, query: async request => {
    calls++;
    assert.equal(request.maximumBytesBilled, '104857600');
    assert.equal(request.maxResults, 32);
    assert.equal(request.jobTimeoutMs, '20000');
    assert.equal(request.timeoutMs, 15000);
    assert.equal(request.useLegacySql, false);
    assert.deepEqual(request.queryParameters.map(p => p.parameterValue.value), ['perrinn-d5fc1', '2026-10-01', '2026-10-19']);
    assert.match(request.query, /project.id = @project/);
    assert.match(request.query, /SUM\(CAST\(credit.amount AS NUMERIC\)\)/);
    assert.match(request.query, /IFNULL/);
    assert.match(request.query, /LIMIT 32/);
    return result([previous, current]);
  } });
  assert.equal(calls, 1);
  assert.equal(text, 'Google Cloud cost: £2.35 on 2026-10-18 UTC · down £0.40 from previous day · provisional, after credits.\nGoogle Cloud month-to-date (2026-10): unavailable.');
});

test('missing or unsafe configuration never submits a query', async () => {
  for (const overrides of [{ table: '' }, { location: '' }, { table: config.table + '`; SELECT 1' }]) {
    assert.equal(await dailyCloudCostText({ ...config, ...overrides, query: () => assert.fail('unexpected query') }), 'Google Cloud cost unavailable.\nGoogle Cloud month-to-date (2026-10): unavailable.');
  }
});

test('missing, incomplete, malformed or mixed-currency results never become zero costs', async () => {
  for (const response of [result([]), result([previous]), { data: { jobComplete: false } },
    { data: { jobComplete: true, errors: [{}], rows: [current] } },
    { data: { jobComplete: true, pageToken: 'next', rows: [current] } },
    result([current, row('2026-10-18', 'USD', '1')]),
    result([current, row('2026-10-17', 'USD', '1')]),
    result([row('2026-10-18', 'GBP', null)]), result([row('2026-10-18', 'GBP', 'NaN')]),
    result([row('2026-10-18', 'GBP', 'Infinity')]), result([row('2026-10-18', 'bad', '2')])]) {
    assert.equal(await dailyCloudCostText({ ...config, query: async () => response }), 'Google Cloud cost unavailable.\nGoogle Cloud month-to-date (2026-10): unavailable.');
  }
});

test('valid zero and negative totals are preserved; missing prior day omits comparison', async () => {
  assert.equal(await dailyCloudCostText({ ...config, query: async () => result([row('2026-10-18', 'GBP', '0')]) }), 'Google Cloud cost: £0.00 on 2026-10-18 UTC · provisional, after credits.\nGoogle Cloud month-to-date (2026-10): unavailable.');
  assert.match(await dailyCloudCostText({ ...config, query: async () => result([row('2026-10-18', 'GBP', '-1')]) }), /-£1.00/);
  assert.match(await dailyCloudCostText({ ...config, query: async () => result([current, row('2026-10-17', 'GBP', '1')]) }), /up £1.35/);
  assert.match(await dailyCloudCostText({ ...config, query: async () => result([current, row('2026-10-17', 'GBP', '2.35')]) }), /unchanged from previous day/);
});

test('UTC report dates cross month/year and leap-day boundaries', async () => {
  for (const [now, expected] of [['2027-01-02T00:00:00Z', '2026-12-31'], ['2028-03-02T00:00:00Z', '2028-02-29']]) {
    const text = await dailyCloudCostText({ ...config, now: new Date(now), query: async request => {
      const start = new Date(`${expected}T00:00:00Z`); start.setUTCDate(start.getUTCDate() - 1);
      const monthStart = `${now.slice(0, 7)}-01`;
      assert.equal(request.queryParameters[1].parameterValue.value, [start.toISOString().slice(0, 10), monthStart].sort()[0]);
      return result([row(expected, 'GBP', '1')]);
    } });
    assert.ok(text.includes(expected));
  }
});

test('API errors fail open once without exposing error messages', async () => {
  let calls = 0; const warnings = [];
  const text = await dailyCloudCostText({ ...config, logger: { warn: (...args) => warnings.push(args) }, query: async () => {
    calls++; throw Object.assign(new Error('private billing response'), { code: 403 });
  } });
  assert.equal(text, 'Google Cloud cost unavailable.\nGoogle Cloud month-to-date (2026-10): unavailable.');
  assert.equal(calls, 1);
  assert.equal(warnings.length, 1);
  assert.ok(!JSON.stringify(warnings).includes('private billing response'));
});

test('production transport uses runtime credentials, a deadline, and disabled retries', async () => {
  const requests = []; const module = { exports: {} };
  runInNewContext(readFileSync(new URL('../functions/utils/billingCosts.js', import.meta.url), 'utf8'), {
    module, console, Intl, Date,
    require: name => {
      assert.equal(name, 'googleapis');
      return { google: { auth: { GoogleAuth: class {
        constructor(options) { assert.equal(options.scopes[0], 'https://www.googleapis.com/auth/bigquery'); }
        async getClient() { return { request: async request => { requests.push(request); return result([current]); } }; }
      } } } };
    },
  });
  await module.exports.dailyCloudCostText(config);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://bigquery.googleapis.com/bigquery/v2/projects/perrinn-d5fc1/queries');
  assert.equal(requests[0].retry, false);
  assert.equal(requests[0].timeout, 25000);
});

const monthRows = (count = 18) => Array.from({ length: count }, (_, index) => row(`2026-10-${String(index + 1).padStart(2, '0')}`, 'GBP', index === 0 ? '-1' : '1'));

test('month-to-date sums every eligible day including credits and explicit zero', async () => {
  const rows = monthRows(); rows[1] = row('2026-10-02', 'GBP', '0');
  const text = await dailyCloudCostText({ ...config, query: async () => result(rows) });
  assert.match(text, /Google Cloud month-to-date \(2026-10-01–2026-10-18 UTC\): £15.00/);
});

test('missing interior days keep daily reporting but never understate month-to-date', async () => {
  const rows = monthRows(); rows.splice(3, 1);
  const text = await dailyCloudCostText({ ...config, query: async () => result(rows) });
  assert.match(text, /Google Cloud cost: £1.00 on 2026-10-18/);
  assert.match(text, /month-to-date \(2026-10\): unavailable/);
});

test('unexpected historical dates, duplicate days and excess rows fail closed', async () => {
  for (const rows of [[...monthRows(), row('2026-10-01', 'GBP', '1')],
    [...monthRows(), row('2026-09-30', 'GBP', '1')],
    Array.from({ length: 32 }, () => current)]) {
    assert.match(await dailyCloudCostText({ ...config, query: async () => result(rows) }), /^Google Cloud cost unavailable/);
  }
});

test('new month waits for eligible dates, then excludes prior-month comparison', async () => {
  for (const day of [1, 2, 3]) {
    const text = await dailyCloudCostText({ ...config, now: new Date(`2027-01-0${day}T00:00:00Z`), query: async request => {
      assert.ok(request.queryParameters[1].parameterValue.value >= '2026-12-29');
      return result([row(day === 1 ? '2026-12-30' : '2026-12-31', 'GBP', '9'), ...(day === 3 ? [row('2027-01-01', 'GBP', '0')] : [])]);
    } });
    assert.match(text, day < 3 ? /month-to-date \(2027-01\): unavailable/ : /month-to-date \(2027-01-01–2027-01-01 UTC\): £0.00/);
  }
});
