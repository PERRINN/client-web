// Render the real Angular templates/styles with isolated synthetic services.
// No Firebase initialization, account access or production network requests.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = await mkdtemp(resolve(tmpdir(), 'greenpower-ui-'));
const folder = `${root}/src/app/greenpower-telemetry`;
await writeFile(`${output}/entry.ts`, `
import 'zone.js';
import '@angular/compiler';
import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { Title } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { GreenpowerTelemetryComponent } from '${folder}/greenpower-telemetry.component';
import { GreenpowerChartComponent } from '${folder}/greenpower-chart.component';
import { GreenpowerTelemetryService } from '${folder}/greenpowerTelemetry.service';
import { PrototypeGalleryComponent } from '${root}/src/app/prototypes/prototype-gallery.component';
GreenpowerTelemetryComponent.ctorParameters = () => [{type: GreenpowerTelemetryService}, {type: ChangeDetectorRef}, {type: Title}];
TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
TestBed.configureTestingModule({imports:[CommonModule, RouterModule.forRoot([])], declarations:[GreenpowerTelemetryComponent,GreenpowerChartComponent,PrototypeGalleryComponent]});
const fixture = TestBed.createComponent(GreenpowerTelemetryComponent);
document.querySelector('.contentCard').append(fixture.nativeElement); fixture.autoDetectChanges();
const service = fixture.componentInstance.telemetry;
window.telemetryHarness = {
  state(name) {
    service.access = name === 'signed-out' ? 'signed-out' : 'signed-in';
    service.error = name === 'error' ? 'Could not load telemetry. Check your connection and try again.' : '';
    service.loading = name === 'loading'; service.more = name === 'more';
    service.connected = true;
    if (name === 'empty') { service.channels = []; service.latest = undefined; }
    else service.seed(name === 'stale' ? Date.now()-60000 : Date.now());
    service.changed.next(); fixture.detectChanges();
  },
  gallery() { fixture.destroy(); const gallery = TestBed.createComponent(PrototypeGalleryComponent); document.querySelector('.contentCard').append(gallery.nativeElement); gallery.detectChanges(); }
};
`);
const stub = `
import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { channelsFor, londonDay } from '${folder}/greenpowerData';
@Injectable()
export class GreenpowerTelemetryService {
 changed=new Subject(); access='signed-in'; live=true; day=londonDay(); connected=true; loading=false; loadingDates=false; error=''; datesError=''; more=false; moreDates=false; dates=[]; channels=[]; latest; start=0; end=0;
 constructor(){this.seed(Date.now());}
 seed(now){ const samples=Array.from({length:300},(_,i)=>({id:String(i),receivedAt:now-(299-i)*3000,source:'synthetic',raw:JSON.stringify({Vt:24+Math.sin(i/10),A:30+Math.cos(i/20)*5,Spd:10+Math.sin(i/20),Tmp1:30+i/1000,Lat:52,Lon:-1,custom:{value:i%10,unit:'widgets'},status:'running'})})); this.latest=samples.at(-1);this.start=samples[0].receivedAt;this.end=now;this.channels=channelsFor(samples,this.latest); }
 async select(day,live=false){this.day=day;this.live=live;this.seed(live?Date.now():Date.parse(day+'T15:00:00Z'));this.changed.next();}
 async loadDates(){this.dates=['2026-10-18','2026-10-17'];this.changed.next();}
 async loadMore(){this.more=false;this.changed.next();}
 tick(){}
}
`;
await build({ entryPoints: [`${output}/entry.ts`], outfile: `${output}/bundle.js`, bundle: true, format: 'iife', platform: 'browser', nodePaths: [`${root}/node_modules`], tsconfigRaw: { compilerOptions: { experimentalDecorators: true } }, plugins: [{ name: 'isolated-angular-ui', setup(plugin) {
  plugin.onLoad({ filter: /greenpowerTelemetry\.service\.ts$/ }, () => ({ contents: stub, loader: 'ts', resolveDir: folder }));
  plugin.onLoad({ filter: /\.component\.ts$/ }, async args => {
    let source = await readFile(args.path, 'utf8');
    source = await replaceResource(source, 'templateUrl', dirname(args.path));
    const match = /styleUrls:\s*\[\s*'([^']+)'\s*\]/.exec(source);
    if (match) source = source.replace(match[0], `styles: [${JSON.stringify(await readFile(resolve(dirname(args.path), match[1]), 'utf8'))}]`);
    return { contents: source, loader: 'ts', resolveDir: dirname(args.path) };
  });
} }] });
async function replaceResource(source, name, base) {
  const match = new RegExp(`${name}:\\s*'([^']+)'`).exec(source);
  return match ? source.replace(match[0], `template: ${JSON.stringify(await readFile(resolve(base, match[1]), 'utf8'))}`) : source;
}
const shellStyle = (await readFile(`${root}/src/app/app.component.css`, 'utf8')).replaceAll(':host', '.shell-harness');
const html = `<!doctype html><html><head><base href="/"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${await readFile(`${root}/src/styles.css`, 'utf8')} ${shellStyle}</style></head><body><div class="shell-harness"><div class="appShell sidebarShell"><header class="mobileShellHeader">PERRINN</header><aside class="topNav shellSidebar"></aside><div id="main_container"><div class="contentWrap"><div class="contentCard"></div></div></div></div></div><script src="/bundle.js"></script></body></html>`;
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/bundle.js' ? await readFile(`${output}/bundle.js`) : html);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => !!window.telemetryHarness);
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844], ['small-mobile', 320, 740]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.telemetryHarness.state('live'));
    assert.equal(await page.locator('app-greenpower-chart').count(), 7);
    assert.equal(await page.locator('.reading').count(), 8);
    assert.equal(await page.locator('a[href="/prototypes"]').count(), 0);
    assert.ok(await page.locator('.trace').first().getAttribute('d'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} horizontal overflow`);
    const before = await page.locator('h1').boundingBox();
    await page.evaluate(() => window.telemetryHarness.state('stale'));
    assert.match(await page.locator('.status').innerText(), /Stale/);
    assert.equal((await page.locator('h1').boundingBox()).y, before.y);
    await page.getByRole('button', { name: 'Load history', exact: true }).click();
    await page.getByLabel('Recorded day').selectOption('2026-10-18');
    assert.match(await page.locator('.status').innerText(), /History/);
    await page.screenshot({ path: `${output}/${name}-history.png` });
    await page.locator('app-greenpower-chart').last().scrollIntoViewIfNeeded();
    assert.equal(await page.locator('app-greenpower-chart').last().isVisible(), true);
    await page.screenshot({ path: `${output}/${name}-history-bottom.png` });
    await page.locator('h1').scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Live', exact: true }).click();
    for (const state of ['loading', 'empty', 'error', 'more', 'signed-out']) {
      await page.evaluate(state => window.telemetryHarness.state(state), state);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}/${state} overflow`);
      if (state === 'signed-out') { assert.equal(await page.locator('app-greenpower-chart').count(), 0); await page.getByRole('link', { name: 'Sign in to view telemetry' }).waitFor(); }
      if (state === 'more') { await page.getByRole('button', { name: 'Load remaining data' }).click(); await page.locator('.continuation').waitFor({ state: 'hidden' }); }
    }
    await page.evaluate(() => window.telemetryHarness.state('live'));
  }
  await page.evaluate(() => window.telemetryHarness.gallery());
  const tile = page.locator('a.prototype-card').filter({ hasText: 'greenpower-telemetry' });
  assert.equal(await tile.count(), 0);
  const apps = await readFile(`${root}/src/app/apps.component.html`, 'utf8');
  assert.match(apps, /routerLink="\/424-greenpower-telemetry"/);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ output, widths: [1440, 390, 320], states: ['live', 'history', 'stale', 'loading', 'empty', 'error', 'continuation', 'signed-out'], discovery: 'Apps only; absent from prototype gallery', errors }));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
