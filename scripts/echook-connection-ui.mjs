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
import { NO_ERRORS_SCHEMA, NgZone } from '@angular/core';
import { CommonModule, PlatformLocation, BrowserPlatformLocation } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { Router, RouterModule } from '@angular/router';
import { EchookConnectionComponent } from '${root}/src/app/prototypes/echook-connection/echook-connection.component';
import { EchookConnectionService } from '${root}/src/app/prototypes/echook-connection/echookConnection.service';
import { PrototypeGalleryComponent } from '${root}/src/app/prototypes/prototype-gallery.component';
import { AppComponent } from '${root}/src/app/app.component';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { SwUpdate } from '@angular/service-worker';
import { of, Subscription } from 'rxjs';
import { UserInterfaceService } from '${root}/src/app/userInterface.service';
import { PresenceService } from '${root}/src/app/presence.service';
import { MessageActivityService } from '${root}/src/app/messageActivity.service';
import { SidebarConversationsService } from '${root}/src/app/sidebarConversations.service';
import { GreenpowerLiveService } from '${root}/src/app/greenpower-telemetry/greenpowerLive.service';
import { ScreenWakeLockService } from '${root}/src/app/screenWakeLock.service';
AppComponent.ctorParameters=()=>[Router,AngularFirestore,UserInterfaceService,SwUpdate,PresenceService,MessageActivityService,SidebarConversationsService,GreenpowerLiveService,ScreenWakeLockService].map(type=>({type}));
EchookConnectionComponent.ctorParameters=()=>[{type:EchookConnectionService}];
EchookConnectionService.ctorParameters=()=>[{type:NgZone}];
TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());
TestBed.configureTestingModule({schemas:[NO_ERRORS_SCHEMA],providers:[
 {provide:PlatformLocation,useClass:BrowserPlatformLocation},
 {provide:UserInterfaceService,useValue:{currentUser:null}},
 {provide:AngularFirestore,useValue:{}}, {provide:SwUpdate,useValue:{isEnabled:false}},
 {provide:PresenceService,useValue:{trackActivity:()=>new Subscription()}},
 {provide:MessageActivityService,useValue:{summary:()=>of({})}},
 {provide:SidebarConversationsService,useValue:{automatic:()=>of([])}},
 {provide:GreenpowerLiveService,useValue:{live$:of(false)}},
 {provide:ScreenWakeLockService,useValue:{start:()=>{}}}
],declarations:[AppComponent,EchookConnectionComponent,PrototypeGalleryComponent],imports:[CommonModule,RouterModule.forRoot([
 {path:'prototypes/echook-connection',component:EchookConnectionComponent},
 {path:'prototypes',component:PrototypeGalleryComponent},
 {path:'**',redirectTo:'prototypes'}])]});
const fixture=TestBed.createComponent(AppComponent);document.body.append(fixture.nativeElement);fixture.autoDetectChanges();
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
const html = `<!doctype html><html><head><base href="/"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${await readFile(root + '/src/styles.css', 'utf8')}</style></head><body><script src="/bundle.js"></script></body></html>`;
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/bundle.js' ? await readFile(output + '/bundle.js') : html);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
try {
  for (const [width, height] of [[1280, 850], [390, 844], [320, 568], [844, 390], [568, 320], [640, 280]]) {
    const page = await browser.newPage({ viewport: { width, height }, timezoneId: 'Asia/Tokyo' }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const assertFits = async () => {
      const result = await page.evaluate(() => {
        const main = document.querySelector('#main_container');
        const page = document.querySelector('.echook-page');
        const fits = element => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1;
        const metrics = [...document.querySelectorAll('.metric')];
        return { main: fits(main), page: fits(page), metrics: metrics.every(fits),
          visible: metrics.every(metric => [...metric.children].every(child => {
            const box = child.getBoundingClientRect(), parent = metric.getBoundingClientRect();
            return box.top >= parent.top && box.bottom <= parent.bottom && box.right <= parent.right && box.left >= parent.left;
          })) };
      });
      assert.deepEqual(result, { main: true, page: true, metrics: true, visible: true }, width + 'x' + height);
    };
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
    await page.getByRole('main', { name: 'eChook dashboard' }).waitFor();
    await assertFits();
    await page.clock.setFixedTime(new Date('2026-10-24T12:34:56Z'));
    const button = page.getByRole('button', { name: 'Connect', exact: true });
    await page.keyboard.press('Tab'); await button.focus(); assert.equal(await button.evaluate(el => el.matches(':focus-visible')), true);
    const start = await button.boundingBox(); await button.click();
    await page.getByText('Connected', { exact: true }).waitFor();
    await page.evaluate(() => window.sensorStream.enqueue(Uint8Array.from([
      123, 118, 24, 75, 125, 123, 119, 12, 25, 125, 123, 115, 10, 0, 125,
      123, 105, 12, 50, 125, 123, 109, 140, 34, 125, 123, 116, 75, 0, 125
    ])));
    await page.clock.setFixedTime(new Date('2026-10-24T12:34:57Z'));
    await page.getByText('12.25 V', { exact: true }).waitFor();
    await page.getByText('12.50 V', { exact: true }).waitFor();
    await page.getByText('22.4 mph', { exact: true }).waitFor();
    assert.equal(await page.locator('.metric').count(), 6);
    await page.getByText('75 %', { exact: true }).waitFor();
    await page.getByText('1,234 rpm', { exact: true }).waitFor();
    await page.getByText('12.5 A', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('time').textContent === '21:34:57');
    await page.clock.setFixedTime(new Date('2026-10-24T12:34:58Z'));
    await page.waitForFunction(() => document.querySelector('time').textContent === '21:34:58');
    const during = await page.getByRole('button', { name: 'Disconnect', exact: true }).boundingBox();
    assert.equal(start.y, during.y); assert.equal(start.width, during.width);
    await assertFits();
    await page.screenshot({ path: output + '/' + width + 'x' + height + '-live.png', fullPage: true });
    // Rotate in place: preserve the connection and fit the new available height.
    if (width === 390) {
      await page.setViewportSize({ width: 844, height: 390 }); await assertFits();
      assert.equal(await page.evaluate(() => window.serialCalls.opened), 1);
      await page.setViewportSize({ width, height }); await assertFits();
    }
    await page.clock.setFixedTime(new Date('2026-10-24T12:35:03Z'));
    await page.getByText('Connected · Stale data', { exact: true }).waitFor(); await assertFits();
    assert.equal(await page.locator('.speed dd').innerText(), '— mph');
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.getByRole('button', { name: 'Connect', exact: true }).waitFor(); await assertFits();
    assert.equal(await page.evaluate(() => window.serialCalls.closed), 1);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByText('Connected', { exact: true }).waitFor();
    await page.getByRole('link', { name: '← Prototyping' }).click();
    await page.waitForFunction(() => window.serialCalls.closed === 2);
    assert.deepEqual(errors, []); await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 640, height: 280 } });
  await page.addInitScript(() => Object.defineProperty(navigator, 'serial', { configurable: true, value: undefined }));
  await page.goto(`http://127.0.0.1:${server.address().port}/prototypes/echook-connection`);
  await page.getByText(/Bluetooth serial is unavailable/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Connect', exact: true }).isDisabled(), true);
  assert.equal(await page.locator('#main_container').evaluate(el => el.scrollHeight <= el.clientHeight), true);
  await page.close();
  const failed = await browser.newPage({ viewport: { width: 390, height: 850 } });
  await failed.addInitScript(() => Object.defineProperty(navigator, 'serial', { configurable: true, value: {
    requestPort: async () => { throw new DOMException('Busy', 'NetworkError'); }
  } }));
  await failed.goto(`http://127.0.0.1:${server.address().port}/prototypes/echook-connection`);
  await failed.getByRole('button', { name: 'Connect', exact: true }).click();
  await failed.getByRole('alert').waitFor();
  assert.match(await failed.getByRole('alert').innerText(), /Close OMNI/);
  await failed.setViewportSize({ width: 568, height: 320 });
  assert.equal(await failed.locator('#main_container').evaluate(el => el.scrollHeight <= el.clientHeight), true);
  assert.equal(await failed.locator('.dashboard').evaluate(el => [...el.children].every(child => child.scrollHeight <= child.clientHeight)), true);
  assert.equal(await failed.getByRole('button', { name: 'Connect', exact: true }).isEnabled(), true);
  console.log('Six desktop/portrait/landscape sizes: real shell, no scrolling or clipped metrics, mph/battery mapping, local clock, rotation, live/stale/disconnected states, keyboard focus, gallery, cleanup and unsupported/error states passed. Screenshots: ' + output);
} finally { await browser.close(); await new Promise(r => server.close(r)); }
