import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);

test('installed app allows both portrait and landscape orientation', () => {
  const manifest = JSON.parse(readFileSync(new URL('src/manifest.json', root), 'utf8'));
  assert.equal(manifest.orientation, 'any');
});

test('client does not lock screen orientation or block landscape with a rotation notice', () => {
  const files = readdirSync(new URL('src/app/', root), { recursive: true })
    .filter(file => /\.(ts|html|css)$/.test(file));
  for (const file of files) {
    const source = readFileSync(new URL(`src/app/${file}`, root), 'utf8');
    assert.doesNotMatch(source, /orientation\s*(?:\?\.|\.)\s*lock\s*(?:\?\.)?\s*\(/, file);
    assert.doesNotMatch(source, /MobileOrientationService|landscapeBlocked\$|orientationNotice|Rotate your device to portrait/, file);
  }
});
