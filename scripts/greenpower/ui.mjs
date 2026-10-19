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
console.log('UI artifacts: '+output);
const folder = `${root}/src/app/greenpower-telemetry`;
await writeFile(`${output}/entry.ts`, `
import 'zone.js';
import '@angular/compiler';
import { ChangeDetectorRef, NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { Title } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { BehaviorSubject } from 'rxjs';
import { PermissionsService } from '${root}/src/app/permissions.service';
import { GreenpowerViewService } from '${folder}/greenpowerView.service';
import { GreenpowerTelemetryComponent } from '${folder}/greenpower-telemetry.component';
import { GreenpowerChartComponent } from '${folder}/greenpower-chart.component';
import { GreenpowerTelemetryService } from '${folder}/greenpowerTelemetry.service';
import { PrototypeGalleryComponent } from '${root}/src/app/prototypes/prototype-gallery.component';
GreenpowerTelemetryComponent.ctorParameters = () => [{type: GreenpowerTelemetryService}, {type: ChangeDetectorRef}, {type: Title}, {type: GreenpowerViewService}];
GreenpowerViewService.ctorParameters = () => [{type: PermissionsService}, {type: AngularFirestore}];
GreenpowerChartComponent.ctorParameters = () => [{type: ChangeDetectorRef}, {type: NgZone}];
TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
const permissionState=new BehaviorSubject({uid:'viewer',isAdmin:false,ready:true});
const permissions={state:permissionState,get current(){return permissionState.value;}};
let config; let saveError=false; const configListeners=[];
const notify=()=>configListeners.filter(l=>l.active).forEach(l=>l.next({exists:!!config,data:()=>config,metadata:{fromCache:false,hasPendingWrites:false}}));
const ref={firestore:{async runTransaction(callback){if(saveError)throw new Error('synthetic save failure');await callback({get:async()=>({data:()=>config}),set:(_,value)=>{config=value;}});notify();}},
 onSnapshot(options,next,error){const l={next,error,active:true};configListeners.push(l);queueMicrotask(()=>{if(l.active)notify();});return()=>l.active=false;}};
const mockFirestore={firestore:{doc:()=>ref}};
TestBed.configureTestingModule({providers:[{provide:PermissionsService,useValue:permissions},{provide:AngularFirestore,useValue:mockFirestore}],imports:[CommonModule, RouterModule.forRoot([])], declarations:[GreenpowerTelemetryComponent,GreenpowerChartComponent,PrototypeGalleryComponent]});
const fixture = TestBed.createComponent(GreenpowerTelemetryComponent);
document.querySelector('.contentCard').append(fixture.nativeElement); fixture.autoDetectChanges();
const service = fixture.componentInstance.telemetry;
window.telemetryHarness = {
  role(admin){permissionState.next({uid:'viewer',isAdmin:admin,ready:true});fixture.detectChanges();},
  config(value){config=value;notify();fixture.detectChanges();},
  saveError(value){saveError=value;},
  saved(){return config;},
  snapshot() { const c=fixture.componentInstance; return {start:c.start,end:c.end,cursor:c.cursor,zoomed:!!c.window}; },
  state(name) {
    service.access = name === 'signed-out' ? 'signed-out' : 'signed-in';
    service.error = name === 'error' ? 'Could not load telemetry. Check your connection and try again.' : '';
    service.loading = name === 'loading'; service.more = name === 'more';
    service.connected = true;
    if (name === 'empty') { service.channels = []; service.latest = undefined; }
    else service.seed(name === 'stale' ? Date.now()-60000 : Date.now());
    permissionState.next({...permissionState.value,uid:name==='signed-out'?'': 'viewer'});
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
    const tickBoxes = await page.locator('.times').first().evaluate(el => [...el.children].map(t => ({width:t.getBoundingClientRect().width, text:t.textContent})));
    assert.ok(tickBoxes.every(t => t.width >= 45), name + ' axis label clipping: ' + JSON.stringify(tickBoxes));
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
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('app-greenpower-chart').first().scrollIntoViewIfNeeded();
  const plot = page.locator('app-greenpower-chart svg').first();
  const box = await plot.boundingBox();
  const original = await page.evaluate(() => window.telemetryHarness.snapshot());
  const titleBefore = await page.locator('h1').boundingBox();
  const chartBefore = await page.locator('app-greenpower-chart').nth(2).boundingBox();
  await page.mouse.move(box.x+box.width*.4, box.y+40);
  assert.equal(await page.locator('.cursor').count(),7, 'hover synchronizes every chart');
  assert.doesNotMatch(await page.locator('.readout').first().innerText(), /Cursor —/);
  assert.equal((await page.locator('h1').boundingBox()).y,titleBefore.y,'cursor does not move layout');
  assert.equal((await page.locator('app-greenpower-chart').nth(2).boundingBox()).y,chartBefore.y,'cursor appearance preserves later chart positions');
  await page.mouse.move(box.x+box.width*.2, box.y+40);
  await page.mouse.down(); await page.mouse.move(box.x+box.width*.7,box.y+40,{steps:8});
  assert.equal(await page.locator('.selection').count(),1);
  await page.evaluate(()=>window.telemetryHarness.state('live'));
  await page.mouse.move(box.x+box.width*.7,box.y+40);
  assert.equal(await page.locator('.selection').count(),1,'live updates preserve mouse selection');
  assert.equal(await page.locator('.cursor').count(),0);
  await page.mouse.up();
  const zoomed = await page.evaluate(() => window.telemetryHarness.snapshot());
  assert.ok(zoomed.zoomed && zoomed.start>original.start && zoomed.end<original.end);
  await page.evaluate(() => window.telemetryHarness.state('live'));
  assert.equal((await page.evaluate(() => window.telemetryHarness.snapshot())).start,zoomed.start,'live update retains zoom');
  await plot.dblclick();
  assert.equal((await page.evaluate(() => window.telemetryHarness.snapshot())).zoomed,false);
  await plot.focus(); await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>document.querySelectorAll('.cursor').length===7);
  await page.keyboard.press('Home');
  await page.waitForFunction(()=>document.querySelectorAll('.cursor').length===0);

  const touch = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await touch.goto(`http://127.0.0.1:${server.address().port}`);
  await touch.waitForFunction(() => !!window.telemetryHarness);
  const touchPlot=touch.locator('app-greenpower-chart svg').first();
  await touchPlot.scrollIntoViewIfNeeded();
  const tb=await touchPlot.boundingBox();
  const cdp=await touch.context().newCDPSession(touch);
  const finger=async(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y}]});
  const x=tb.x+tb.width*.25,y=tb.y+40;
  await finger('touchStart',x,y); await touch.waitForTimeout(550);
  assert.equal(await touch.locator('.cursor').count(),7,'long press activates shared cursor');
  const cursorScrollStart=await touch.locator('#main_container').evaluate(el=>el.scrollTop);
  const cursorStart=(await touch.evaluate(()=>window.telemetryHarness.snapshot())).cursor;
  // Start with a vertical movement, then move diagonally beyond the chart's edge.
  for(let offset=20;offset<=100;offset+=20) { await finger('touchMove',x,y-offset); await touch.waitForTimeout(30); }
  await finger('touchMove',x+tb.width*.4,y-120); await touch.waitForTimeout(40);
  assert.equal(await touch.locator('.cursor').count(),7,'vertical movement cannot cancel long-press cursor control');
  assert.equal(await touch.locator('#main_container').evaluate(el=>el.scrollTop),cursorScrollStart,'active cursor owns vertical movement');
  assert.ok((await touch.evaluate(()=>window.telemetryHarness.snapshot())).cursor>cursorStart,'cursor continues following horizontal movement');
  assert.equal(await touch.locator('.selection').count(),0,'cursor gesture never selects a window');
  await finger('touchEnd');
  assert.equal((await touch.evaluate(()=>window.telemetryHarness.snapshot())).zoomed,false);
  await finger('touchStart',x,y); await finger('touchMove',x+tb.width*.3,y);
  await touch.waitForTimeout(550);
  assert.equal(await touch.locator('.selection').count(),1,'zoom remains selected past the long-press delay');
  // New live samples must not cancel the gesture and turn subsequent movement into hover.
  await touch.evaluate(()=>window.telemetryHarness.state('live'));
  await touch.waitForTimeout(550);
  assert.equal(await touch.locator('.selection').count(),1,'live updates preserve an active zoom selection');
  assert.equal(await touch.locator('.cursor').count(),0,'active zoom never switches to cursor control');
  await finger('touchMove',x+tb.width*.5,y); await finger('touchEnd');
  await touch.waitForTimeout(40);
  assert.equal((await touch.evaluate(()=>window.telemetryHarness.snapshot())).zoomed,true,'ordinary touch drag zooms');
  await finger('touchStart',x,y); await finger('touchEnd'); await touch.waitForTimeout(60);
  await finger('touchStart',x,y); await finger('touchEnd'); await touch.waitForTimeout(40);
  assert.equal((await touch.evaluate(()=>window.telemetryHarness.snapshot())).zoomed,false,'double tap resets');
  await finger('touchStart',x,y); await finger('touchCancel'); await touch.waitForTimeout(550);
  assert.equal(await touch.locator('.cursor').count(),0,'cancelled hold cannot activate later');
  const scrollBefore=await touch.locator('#main_container').evaluate(el=>el.scrollTop);
  await finger('touchStart',x,y+60);
  for(let offset=40;offset>=-100;offset-=20) { await touch.waitForTimeout(30); await finger('touchMove',x,y+offset); }
  await finger('touchEnd');
  await touch.waitForTimeout(100);
  assert.ok(await touch.locator('#main_container').evaluate(el=>el.scrollTop)>scrollBefore,'vertical chart swipe scrolls page');
  // A scroll cancellation must not leave the double-tap recognizer's pointer set stuck.
  await touchPlot.scrollIntoViewIfNeeded(); await touch.waitForTimeout(300);
  const recovered=await touchPlot.boundingBox();
  const rx=recovered.x+recovered.width*.2, ry=recovered.y+40;
  await finger('touchStart',rx,ry); await finger('touchMove',rx+recovered.width*.5,ry); await finger('touchEnd');
  await touch.waitForFunction(()=>window.telemetryHarness.snapshot().zoomed);
  await touch.screenshot({path:`${output}/mobile-interactions.png`});
  // Changing the selected day clears both the viewport and cursor.
  await page.getByRole('button',{name:'Load history',exact:true}).click();
  await page.getByLabel('Recorded day').selectOption('2026-10-18');
  assert.equal((await page.evaluate(()=>window.telemetryHarness.snapshot())).zoomed,false);
  assert.equal((await page.evaluate(()=>window.telemetryHarness.snapshot())).cursor,undefined);
  await touch.close();
  for (const [name,width,height] of [['desktop',1440,1000],['mobile',390,844],['small-mobile',320,740]]) {
    await page.setViewportSize({width,height});
    await page.evaluate(()=>{window.telemetryHarness.config(undefined);window.telemetryHarness.state('live');window.telemetryHarness.role(false);});
    await page.locator('h1').scrollIntoViewIfNeeded();
    const titleBox=await page.locator('h1').boundingBox();
    const statusBox=await page.locator('.status').boundingBox();
    assert.equal(await page.getByRole('button',{name:'Edit view'}).count(),0);
    await page.evaluate(()=>window.telemetryHarness.role(true));
    assert.equal((await page.locator('h1').boundingBox()).y,titleBox.y,'admin button preserves heading');
    assert.equal((await page.locator('.status').boundingBox()).y,statusBox.y,'admin button preserves control row height');
    await page.getByRole('button',{name:'Edit view'}).click();
    await page.getByRole('button',{name:'Scalars',exact:true}).click();
    const voltageScalar=page.getByRole('checkbox',{name:'Total voltage scalar',exact:true});
    const currentChart=page.getByRole('checkbox',{name:'Current chart',exact:true});
    await voltageScalar.uncheck();
    await page.getByRole('button',{name:'Charts',exact:true}).click();
    assert.equal(await page.getByRole('checkbox',{name:'status chart',exact:true}).count(),0);
    await currentChart.uncheck();
    assert.equal(await page.locator('.reading').count(),8,'draft changes do not affect saved view');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await page.locator('.reading').count(),8);
    await page.getByRole('button',{name:'Edit view'}).click();
    await page.getByRole('button',{name:'Scalars',exact:true}).click();
    await voltageScalar.uncheck();
    await page.getByRole('button',{name:'Charts',exact:true}).click();
    await currentChart.uncheck();
    await page.evaluate(()=>window.telemetryHarness.saveError(true));
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Could not save view'}).waitFor();
    assert.equal(await currentChart.isChecked(),false,'failed save preserves draft');
    await page.evaluate(()=>window.telemetryHarness.saveError(false));
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await page.locator('#view-editor').waitFor({state:'hidden'});
    assert.equal(await page.locator('.reading').count(),7);
    assert.equal(await page.locator('app-greenpower-chart').count(),6);
    await page.evaluate(()=>window.telemetryHarness.role(false));
    assert.equal(await page.getByRole('button',{name:'Edit view'}).count(),0);
    assert.equal(await page.locator('.reading').count(),7,'ordinary viewer uses saved shared view');
    assert.equal(await page.locator('app-greenpower-chart').count(),6);
    await page.evaluate(()=>window.telemetryHarness.role(true));
    await page.getByRole('button',{name:'Edit view'}).click();
    await page.getByRole('button',{name:'Scalars',exact:true}).click();
    await voltageScalar.check();
    await page.getByRole('button',{name:'Charts',exact:true}).click();
    await currentChart.check();
    await page.screenshot({path:`${output}/${name}-editor.png`});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await page.locator('#view-editor').waitFor({state:'hidden'});
    assert.equal(await page.locator('.reading').count(),8);
    assert.equal(await page.locator('app-greenpower-chart').count(),7);
    const scalarBefore=await page.locator('.reading > span').allTextContents();
    const chartBefore=await page.locator('app-greenpower-chart h2').allTextContents();
    await page.getByRole('button',{name:'Edit view'}).click();
    const reorder=async(kind)=>{
      await page.getByRole('button',{name:kind==='scalar'?'Scalars':'Charts',exact:true}).click();
      await page.getByRole('group',{name:kind==='scalar'?'Scalar visibility and order':'Chart visibility and order',exact:true}).waitFor();
      const label=(await page.locator('.channel-option .channel-label').first().innerText()).split(' · ')[0];
      const up=page.getByRole('button',{name:'Move '+label+' '+kind+' up',exact:true});
      const down=page.getByRole('button',{name:'Move '+label+' '+kind+' down',exact:true});
      assert.equal(await up.isDisabled(),true);
      await down.press('Enter');
      assert.equal(await down.evaluate(el=>document.activeElement===el),true,'keyboard focus survives row reorder');
    };
    await reorder('scalar');await reorder('chart');
    assert.deepEqual(await page.locator('.reading > span').allTextContents(),scalarBefore,'draft scalar order stays private');
    assert.deepEqual(await page.locator('app-greenpower-chart h2').allTextContents(),chartBefore);
    await page.screenshot({path:`${output}/${name}-ordering.png`});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await page.locator('#view-editor').waitFor({state:'hidden'});
    const swapped=values=>[values[1],values[0],...values.slice(2)];
    assert.deepEqual(await page.locator('.reading > span').allTextContents(),swapped(scalarBefore));
    assert.deepEqual(await page.locator('app-greenpower-chart h2').allTextContents(),swapped(chartBefore));
    await page.evaluate(()=>window.telemetryHarness.role(false));
    assert.deepEqual(await page.locator('.reading > span').allTextContents(),swapped(scalarBefore));
    await page.evaluate(()=>window.telemetryHarness.role(true));
    await page.getByRole('button',{name:'Edit view'}).click();
    await page.evaluate(()=>window.telemetryHarness.role(false));
    await page.locator('#view-editor').waitFor({state:'hidden'});
    await page.evaluate(()=>window.telemetryHarness.config(undefined));
  }
  await page.evaluate(() => window.telemetryHarness.gallery());
  const tile = page.locator('a.prototype-card').filter({ hasText: 'greenpower-telemetry' });
  assert.equal(await tile.count(), 0);
  const apps = await readFile(`${root}/src/app/apps.component.html`, 'utf8');
  assert.match(apps, /routerLink="\/424-greenpower-telemetry"/);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ output, widths: [1440, 390, 320], states: ['live', 'history', 'stale', 'loading', 'empty', 'error', 'continuation', 'signed-out'], discovery: 'Apps only; absent from prototype gallery', errors }));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
