import assert from 'node:assert/strict';
import test from 'node:test';
import { renderArticleEntry } from './article-entry.mjs';

test('article entry replaces social metadata and retains exact defaults for SPA navigation', () => {
  const html = '<html><head><title>PERRINN</title><meta name="description" content="Team &amp; car"><meta property="og:image" content="old.jpg"><base href="/"></head><body><app-root></app-root><script src="main.js"></script></body></html>';
  const tags = [{ name: 'description', content: 'Build "424" & race' }, { property: 'og:image', content: 'race.webp' }, { property: 'og:type', content: 'article' }];
  const rendered = renderArticleEntry(html, { title: '424 <2027>' }, tags);
  assert.match(rendered, /<title>424 &lt;2027&gt;<\/title>/);
  assert.match(rendered, /content="Build &quot;424&quot; &amp; race"/);
  assert.equal((rendered.match(/property="og:image"/g) || []).length, 1);
  assert.match(rendered, /<base href="\/">/);
  assert.match(rendered, /<app-root><\/app-root><script src="main.js">/);
  const defaults = JSON.parse(/type="application\/json">(.*?)<\/script>/.exec(rendered)[1]);
  assert.deepEqual(defaults, { title: 'PERRINN', meta: { 'name="description"': 'Team & car', 'property="og:image"': 'old.jpg', 'property="og:type"': null } });
});

test('metadata defaults cannot inject a closing script tag', () => {
  const rendered = renderArticleEntry('<head><title>&lt;/script&gt;</title></head>', {title:'424'}, []);
  assert.match(rendered, /"title":"\\u003c\/script>"/);
});
