// Render the actual fund template sections from all three pages with synthetic
// state and the production shared row component; no Firebase is initialized.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile,writeFile,mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve,dirname } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
const require=createRequire(import.meta.url), {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve(import.meta.dirname,'../..'), output=await mkdtemp(resolve(tmpdir(),'perrinn-fund-alignment-'));
const templates={},styles={};
for(const name of ['home','profile','buy-prn']) {
 const source=await readFile(root+'/src/app/'+name+'.component.html','utf8');
 const marker=name==='home'?'<section class="panel funds-panel"':name==='profile'?'<section class="profile-funds-item"':'<h2 class="funds-heading">';
 const start=source.indexOf(marker),end=name==='buy-prn'?source.indexOf('\n    </div>\n    <br/>',start):source.indexOf('</section>',start)+10;
 assert.ok(start>=0&&end>start);templates[name]=source.slice(start,end);styles[name]=await readFile(root+'/src/app/'+name+'.component.css','utf8');
}
await writeFile(output+'/entry.ts',`
import 'zone.js';import '@angular/compiler';
import {Component,provideZoneChangeDetection} from '@angular/core';import {TestBed} from '@angular/core/testing';
import {BrowserDynamicTestingModule,platformBrowserDynamicTesting} from '@angular/platform-browser-dynamic/testing';
import {CommonModule} from '@angular/common';import {BehaviorSubject} from 'rxjs';
import {ChatFundSummaryComponent} from '${root}/src/app/chat/chat-fund/chat-fund-summary.component';
import {chatFund} from '${root}/src/app/chat/chat-fund/chatFund';
const templates=${JSON.stringify(templates)},styles=${JSON.stringify(styles)};let fixture,opened=[],loads=0;
const source=()=>[{chain:'testing',image:'',fund:{description:'424 Nürburgring testing',amountGBPTarget:1000,amountGBPRaised:250,closesAt:Date.now()+3*86400000,cancelled:false}},
 {chain:'battery',image:'',fund:{description:'Battery development and track testing equipment for the next shared workshop',amountGBPTarget:1000,amountGBPRaised:1500,closesAt:Date.now()+86400000,cancelled:false}}];
function area(name){return Component({selector:'test-'+name,standalone:false,template:templates[name],styles:[styles[name]]})(class {
 rows=source();funds=this.rows;fundDisplayCurrency={code:'gbp',perGBP:1};loadingFunds=false;fundError=false;fundHasMore=true;showPastFunds=false;
 state=new BehaviorSubject({items:this.rows,loading:false,error:false,hasMore:true});fundList={state:this.state.asObservable(),loadMore(){loads++;}};
 openChat(chain){opened.push(chain)}openListedChat(chain){opened.push(chain)}router={navigate:args=>opened.push(args[1])};loadFunds(){loads++;}
 togglePastFunds(){this.showPastFunds=!this.showPastFunds;this.set(this.showPastFunds?'history':'ready');}
 set(kind){let rows=source();if(['loading','empty','error','sparse'].includes(kind))rows=[];
  if(kind==='history')rows.push({chain:'old',image:'',fund:{...rows[0].fund,description:'Previous fund',closesAt:Date.now()-86400000,cancelled:true}});
  if(kind==='history')rows.push({chain:'legacy',image:'',fund:chatFund({fund:{description:'Historical fund',amountGBPTarget:'559.6',amountGBPRaised:'559.55',closesAt:Date.now()-86400000,cancelled:false}})});
  if(kind==='expiry')rows=[{...rows[0],fund:{...rows[0].fund,closesAt:Date.now()+150}}];
  this.funds=rows;this.loadingFunds=kind==='loading';this.fundError=kind==='error';this.fundHasMore=!['empty','expiry'].includes(kind);
  this.state.next({items:rows,loading:this.loadingFunds,error:this.fundError,hasMore:this.fundHasMore});
 }
 });}
const areas=Object.fromEntries(Object.keys(templates).map(name=>[name,area(name)]));
TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());
TestBed.configureTestingModule({imports:[CommonModule],declarations:[...Object.values(areas),ChatFundSummaryComponent],providers:[provideZoneChangeDetection()]});
window.fundsUI={show(name){fixture?.destroy();fixture=TestBed.createComponent(areas[name]);document.querySelector('.contentCard').replaceChildren(fixture.nativeElement);fixture.autoDetectChanges();fixture.detectChanges();},set(kind){fixture.componentInstance.set(kind);fixture.changeDetectorRef.markForCheck();fixture.detectChanges();},stats:()=>({opened,loads})};window.fundsUI.show('home');
`);
await build({entryPoints:[output+'/entry.ts'],outfile:output+'/bundle.js',bundle:true,platform:'browser',format:'iife',nodePaths:[root+'/node_modules'],tsconfigRaw:{compilerOptions:{experimentalDecorators:true}},plugins:[{name:'resources',setup(plugin){plugin.onLoad({filter:/\.component\.ts$/},async args=>{
 let source=await readFile(args.path,'utf8');const template=/templateUrl:\s*'([^']+)'/.exec(source),style=/styleUrls:\s*\[([^\]]+)\]/.exec(source);
 if(template)source=source.replace(template[0],'template: '+JSON.stringify(await readFile(resolve(dirname(args.path),template[1]),'utf8')));
 if(style)source=source.replace(style[0],'styles: '+JSON.stringify(await Promise.all([...style[1].matchAll(/'([^']+)'/g)].map(([,file])=>readFile(resolve(dirname(args.path),file),'utf8')))));
 return {contents:source,loader:'ts',resolveDir:dirname(args.path)};
});}}],logLevel:'silent'});
const globalStyles=await readFile(root+'/src/styles.css','utf8');
const server=createServer(async(req,res)=>{
 res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?await readFile(output+'/bundle.js'):
 '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+globalStyles+'html,body{height:100%;margin:0}.shell{height:100dvh;overflow:hidden}header{height:48px}#main_container{height:calc(100dvh - 48px);overflow:auto}.contentCard{max-width:560px;padding:16px;margin:auto}</style></head><body><div class="shell"><header>PERRINN</header><main id="main_container"><div class="contentCard"></div></main></div><script src="/bundle.js"></script></body></html>');
});await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});
 await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!window.fundsUI);
 for(const width of [1440,390,320])for(const name of Object.keys(templates)){
  await page.setViewportSize({width,height:850});await page.evaluate(name=>window.fundsUI.show(name),name);const geometry=await page.locator('#main_container').boundingBox();
  const row=page.getByRole('button',{name:'Fund details: 424 Nürburgring testing'});await row.waitFor();
  assert.ok(await page.getByText('£250 raised / £1,000 target',{exact:true}).isVisible());
  assert.equal(await row.locator('progress').getAttribute('value'),'25');
  assert.equal(await page.getByRole('button',{name:/Fund details: Battery/}).locator('progress').getAttribute('value'),'100');
  assert.equal(await row.locator('strong').evaluate(el=>getComputedStyle(el).fontSize),'14px');
  assert.equal((await row.locator('progress').boundingBox()).height,4);
  await row.focus();await page.keyboard.press('Enter');assert.equal((await page.evaluate(()=>window.fundsUI.stats())).opened.at(-1),'testing');
  assert.equal(await page.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:output+'/'+name+'-'+width+'.png'});
  for(const state of ['loading','error','empty']){await page.evaluate(state=>window.fundsUI.set(state),state);assert.deepEqual(await page.locator('#main_container').boundingBox(),geometry);}
  await page.getByText('No active funds.',{exact:true}).waitFor();
  await page.evaluate(()=>window.fundsUI.set('sparse'));assert.equal(await page.getByText('No active funds.',{exact:true}).count(),0);await page.getByRole('button',{name:'Load more',exact:true}).waitFor();
  await page.evaluate(()=>window.fundsUI.set('ready'));
  if(name==='buy-prn'){
   await page.getByRole('button',{name:'Show past funds'}).click();await page.getByText('Cancelled',{exact:true}).waitFor();
   const historical=page.getByRole('button',{name:'Fund details: Historical fund'});
   await historical.getByText('£560 raised / £560 target',{exact:true}).waitFor();await historical.getByText('Ended',{exact:true}).waitFor();
   assert.deepEqual(await page.locator('#main_container').boundingBox(),geometry);
   await page.getByRole('button',{name:'Hide past funds'}).click();assert.equal(await historical.count(),0);
  }
  else {await page.evaluate(()=>window.fundsUI.set('expiry'));await row.waitFor({state:'hidden'});assert.deepEqual(await page.locator('#main_container').boundingBox(),geometry);}
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({output,widths:[1440,390,320],pages:Object.keys(templates),checks:['Shared typography/progress','Keyboard navigation','Long descriptions','Expiry','Cancelled history','Loading/error/empty','Shell stability','No overflow'],errors}));
}finally{await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
