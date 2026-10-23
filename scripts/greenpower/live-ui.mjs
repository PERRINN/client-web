// Render production Home/shell templates with synthetic state; no Firebase traffic.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(import.meta.dirname, '../..');
const output = await mkdtemp(resolve(tmpdir(), 'greenpower-live-ui-'));
const homeTemplate = await readFile(`${root}/src/app/home.component.html`, 'utf8');
const shellTemplate = await readFile(`${root}/src/app/app.component.html`, 'utf8');
const homeStyles = await readFile(`${root}/src/app/home.component.css`, 'utf8');
const shellStyles = await readFile(`${root}/src/app/app.component.css`, 'utf8');
await writeFile(`${output}/entry.ts`, `
import 'zone.js'; import '@angular/compiler';
import {Component, NO_ERRORS_SCHEMA} from '@angular/core';
import {CommonModule} from '@angular/common';
import {RouterModule, Router} from '@angular/router';
import {TestBed} from '@angular/core/testing';
import {BrowserDynamicTestingModule,platformBrowserDynamicTesting} from '@angular/platform-browser-dynamic/testing';
import {BehaviorSubject,of} from 'rxjs';
const live$=new BehaviorSubject(false);
const UI={currentUser:'viewer',hasTouch:false,isStandalone:false,PERRINNProfileLastMessageObj:{},currentUserLastMessageObj:{name:'Viewer'},convertAndFormatPRNToPRNCurrency:()=>''};
@Component({selector:'app-home',standalone:false,template:${JSON.stringify(homeTemplate)},styles:[${JSON.stringify(homeStyles)}]})
class Home {
 greenpowerLive={live$}; UI=UI; homeScreenHintDismissed=true; eventNotices=[]; bannerUrl=''; mentionActivity={status:'signed-out'};
 loadingImages=false;imageError=false;imageTiles=[];loadingEvents=false;eventError=false;upcomingEvents=[];
 loadingFunds=false;funds=[];fundError=false;loadingVisitors=false;visitorError=false;visitors=[];
}
@Component({selector:'app-workspace',standalone:false,template:'<div style="height:100%;min-height:700px"><nav style="position:sticky;top:0">Telemetry session</nav><p>Workspace</p></div>'}) class Workspace{}
@Component({selector:'app-test',standalone:false,template:${JSON.stringify(shellTemplate)},styles:[${JSON.stringify(shellStyles)}]})
class Shell {
 screenWakeLock={state$:of('off'),supported:true,enabled:false,label:'Keep awake',description:'Keep screen awake: off',toggle(){}};
 greenpowerLive={live$}; UI=UI; router=TestBed.inject(Router); activitySummary=of({});automaticConversations=of({chats:[]});
 sidebarOpen=false;mobileLayout=innerWidth<900;conversationScrollbarVisible=false;automaticScrollbarVisible=false;
 openSidebar(){this.sidebarOpen=true} closeSidebar(){this.sidebarOpen=false} onSidebarKeydown(){} onConversationScroll(){} onAutomaticScroll(){} openDiscover(){}
}
TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());
TestBed.configureTestingModule({declarations:[Shell,Home,Workspace],imports:[CommonModule,RouterModule.forRoot([{path:'home',component:Home},{path:'424-greenpower-telemetry',component:Workspace},{path:'chat',component:Workspace}])],schemas:[NO_ERRORS_SCHEMA]});
const fixture=TestBed.createComponent(Shell); document.body.append(fixture.nativeElement);fixture.detectChanges();
const router=TestBed.inject(Router);
router.events.subscribe(event=>{if(event.constructor.name==='NavigationEnd'){fixture.componentInstance.sidebarOpen=false;fixture.detectChanges()}});
window.liveHarness={url:()=>router.url,async state(live){fixture.ngZone.run(()=>{live$.next(live);fixture.componentInstance.mobileLayout=innerWidth<900});fixture.detectChanges()},async route(path){await fixture.ngZone.run(()=>router.navigateByUrl(path));fixture.detectChanges()}};
await window.liveHarness.route('/home');
`);
await build({entryPoints:[`${output}/entry.ts`],outfile:`${output}/bundle.js`,bundle:true,format:'esm',platform:'browser',nodePaths:[`${root}/node_modules`],tsconfigRaw:{compilerOptions:{experimentalDecorators:true}},logLevel:'silent'});
const styles=await readFile(`${root}/src/styles.css`,'utf8');
const server=createServer(async(req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(`${output}/bundle.js`));}
 else if(req.url?.includes('assets/')){res.statusCode=404;res.end();}
 else{res.setHeader('Content-Type','text/html');res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+styles+'</style></head><body><script type="module" src="/bundle.js"></script></body></html>');}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage(); page.setDefaultTimeout(10000); const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});
 console.log('Browser ready: '+output);await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!!window.liveHarness);
 for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844],['small-mobile',320,740]]){
  await page.setViewportSize({width,height});await page.evaluate(()=>window.liveHarness.state(false));
  await page.evaluate(()=>window.liveHarness.route('/home'));
  const geometry=()=>page.evaluate(()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return [r.x,r.y,r.width,r.height]};return {main:box('#main_container'),dashboard:box('.dashboard-grid'),scroll:document.querySelector('#main_container').scrollTop}});
  const before=await geometry();
  const link=page.getByRole('link',{name:'Open Greenpower telemetry'});
  assert.equal(await link.count(),0,'Home telemetry link is absent when inactive at '+width);
  await page.evaluate(()=>window.liveHarness.state(true));
  assert.deepEqual((await geometry()).main,before.main,'live appearance preserves shell viewport at '+width);
  await link.waitFor();
  const liveGeometry=await geometry();
  await page.evaluate(()=>window.liveHarness.state(true));
  assert.deepEqual(await geometry(),liveGeometry,'live updates preserve Home layout at '+width);
  assert.ok((await link.boundingBox()).width<=width);
  assert.equal(await page.getByRole('heading',{level:1}).isVisible(),true,'Home heading stays visible');
  const headingBox=await page.getByRole('heading',{level:1}).boundingBox();
  assert.ok((await link.boundingBox()).y>=headingBox.y+headingBox.height,'telemetry link does not cover the heading');
  await link.focus();assert.equal(await link.evaluate(el=>document.activeElement===el),true);
  await page.screenshot({path:output+'/'+name+'-home-live.png'});
  if(width<900)await page.getByRole('button',{name:'Open navigation'}).click();
  const nav=page.getByRole('link',{name:'Greenpower live telemetry',exact:true});await nav.waitFor();
  const discover=page.getByRole('button',{name:'Open discover',exact:true});
  assert.equal(await discover.isVisible(),true,'Discover stays available beside live telemetry');
  const discoverBox=await discover.boundingBox(),navBox=await nav.boundingBox();
  assert.ok(discoverBox.width>=100,'Discover label and icon retain usable space');
  assert.ok(discoverBox.x+discoverBox.width<=navBox.x,'navigation controls do not overlap');
  const rowBox=await page.locator('.shellDiscoverActions').boundingBox();
  assert.ok(navBox.x+navBox.width<=rowBox.x+rowBox.width,'live link fits inside navigation');
  assert.equal(await page.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:output+'/'+name+'-navigation-live.png'});
  const appsBefore=await page.getByRole('button',{name:'Open apps',exact:true}).boundingBox();
  await page.evaluate(()=>window.liveHarness.state(false));
  assert.equal(await link.count(),0,'Home telemetry link is removed when live status expires at '+width);
  assert.deepEqual(await page.getByRole('button',{name:'Open apps',exact:true}).boundingBox(),appsBefore);
  assert.deepEqual(await geometry(),before,'live removal preserves Home layout at '+width);
  await page.evaluate(()=>window.liveHarness.state(true));await nav.click();
  await page.waitForFunction(()=>window.liveHarness.url()==='/424-greenpower-telemetry');
  const rect=await page.locator('#main_container').boundingBox();
  await page.evaluate(()=>window.liveHarness.state(false));
  assert.deepEqual(await page.locator('#main_container').boundingBox(),rect,'expiry preserves telemetry viewport');
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({output,widths:[1440,390,320],checks:['Home heading and Discover stay visible','No overlapping controls','Home appearance/removal','navigation geometry','keyboard focus','telemetry link','viewport stability'],errors}));
}finally{await browser.close();await new Promise(done=>server.close(done));}
