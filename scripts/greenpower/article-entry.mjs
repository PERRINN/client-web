// Keep the existing Angular SPA, with route-specific metadata for crawlers that do not run JS.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

export function renderArticleEntry(html, page, tags) {
  const escape = text => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const unescape = text => text.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  const defaults = { title: unescape(/<title>(.*?)<\/title>/s.exec(html)?.[1] || ''), meta: {} };
  for (const tag of tags) {
    const key = tag.name ? 'name' : 'property';
    const selector = `${key}="${tag[key]}"`;
    const pattern = new RegExp(`<meta\\s+[^>]*${key}=["']${tag[key]}["'][^>]*>`, 'i');
    const old = pattern.exec(html)?.[0];
    defaults.meta[selector] = old ? unescape(/content=["']([^"']*)["']/.exec(old)?.[1] || '') : null;
    const replacement = `<meta ${selector} content="${escape(tag.content)}">`;
    html = old ? html.replace(old, replacement) : html.replace('</head>', replacement + '\n</head>');
  }
  html = html.replace(/<title>.*?<\/title>/s, `<title>${escape(page.title)}</title>`);
  const data = JSON.stringify(defaults).replaceAll('<', '\\u003c');
  return html.replace('</head>', `<script id="greenpower-page-defaults" type="application/json">${data}</script>\n</head>`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = await readFile('src/app/greenpower-launch/greenpowerContent.ts', 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText;
  const { GREENPOWER_PAGE, GREENPOWER_META } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
  const html = renderArticleEntry(await readFile('dist/index.html', 'utf8'), GREENPOWER_PAGE, GREENPOWER_META);
  await writeFile('dist/424-greenpower-2027.html', html);
  console.log('Generated public Greenpower article metadata.');
}
