// Production Angular fund editor with synthetic state; no Firebase requests.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(import.meta.dirname, '..'), output = await mkdtemp(resolve(tmpdir(), 'perrinn-fund-ui-'));
await writeFile(output + '/entry.ts', `
import 'zone.js'; import '@angular/compiler';
import { NgZone, provideZoneChangeDetection } from '@angular/core'; import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { CommonModule } from '@angular/common'; import { FormsModule } from '@angular/forms'; import { RouterModule } from '@angular/router';
import { ChatFundEditorComponent } from '${root}/src/app/chat/chat-fund/chat-fund-editor.component';
import { ChatDataService } from '${root}/src/app/chat/chatData.service';
import { PermissionsService } from '${root}/src/app/permissions.service';
const permissions = { current: { ready: true, isAdmin: true } }, writes = []; let finish, failing = false;
const data = {fundCurrency:{code:'usd',perGBP:1.25},saveFund:async (...args)=>{writes.push(args);await new Promise(resolve=>finish=resolve);if(failing)throw new Error('offline');},cancelFund:async()=>{writes.push('cancel');}};
ChatFundEditorComponent.ctorParameters=()=>[{type:ChatDataService},{type:NgZone},{type:PermissionsService}];
TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());
TestBed.configureTestingModule({imports:[CommonModule,FormsModule,RouterModule.forRoot([])],declarations:[ChatFundEditorComponent],providers:[provideZoneChangeDetection(),{provide:ChatDataService,useValue:data},{provide:PermissionsService,useValue:permissions}]});
const fixture=TestBed.createComponent(ChatFundEditorComponent), c=fixture.componentInstance;
Object.assign(c,{chain:'chat',signedIn:true,fund:{description:'Track testing',amountGBPTarget:1000,amountGBPRaised:125,daysLeft:30}});
document.querySelector('.contentCard').append(fixture.nativeElement);c.ngOnChanges();fixture.autoDetectChanges();
window.fundHarness={state(admin,signedIn=true){permissions.current.isAdmin=admin;c.signedIn=signedIn;c.ngOnChanges();fixture.changeDetectorRef.markForCheck();fixture.detectChanges();},async finish(fail=false){failing=fail;finish();await new Promise(resolve=>setTimeout(resolve,0));fixture.changeDetectorRef.markForCheck();fixture.detectChanges();},reset(){c.dismiss();permissions.current.isAdmin=true;c.signedIn=true;c.fund={description:'Track testing',amountGBPTarget:1000,amountGBPRaised:125,daysLeft:30};c.ngOnChanges();fixture.changeDetectorRef.markForCheck();fixture.detectChanges();},stats(){return {writes,saving:c.saving,editing:c.editing};}};
`);
await build({entryPoints:[output+'/entry.ts'],outfile:output+'/bundle.js',bundle:true,format:'iife',platform:'browser',nodePaths:[root+'/node_modules'],tsconfigRaw:{compilerOptions:{experimentalDecorators:true}},plugins:[{name:'angular-resources',setup(plugin){plugin.onLoad({filter:/\.component\.ts$/},async args=>{
 let source=await readFile(args.path,'utf8');
 const template=/templateUrl:\s*'([^']+)'/.exec(source),style=/styleUrls:\s*\[([^\]]+)\]/.exec(source);
 if(template)source=source.replace(template[0],'template: '+JSON.stringify(await readFile(resolve(dirname(args.path),template[1]),'utf8')));
 if(style)source=source.replace(style[0],'styles: '+JSON.stringify(await Promise.all([...style[1].matchAll(/'([^']+)'/g)].map(([,name])=>readFile(resolve(dirname(args.path),name),'utf8')))));
 return {contents:source,loader:'ts',resolveDir:dirname(args.path)};
});}}],logLevel:'silent'});
const styles=await readFile(root+'/src/styles.css','utf8');
const server=createServer(async(req,res)=>{
 res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');
 res.end(req.url==='/bundle.js'?await readFile(output+'/bundle.js'):`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}html,body{height:100%;margin:0}.shell{height:100dvh;overflow:hidden}header{height:48px}#main_container{height:calc(100dvh - 48px);overflow:auto}.contentCard{max-width:560px;margin:0 auto;padding:16px}</style></head><body><div class="shell"><header>Conversation</header><main id="main_container"><div class="contentCard"></div></main></div><script src="/bundle.js"></script></body></html>`);
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage(), errors=[];page.setDefaultTimeout(10000);page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});console.log('Browser ready');
 await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'domcontentloaded'});console.log('Page loaded');await page.waitForFunction(()=>!!window.fundHarness);
 const geometry=()=>page.locator('#main_container').boundingBox();
 for(const width of [1440,390,320]) {
  console.log('Checking width '+width);
  await page.setViewportSize({width,height:850});await page.evaluate(()=>window.fundHarness.reset());const shell=await geometry();
  assert.equal(await page.getByRole('button',{name:'Cancel fund',exact:true}).count(),1);
  await page.getByRole('button',{name:'Edit fund',exact:true}).click();
  const raised=page.getByLabel('Amount raised (USD)');await raised.waitFor();assert.equal(await raised.inputValue(),'156.25');
  await page.waitForFunction(()=>document.activeElement?.id==='fund-description');
  assert.deepEqual(await geometry(),shell);
  await raised.fill('0');await page.getByRole('button',{name:'Save fund'}).click();
  await page.getByRole('button',{name:'Saving',exact:true}).waitFor();assert.equal(await raised.isDisabled(),true);
  const saveBox=await page.getByRole('button',{name:'Saving',exact:true}).boundingBox();
  await page.evaluate(()=>window.fundHarness.finish(true));await page.getByRole('alert').waitFor();
  assert.equal(await raised.inputValue(),'0');assert.equal(await raised.isDisabled(),false);
  assert.equal((await page.evaluate(()=>window.fundHarness.stats())).editing,true);
  await page.screenshot({path:output+'/fund-'+width+'-failed.png'});
  await page.getByRole('button',{name:'Save fund'}).click();await page.getByRole('button',{name:'Saving',exact:true}).waitFor();
  await page.evaluate(()=>window.fundHarness.finish());await page.getByRole('status').waitFor();
  assert.equal((await page.evaluate(()=>window.fundHarness.stats())).writes.at(-1)[1].amountGBPRaised,0);
  assert.deepEqual(await geometry(),shell);
  await page.getByRole('button',{name:'Cancel fund',exact:true}).click();await page.getByRole('button',{name:'Keep fund'}).waitFor();
  await page.evaluate(()=>window.fundHarness.state(false));assert.equal(await page.getByRole('button',{name:'Cancel fund',exact:true}).count(),0);
  await page.getByRole('button',{name:'Edit fund'}).click();assert.equal(await raised.count(),0);
  assert.equal(await page.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(await geometry(),shell);assert.ok(saveBox.width>=44);
  await page.evaluate(()=>window.fundHarness.state(false,false));await page.getByRole('link',{name:'Sign in to manage funds'}).waitFor();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({output,widths:[1440,390,320],checks:['Admin-only fields and cancellation','Zero correction','Pending and failed saves','Retained drafts','Role loss','Sign-out','Focus','Shell stability','No horizontal overflow'],errors}));
} finally {await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
