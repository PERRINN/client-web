import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/lastSeen.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
new Function('exports', code)(exports);
const { formatLastSeen } = exports;
const local = value => new Date(value).getTime();

test('uses local midnight and Monday boundaries, with most recent bucket first', () => {
  const now = local('2026-10-16T12:00:00');
  for (const [seen, label] of [
    ['2026-10-16T00:00:00', 'Seen today'],
    ['2026-10-15T23:59:59.999', 'Seen this week'],
    ['2026-10-12T00:00:00', 'Seen this week'],
    ['2026-10-11T23:59:59.999', 'Seen this month'],
    ['2026-10-01T00:00:00', 'Seen this month'],
    ['2026-09-30T23:59:59.999', 'Seen longer ago']
  ]) assert.equal(formatLastSeen(local(seen), now), label, seen);
  assert.equal(formatLastSeen(local('2026-10-18T00:00:00'), local('2026-10-19T00:00:00')), 'Seen this month');
});

test('weeks take precedence when crossing month and year boundaries', () => {
  assert.equal(formatLastSeen(local('2026-09-28T00:00:00'), local('2026-10-01T12:00:00')), 'Seen this week');
  assert.equal(formatLastSeen(local('2025-12-29T00:00:00'), local('2026-01-01T12:00:00')), 'Seen this week');
  assert.equal(formatLastSeen(local('2025-12-28T23:59:59.999'), local('2026-01-01T12:00:00')), 'Seen longer ago');
});

test('handles missing, invalid and future activity timestamps', () => {
  const now = local('2026-10-16T12:00:00');
  for (const seen of [undefined, null, 0, -1, NaN, Infinity, 9e15]) {
    assert.equal(formatLastSeen(seen, now), 'No activity recorded');
  }
  assert.equal(formatLastSeen(now + 86400000, now), 'Seen today');
});

test('calendar buckets handle midnight rollover and daylight-saving changes', () => {
  const seen = local('2026-03-28T23:30:00');
  assert.equal(formatLastSeen(seen, local('2026-03-28T23:59:59')), 'Seen today');
  assert.equal(formatLastSeen(seen, local('2026-03-29T00:00:00')), 'Seen this week');
  assert.equal(formatLastSeen(local('2026-03-29T00:00:00'), local('2026-03-29T23:30:00')), 'Seen today');
  assert.equal(formatLastSeen(local('2026-10-25T00:00:00'), local('2026-10-25T23:30:00')), 'Seen today');
});
