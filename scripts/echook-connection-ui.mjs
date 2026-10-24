// Real Angular page and gallery, synthetic serial stream, no Firebase initialization.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.cwd(), output = await mkdtemp(resolve(tmpdir(), 'echook-ui-'));
await writeFile(output + '/entry.ts', `
import 'zone.js'; import '@angular/compiler';
import { Component, NgZone } from '@angular/core';
import { CommonModule, PlatformLocation, BrowserPlatformLocation } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { Router, RouterModule } from '@angular/router';
import { EchookConnectionComponent } from '${root}/src/app/prototypes/echook-connection/echook-connection.component';
import { EchookConnectionService } from '${root}/src/app/prototypes/echook-connection/echookConnection.service';
import { PrototypeGalleryComponent } from '${root}/src/app/prototypes/prototype-gallery.component';
@Component({standalone:false,template:'<router-outlet />'}) class Host {}
EchookConnectionComponent.ctorParameters=()=>[{type:EchookConnectionService}];
EchookConnectionService.ctorParameters=()=>[{type:NgZone}];
TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());
TestBed.configureTestingModule({providers:[{provide:PlatformLocation,useClass:BrowserPlatformLocation}],declarations:[Host,EchookConnectionComponent,PrototypeGalleryComponent],imports:[CommonModule,RouterModule.forRoot([
 {path:'prototypes/echook-connection',component:EchookConnectionComponent},
 {path:'prototypes',component:PrototypeGalleryComponent},
 {path:'**',redirectTo:'prototypes'}])]});
const fixture=TestBed.createComponent(Host);document.body.append(fixture.nativeElement);fixture.autoDetectChanges();
TestBed.inject(Router).initialNavigation();
`);
await build({ entryPoints: [output + '/entry.ts'], outfile: output + '/bundle.js', bundle: true, platform: 'browser',
  nodePaths: [root + '/node_modules'], tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
  plugins: [{ name: 'angular-resources', setup(plugin) {
    plugin.onLoad({ filter: /\.component\.ts$/ }, async args => {
      let source = await readFile(args.path, 'utf8');
      const template = /templateUrl:\s*'([^']+)'/.exec(source), style = /styleUrls:\s*\[([^\]]+)\]/.exec(source);
      if (template) source = source.replace(template[0], 'template: ' + JSON.stringify(await readFile(resolve(dirname(args.path), template[1]), 'utf8')));
      if (style) source = source.replace(style[0], 'styles: ' + JSON.stringify(await Promise.all([...style[1].matchAll(/'([^']+)'/g)].map(([, name]) => readFile(resolve(dirname(args.path), name), 'utf8')))));
      return { contents: source, loader: 'ts', resolveDir: dirname(args.path) };
    });
  } }]
});
const html = `<!doctype html><html><head><base href="/"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${await readFile(root + '/src/styles.css', 'utf8')}html,body{overflow:auto;height:auto}</style></head><body><script src="/bundle.js"></script></body></html>`;
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/bundle.js' ? await readFile(output + '/bundle.js') : html);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
try {
  for (const width of [1280, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.serialCalls = { opened: 0, closed: 0 };
      Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort: async () => ({
        readable: new ReadableStream({ start(controller) { window.sensorStream = controller; } }),
        open: async () => { window.serialCalls.opened++; }, close: async () => { window.serialCalls.closed++; }
      }) } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/prototypes`);
    const tile = page.locator('a[href="/prototypes/echook-connection"]');
    await tile.waitFor(); assert.equal(await tile.locator('svg path').count(), 2);
    assert.ok((await tile.locator('svg').boundingBox()).height > 0); await tile.click();
    await page.getByRole('heading', { name: 'eChook connection' }).waitFor();
    const button = page.getByRole('button', { name: 'Connect', exact: true });
    await page.keyboard.press('Tab'); await button.focus(); assert.equal(await button.evaluate(el => el.matches(':focus-visible')), true);
    const start = await button.boundingBox(); await button.click();
    await page.getByText('Connected', { exact: true }).waitFor();
    await page.evaluate(() => window.sensorStream.enqueue(Uint8Array.from([123, 118, 24, 75, 125, 123, 105, 12, 50, 125])));
    await page.getByText('24.75 V', { exact: true }).waitFor();
    const during = await page.getByRole('button', { name: 'Disconnect', exact: true }).boundingBox();
    assert.equal(start.y, during.y); assert.equal(start.width, during.width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: output + '/' + width + '-live.png', fullPage: true });
    await page.getByText('Stale', { exact: true }).first().waitFor({ timeout: 8000 });
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.getByRole('button', { name: 'Connect', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.serialCalls.closed), 1);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByText('Connected', { exact: true }).waitFor();
    await page.getByRole('link', { name: '← Prototyping' }).click();
    await page.waitForFunction(() => window.serialCalls.closed === 2);
    assert.deepEqual(errors, []); await page.close();
  }
  const page = await browser.newPage();
  await page.addInitScript(() => Object.defineProperty(navigator, 'serial', { configurable: true, value: undefined }));
  await page.goto(`http://127.0.0.1:${server.address().port}/prototypes/echook-connection`);
  await page.getByText(/Bluetooth serial is unavailable/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Connect', exact: true }).isDisabled(), true);
  await page.close();
  const failed = await browser.newPage({ viewport: { width: 390, height: 850 } });
  await failed.addInitScript(() => Object.defineProperty(navigator, 'serial', { configurable: true, value: {
    requestPort: async () => { throw new DOMException('Busy', 'NetworkError'); }
  } }));
  await failed.goto(`http://127.0.0.1:${server.address().port}/prototypes/echook-connection`);
  await failed.getByRole('button', { name: 'Connect', exact: true }).click();
  await failed.getByRole('alert').waitFor();
  assert.match(await failed.getByRole('alert').innerText(), /Close OMNI/);
  assert.equal(await failed.getByRole('button', { name: 'Connect', exact: true }).isEnabled(), true);
  console.log('Desktop/390px/320px: gallery graphic and navigation, live/stale/disconnected values, keyboard focus, stable controls, cleanup and unsupported state passed. Screenshots: ' + output);
} finally { await browser.close(); await new Promise(r => server.close(r)); }
