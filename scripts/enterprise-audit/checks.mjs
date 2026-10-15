// Pure policy checks kept separate so regressions can be tested without network access.
export function headerFindings(headers) {
  const results = [];
  const hsts = headers['strict-transport-security'] || '';
  const maxAge = hsts.match(/max-age\s*=\s*(\d+)/i)?.[1];
  results.push({ status: Number(maxAge) >= 15552000 ? 'PASS' : 'WARNING',
    check: 'HSTS', detail: hsts || 'Missing (browser HTTPS persistence unavailable)' });
  for (const name of ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'permissions-policy']) {
    const value = headers[name];
    const valid = value && (name !== 'x-content-type-options' || value.toLowerCase() === 'nosniff');
    results.push({ status: valid ? 'INFO' : 'WARNING', check: name,
      detail: value ? `${value}; presence alone does not validate policy effectiveness` : 'Missing' });
  }
  return results;
}

export function corsAllowed(headers, origin, method = 'POST', requestedHeaders = ['content-type']) {
  const allowOrigin = headers['access-control-allow-origin'];
  const methods = (headers['access-control-allow-methods'] || '').toUpperCase().split(/\s*,\s*/);
  const allowedHeaders = (headers['access-control-allow-headers'] || '').toLowerCase().split(/\s*,\s*/);
  return (allowOrigin === '*' || allowOrigin === origin) && methods.includes(method)
    && requestedHeaders.every(header => allowedHeaders.includes(header.toLowerCase()) || allowedHeaders.includes('*'));
}

export function resourceUrls(html, base) {
  // Only load-bearing tags; metadata/navigation URLs are not mixed-content resources.
  const urls = [];
  for (const tag of html.matchAll(/<(script|link|img|iframe|source|video|audio)\b[^>]*>/gi)) {
    if (tag[1].toLowerCase() === 'link' && !/rel\s*=\s*["'][^"']*(stylesheet|preload|icon|manifest)/i.test(tag[0])) continue;
    for (const attr of tag[0].matchAll(/\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi)) {
      try { urls.push(new URL(attr[1].replaceAll('&amp;', '&'), base)); } catch { /* invalid markup */ }
    }
  }
  return urls;
}
