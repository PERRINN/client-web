// Node built-ins only. Fixed public targets; no auth, data reads, POSTs or deployments.
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { resolve4, resolve6, resolveCname, resolveNs, resolveCaa } from 'node:dns/promises';
import { connect } from 'node:tls';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { headerFindings, corsAllowed, resourceUrls } from './checks.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const inventory = JSON.parse(await readFile(new URL('./dependencies.json', import.meta.url)));
const args = process.argv.slice(2);
const offline = args.includes('--offline');
const strict = args.includes('--strict');
const outputIndex = args.indexOf('--output');
if (args.some((arg, i) => !['--offline', '--strict', '--output'].includes(arg) && !(outputIndex >= 0 && i === outputIndex + 1))
    || (outputIndex >= 0 && (!args[outputIndex + 1] || args[outputIndex + 1].startsWith('--')))) {
  throw new Error('Usage: node scripts/enterprise-audit/audit.mjs [--offline] [--strict] [--output report.json]');
}
const report = { generatedAt: new Date().toISOString(), mode: offline ? 'offline' : 'live',
  scope: 'Public transport/configuration only; not an authenticated app, WCAG, or reputation certification',
  findings: [], dns: {}, tls: {}, requests: [], sourceHosts: {}, dependencies: inventory };
const add = (status, check, detail) => report.findings.push({ status, check, detail });
const approvedHosts = new Set(Object.values(inventory).flatMap(group => Object.keys(group)));
const publicHosts = new Set([...Object.keys(inventory.core), ...Object.keys(inventory.conditional)]);
const timeout = 12000;
const maxBytes = 6 * 1024 * 1024;
// Do not persist query strings, response bodies, cookies, keys or user content.
const safeUrl = value => { const url = new URL(value); return url.origin + url.pathname; };

async function request(url, method = 'GET', headers = {}) {
  const target = new URL(url);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) throw new Error('Audit forbids state-changing HTTP methods');
  if (!publicHosts.has(target.hostname) || !['http:', 'https:'].includes(target.protocol)
      || target.username || target.password || (target.port && !['80', '443'].includes(target.port))) {
    throw new Error('Request target outside fixed public audit scope');
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = transport(target, { method, headers: { 'User-Agent': 'PERRINN-public-enterprise-audit/1.0', ...headers } }, res => {
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) res.destroy(new Error('Response exceeds 6 MiB audit cap'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        const evidenceHeaders = Object.fromEntries(Object.entries(res.headers).filter(([key]) =>
          /^(strict-transport-security|content-security-policy(-report-only)?|x-content-type-options|referrer-policy|permissions-policy|x-frame-options|content-type|cache-control|access-control-allow-(origin|methods|headers|credentials))$/.test(key)));
        const result = { url: safeUrl(url), method, status: res.statusCode, headers: evidenceHeaders,
          location: res.headers.location ? safeUrl(new URL(res.headers.location, url)) : undefined };
        report.requests.push(result);
        resolve({ ...result, body: Buffer.concat(chunks).toString('utf8'), rawLocation: res.headers.location });
      });
    });
    // Absolute deadline includes DNS, connect and response, rather than idle timeout only.
    const timer = setTimeout(() => req.destroy(new Error('12s request deadline exceeded')), timeout);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end();
  });
}

async function chain(start) {
  let current = start;
  const visited = new Set();
  const hops = [];
  for (let i = 0; i < 6; i++) {
    if (visited.has(current)) throw new Error('Redirect loop');
    visited.add(current);
    const result = await request(current);
    hops.push(`${result.status} ${safeUrl(current)}`);
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      if (!result.rawLocation) throw new Error('Redirect without Location');
      const next = new URL(result.rawLocation, current);
      if (next.protocol !== 'https:') throw new Error('Redirect does not upgrade/preserve HTTPS');
      if (!['perrinn.com', 'www.perrinn.com'].includes(next.hostname)) throw new Error('Unexpected cross-domain redirect');
      current = next.href;
    } else {
      if (new URL(current).protocol !== 'https:') throw new Error('Entry point remains on HTTP');
      if (result.status !== 200 || !result.body.includes('<app-root')) throw new Error(`App shell unavailable: ${result.status}`);
      add('PASS', `Entry ${start}`, hops.join(' → '));
      return { ...result, finalUrl: current };
    }
  }
  throw new Error('More than five redirects');
}

async function certificate(host) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port: 443, servername: host, rejectUnauthorized: true }, () => {
      const cert = socket.getPeerCertificate();
      const daysRemaining = Math.floor((Date.parse(cert.valid_to) - Date.now()) / 86400000);
      const names = (cert.subjectaltname || '').split(', ');
      report.tls[host] = { authorized: socket.authorized,
        matchingSubjectAltNames: names.filter(name => name === `DNS:${host}`), certificateNameCount: names.length,
        issuer: cert.issuer, validFrom: cert.valid_from, validTo: cert.valid_to, daysRemaining, protocol: socket.getProtocol() };
      add(daysRemaining < 14 ? 'WARNING' : 'PASS', `TLS ${host}`,
        `Trusted chain and hostname verified; expires ${cert.valid_to} (${daysRemaining} days); ${socket.getProtocol()}`);
      socket.end();
      resolve();
    });
    const timer = setTimeout(() => socket.destroy(new Error('12s TLS deadline exceeded')), timeout);
    socket.on('close', () => clearTimeout(timer));
    socket.on('error', reject);
  });
}

async function attempt(check, fn, severity = 'FAIL') {
  try { return await fn(); } catch (error) { add(severity, check, `${error.code || 'ERROR'}: ${error.message}`); }
}

async function sourceInventory(dir) {
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== 'assets') await sourceInventory(relative);
    } else if (/\.(ts|html|css|json)$/.test(entry.name) && !/environment(\.dev)?\.ts$/.test(entry.name)) {
      const content = await readFile(path.join(root, relative), 'utf8');
      for (const match of content.matchAll(/(?:https?|wss?):\/\/([a-z0-9.-]+)(?=[:/\s"'`<]|$)/gi)) {
        const host = match[1].toLowerCase();
        (report.sourceHosts[host] ||= []);
        if (!report.sourceHosts[host].includes(relative)) report.sourceHosts[host].push(relative);
      }
    }
  }
}

await sourceInventory('src');
// Public auth/DB config may be gitignored and absent in a credential-free CI checkout.
const appModule = await readFile(path.join(root, 'src/app/app.module.ts'), 'utf8');
if (/authDodash\s*:/.test(appModule)) add('WARNING', 'Firebase auth configuration',
  'app.module.ts maps authDodash instead of authDomain. Email/password does not require redirect auth; helpers/future OAuth may fail.');
const rules = await readFile(path.join(root, 'firestore.rules'), 'utf8');
if (/match\s*\/\{document=\*\*\}\s*\{\s*allow read\s*;/.test(rules)) add('FAIL', 'Repository Firestore privacy boundary',
  'Recursive allow read grants unauthenticated reads across all paths, including lastSeen and payment subcollections. Deployed rules were not read or tested.');
const storageRules = await readFile(path.join(root, 'storage.rules'), 'utf8');
if (/allow write:\s*if request.auth != null\s*;/.test(storageRules)) add('WARNING', 'Repository Storage boundary',
  'Any authenticated user can write every object path under the recursive match; no per-owner, size or content-type constraints. Deployed rules were not tested.');
const functionsCreate = await readFile(path.join(root, 'functions/createRevolutOrder.f.js'), 'utf8');
const functionsSync = await readFile(path.join(root, 'functions/syncRevolutOrderStatus.f.js'), 'utf8');
if (![functionsCreate, functionsSync].every(code => /verifyIdToken\s*\(/.test(code))) add('WARNING', 'Repository payment handlers',
  'Review createRevolutOrder/syncRevolutOrderStatus: no verifyIdToken call in these handlers; permissive CORS is not authorization. Deployment/IAM not verified.');
for (const [host, files] of Object.entries(report.sourceHosts)) {
  if (!approvedHosts.has(host)) add('WARNING', 'Unclassified source hostname', `${host}: ${files.join(', ')} (may be documentation/comment; review before allowlisting)`);
}
add('INFO', 'Inventory scope', 'Static source inventory excludes binary/assets and dev config; runtime database URLs, checkout redirects and SDK policy-dependent resources need browser validation.');

if (!offline) {
  // Bound all DNS operations as well as requests. No brute force, port scans or data queries.
  for (const host of Object.keys(inventory.core)) {
    const result = {};
    for (const [type, lookup] of [['A', resolve4], ['AAAA', resolve6], ['CNAME', resolveCname]]) {
      let timer;
      try {
        result[type] = await Promise.race([lookup(host), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('DNS deadline exceeded')), timeout);
        })]);
      } catch (error) { result[type] = { error: error.code || error.message }; }
      finally { clearTimeout(timer); }
    }
    report.dns[host] = result;
    add(Array.isArray(result.A) || Array.isArray(result.AAAA) ? 'PASS' : 'FAIL', `DNS ${host}`, JSON.stringify(result));
  }
  for (const [type, lookup] of [['NS', resolveNs], ['CAA', resolveCaa]]) {
    await attempt(`DNS ${type}`, async () => {
      let timer;
      try {
        const value = await Promise.race([lookup('perrinn.com'), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('DNS deadline exceeded')), timeout);
        })]);
        report.dns['perrinn.com'][type] = value;
        add('INFO', `DNS ${type}`, JSON.stringify(value));
      } finally { clearTimeout(timer); }
    }, 'INFO');
  }
  for (const host of ['perrinn.com', 'www.perrinn.com']) await attempt(`TLS ${host}`, () => certificate(host));
  let shell;
  for (const url of ['http://perrinn.com/', 'https://perrinn.com/', 'http://www.perrinn.com/', 'https://www.perrinn.com/']) {
    const result = await attempt(`Entry ${url}`, () => chain(url));
    if (url === 'https://perrinn.com/') shell = result;
  }
  if (shell) {
    report.findings.push(...headerFindings(shell.headers));
    if (!/no-cache|no-store|max-age=0(?:\D|$)/i.test(shell.headers['cache-control'] || '')) add('WARNING',
      'App shell caching', `Root HTML Cache-Control=${shell.headers['cache-control'] || 'missing'}; verify fresh deployments through corporate caches`);
    const resources = resourceUrls(shell.body, shell.finalUrl);
    const insecure = resources.filter(url => url.protocol === 'http:');
    add(insecure.length ? 'FAIL' : 'PASS', 'App shell mixed content', insecure.length
      ? insecure.map(safeUrl).join(', ') : 'No HTTP resource URLs in initial HTML (does not execute JavaScript)');
    const assets = [...new Map(resources.filter(url => url.origin === new URL(shell.finalUrl).origin && /\.(js|css)$/.test(url.pathname))
      .map(url => [url.href, url])).values()];
    // Angular production optimization inlines the Google Fonts CSS in the app shell.
    const inlineFonts = [...new Set([...shell.body.matchAll(/https:\/\/fonts\.gstatic\.com\/[^)\s"']+/g)].map(match => match[0]))];
    for (const url of inlineFonts.slice(0, 8)) await attempt('Inlined font availability/CORS', async () => {
      const result = await request(url, 'HEAD', { Origin: 'https://perrinn.com' });
      add(result.status === 200 && ['*', 'https://perrinn.com'].includes(result.headers['access-control-allow-origin']) ? 'PASS' : 'WARNING',
        `Inlined font ${safeUrl(url)}`, `${result.status}; ACAO=${result.headers['access-control-allow-origin'] || 'missing'}`);
    }, 'WARNING');
    if (inlineFonts.length > 8) add('WARNING', 'Font coverage', 'Only the first eight inline font URLs were checked');
    if (/<style\b[^>]*>[\s\S]*?url\(\s*["']?http:\/\//i.test(shell.body)) add('FAIL', 'Inline CSS mixed content', 'HTTP url() found in inline style block');
    for (const url of assets.slice(0, 12)) await attempt(`Asset ${safeUrl(url)}`, async () => {
      const result = await request(url);
      const expectedType = url.pathname.endsWith('.js') ? /javascript/ : /text\/css/;
      add(result.status === 200 && expectedType.test(result.headers['content-type'] || '') ? 'PASS' : 'FAIL',
        `Asset ${safeUrl(url)}`, `${result.status}; ${result.headers['content-type']}`);
      // Record hostnames only. Bundles can contain documentation URLs and dormant SDK providers.
      const hosts = [...new Set([...result.body.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(match => match[1]))];
      add('INFO', 'Public asset hostname candidates', `${url.pathname}: ${hosts.join(', ')}; not all are runtime dependencies`);
      if (url.pathname.endsWith('.css') && /url\(\s*["']?http:\/\//i.test(result.body)) add('FAIL', 'CSS mixed content', safeUrl(url));
    });
    if (assets.length > 12) add('WARNING', 'Asset coverage', 'Only the first 12 initial JS/CSS assets were checked');
    for (const route of ['/login', '/home', '/manifest.json', '/ngsw.json', '/ngsw-worker.js']) {
      await attempt(`Public ${route}`, async () => {
        const result = await request(`https://perrinn.com${route}`);
        const type = result.headers['content-type'] || '';
        const valid = route.endsWith('.json') ? /json/.test(type) : route.endsWith('.js') ? /javascript/.test(type) : result.body.includes('<app-root');
        add(result.status === 200 && valid ? 'PASS' : 'FAIL', `Public ${route}`, `${result.status}; ${type}`);
        if (route === '/ngsw-worker.js' && /immutable/.test(result.headers['cache-control'] || '')) add('WARNING',
          'Service worker caching', `Stable worker filename served with ${result.headers['cache-control']}; review update/revalidation behavior`);
      });
    }
    for (const url of resources.filter(url => url.hostname === 'fonts.googleapis.com').slice(0, 2)) {
      await attempt('Google Fonts stylesheet', async () => {
        const css = await request(url);
        add(css.status === 200 && /text\/css/.test(css.headers['content-type'] || '') ? 'PASS' : 'WARNING', 'Google Fonts stylesheet', `${css.status}; ${safeUrl(url)}`);
        const fontUrl = [...css.body.matchAll(/https:\/\/fonts\.gstatic\.com\/[^)\s"']+/g)][0]?.[0];
        if (fontUrl) {
          const font = await request(fontUrl, 'HEAD', { Origin: 'https://perrinn.com' });
          add(font.status === 200 && ['*', 'https://perrinn.com'].includes(font.headers['access-control-allow-origin']) ? 'PASS' : 'WARNING',
            'Font file availability/CORS', `${font.status}; ACAO=${font.headers['access-control-allow-origin'] || 'missing'}`);
        } else add('WARNING', 'Font file coverage', 'No fonts.gstatic.com URL found in stylesheet');
      }, 'WARNING');
    }
  }
  const probes = [
    ['https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword', ['content-type']],
    ['https://securetoken.googleapis.com/v1/token', ['content-type']],
    ['https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel', ['content-type', 'x-goog-api-client']],
    ['https://firebasestorage.googleapis.com/v0/b/perrinn-d5fc1.appspot.com/o', ['content-type', 'authorization', 'x-firebase-storage-version']],
    ['https://us-central1-perrinn-d5fc1.cloudfunctions.net/createRevolutOrder', ['content-type']],
    ['https://us-central1-perrinn-d5fc1.cloudfunctions.net/syncRevolutOrderStatus', ['content-type']]
  ];
  for (const [url, requestedHeaders] of probes) {
    for (const origin of ['https://perrinn.com', 'https://www.perrinn.com']) {
      await attempt(`CORS ${safeUrl(url)} (${origin})`, async () => {
        const result = await request(url, 'OPTIONS', { Origin: origin,
          'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': requestedHeaders.join(',') });
        const allowed = result.status >= 200 && result.status < 300 && corsAllowed(result.headers, origin, 'POST', requestedHeaders);
        add(allowed ? 'PASS' : 'WARNING', `CORS preflight ${safeUrl(url)} (${origin})`,
          `${result.status}; ACAO=${result.headers['access-control-allow-origin'] || 'missing'}; methods=${result.headers['access-control-allow-methods'] || 'missing'}; requested headers=${requestedHeaders.join(',')}; preflight only, no functional/auth/rules assertion`);
      }, 'WARNING');
    }
  }
} else add('INFO', 'Live checks skipped', '--offline selected; no DNS/HTTP/TLS requests performed');

add('WARNING', 'End-to-end verification outstanding', 'Corporate proxy/categories, TLS inspection, authenticated login/token renewal, Firestore streaming/writes, uploads and checkout require an authorized browser test. No reputation/blocklist certification performed.');
report.summary = Object.fromEntries(['PASS', 'WARNING', 'FAIL', 'INFO'].map(status =>
  [status, report.findings.filter(finding => finding.status === status).length]));
for (const finding of report.findings) console.log(`[${finding.status}] ${finding.check}: ${finding.detail}`);
console.log(JSON.stringify(report.summary));
if (outputIndex >= 0) {
  const output = path.resolve(args[outputIndex + 1]);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
// Default fails on confirmed failures; --strict also treats warnings as failures.
process.exitCode = report.summary.FAIL || (strict && report.summary.WARNING) ? 1 : 0;
