// Real Angular profile/sidebar components rendered with synthetic records; no Firebase requests.
// PLAYWRIGHT_MODULE and PLAYWRIGHT_CHANNEL may point to an external installation.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(import.meta.dirname, '..');
const output = await mkdtemp(resolve(tmpdir(), 'perrinn-profile-ui-'));
const read = path => readFile(root + '/src/app/' + path, 'utf8');
const metadata = async (base, selector = '') => `standalone:false,${selector ? `selector:'${selector}',` : ''}template:${JSON.stringify(await read(base + '.html'))},styles:[${JSON.stringify(await read(base + '.css'))}]`;
await writeFile(output + '/entry.ts', `
import 'zone.js'; import '@angular/compiler';
import {ChangeDetectorRef,Component,inject,provideZoneChangeDetection} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {BrowserDynamicTestingModule,platformBrowserDynamicTesting} from '@angular/platform-browser-dynamic/testing';
import {CommonModule} from '@angular/common';
import {RouterTestingModule} from '@angular/router/testing';
import {AgChartsAngular} from 'ag-charts-angular';
import {BehaviorSubject,Subject,Subscription} from 'rxjs';
import {ProfileComponent} from '${root}/src/app/profile.component';
import {ProfileLedgerComponent} from '${root}/src/app/profile/profile-ledger.component';
import {ConversationListComponent} from '${root}/src/app/conversation-list/conversation-list.component';
import {SidebarConversationsComponent} from '${root}/src/app/sidebar-conversations/sidebar-conversations.component';
import {UserAvatarComponent} from '${root}/src/app/user-avatar.component';
import {ProfilePageSession} from '${root}/src/app/profile/profileFeed.service';
const now=Date.now(),navigation=[],cursorChanges=new BehaviorSubject({timestamps:{},flags:{chat0:true},ready:true,unavailable:false});
const record={user:'person',name:'Alex Morgan',userPresentation:'Engineering the next chapter of 424. Design, simulation and software.',createdTimestamp:now-86400000*300,wallet:{balance:12345},locking:{amountCummulate:12345*40},purchaseCOIN:{amountCummulate:2000},contract:{hoursTotal:128.5,amountCummulate:5000,createdTimestamp:now-10000,signed:true,level:3},userChain:{index:350},publicLink:'https://example.com'};
const profile=new BehaviorSubject(record),params=new BehaviorSubject({id:'person'}),auth=new BehaviorSubject({uid:'viewer'});
const UI={currentUser:'viewer',currentUserLastMessageObj:{user:'viewer',name:'Viewer',createdTimestamp:now-86400000*500},PERRINNAdminLastMessageObj:{interest:{rateYear:0.1}},convertPRNToCurrency:(_,value)=>value/100,convertAndFormatPRNToPRNCurrency:(_,value)=>'PRN '+Number(value||0).toLocaleString('en-GB',{maximumFractionDigits:2}),convertAndFormatPRNToCurrency:(_,value)=>'£'+Number((value||0)/100).toFixed(2),openWindow:url=>navigation.push(url),showFullScreenImage(){}};
const router={navigate:(...args)=>navigation.push(args),url:'/profile/person'};
const cursor={createSession:()=>({changes:cursorChanges,update(){},destroy(){}})};
let mode='ready',requests=0,stops=0;
const records=Array.from({length:61},(_,i)=>({id:'message'+i,user:'person',chain:'chat'+i,name:'Alex',chatSubject:i===0?'Engineering the 424 hypercar together':'Design conversation '+i,text:'Viewer — updated the simulation and shared the latest results.',serverTimestamp:{seconds:Math.floor(now/1000)-i*86400},verifiedTimestamp:{seconds:Math.floor(now/1000)-i*86400},wallet:{balance:12345-i*100},purchaseCOIN:{amountCummulate:2000-i*10},contract:{amountCummulate:5000-i*40},userChain:{index:350-i,currentMessage:'Recorded contribution '+i}}));
const feeds={user:()=>profile,create:()=>new ProfilePageSession((after,next,error)=>{requests++;const offset=after?records.findIndex(r=>r.id===after.id)+1:0;if(mode==='error')queueMicrotask(error);else if(mode!=='loading')queueMicrotask(()=>next((mode==='empty'?[]:records.slice(offset,offset+31)).map(row=>({id:row.id,data:()=>row}))));return new Subscription(()=>stops++);})};
@Component({${await metadata('profile.component')}})
class Area extends ProfileComponent {constructor(){super(UI as any,router as any,{params} as any,feeds as any,{lastActiveAt:()=>new BehaviorSubject(now)} as any,{canSign:()=>false,startChat:async()=> 'new-chat'} as any,cursor as any,{authState:auth} as any,inject(ChangeDetectorRef));}}
@Component({${await metadata('profile/profile-ledger.component','app-profile-ledger')}})
class Ledger extends ProfileLedgerComponent {constructor(){super(UI as any);}}
@Component({${await metadata('conversation-list/conversation-list.component','app-conversation-list')}})
class List extends ConversationListComponent {constructor(){super(UI as any);}}
const sidebarRows=new BehaviorSubject(records.slice(0,30).map(row=>({payload:{doc:{id:row.id,data:()=>row}}})));
@Component({${await metadata('sidebar-conversations/sidebar-conversations.component','app-sidebar-conversations')}})
class Sidebar extends SidebarConversationsComponent {constructor(){super({human:()=>sidebarRows} as any,cursor as any,{authState:auth} as any,{updateConversations(){},clear(){}} as any,UI as any,router as any,{onStable:new Subject(),run:fn=>fn()} as any,inject(ChangeDetectorRef));}}
TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());
TestBed.configureTestingModule({imports:[CommonModule,AgChartsAngular,RouterTestingModule.withRoutes([])],declarations:[Area,Ledger,List,Sidebar,UserAvatarComponent],providers:[provideZoneChangeDetection()]});
const sidebar=TestBed.createComponent(Sidebar),fixture=TestBed.createComponent(Area);
document.querySelector('.sideProfile').append(sidebar.nativeElement);document.querySelector('#main_container').append(fixture.nativeElement);
sidebar.autoDetectChanges();fixture.autoDetectChanges();sidebar.detectChanges();fixture.detectChanges();
window.profileUI={profile(value){profile.next(value);fixture.detectChanges();},own(){UI.currentUser='person';fixture.detectChanges();},long(){profile.next({...record,name:'A contributor with a very long name that should wrap comfortably',userPresentation:'A long presentation '.repeat(12)});fixture.detectChanges();},state(value){mode=value;},route(id){params.next({id});fixture.detectChanges();},counts(){return{requests,stops}},navigation(){return navigation},record,reset(){profile.next(record);fixture.detectChanges();}};
`);
await build({entryPoints:[output+'/entry.ts'],outfile:output+'/bundle.js',bundle:true,platform:'browser',format:'iife',nodePaths:[root+'/node_modules'],tsconfigRaw:{compilerOptions:{experimentalDecorators:true}},logLevel:'silent',plugins:[{name:'angular-resources',setup(plugin){
  plugin.onLoad({filter:/\.component\.ts$/},async args=>{
    let source=await readFile(args.path,'utf8');
    const template=/templateUrl:\s*'([^']+)'/.exec(source),style=/styleUrls:\s*\[([^\]]+)\]/.exec(source);
    if(template)source=source.replace(template[0],'template: '+JSON.stringify(await readFile(resolve(dirname(args.path),template[1]),'utf8')));
    if(style)source=source.replace(style[0],'styles: '+JSON.stringify(await Promise.all([...style[1].matchAll(/'([^']+)'/g)].map(([,name])=>readFile(resolve(dirname(args.path),name),'utf8')))));
    return{contents:source,loader:'ts',resolveDir:dirname(args.path)};
  });
}}]});
const globalStyles=await readFile(root+'/src/styles.css','utf8');
const server=createServer(async(req,res)=>{
 res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');
 res.end(req.url==='/bundle.js'?await readFile(output+'/bundle.js'):`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${globalStyles}\napp-root{display:flex;height:100vh}.sideProfile{width:260px;flex-shrink:0;overflow-y:auto}#main_container{flex:1;min-width:0;overflow-y:auto}@media(max-width:899px){.sideProfile{display:none}}</style></head><body><app-root><aside class="sideProfile"></aside><div id="main_container"></div></app-root><script src="/bundle.js"></script></body></html>`);
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
try {
 const page=await browser.newPage(),errors=[];
 await page.addInitScript(() => {
  window.chartText=[];
  const draw=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,...args){
   if(window.chartText.length<10000)window.chartText.push(String(text));
   return draw.call(this,text,...args);
  };
 });
 page.setDefaultTimeout(10000);
 page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
 const origin='http://127.0.0.1:'+server.address().port;
 await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 for(const width of [1440,768,390,320]) {
  await page.setViewportSize({width,height:900});await page.goto(origin);
  await page.getByRole('heading',{name:'Alex Morgan',exact:true}).waitFor();
  assert.equal(await page.getByRole('tab',{name:'Overview',exact:true}).getAttribute('aria-selected'),'true');
  assert.equal((await page.evaluate(()=>window.profileUI.counts())).requests,0);
  assert.equal(await page.locator('.profile-photo').innerText(),'AM');
  const originBox=await page.locator('#main_container').boundingBox();
  const stable=async()=>{assert.deepEqual(await page.locator('#main_container').boundingBox(),originBox);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);};
  await stable();await page.screenshot({path:output+'/overview-'+width+'.png'});
  await page.evaluate(()=>window.profileUI.long());await stable();
  await page.evaluate(()=>window.profileUI.reset());
  await page.getByRole('tab',{name:'Inbox',exact:true}).click();await page.locator('.tab-content .conversation').first().waitFor();
  assert.equal(await page.locator('.tab-content .conversation').count(),30);
  await page.getByRole('button',{name:'Load more',exact:true}).last().click();
  await page.waitForFunction(()=>document.querySelectorAll('.tab-content .conversation').length===60);await stable();
  await page.getByRole('tab',{name:'History',exact:true}).click();await page.locator('caption').filter({hasText:'Monthly history'}).waitFor();
  await page.locator('ag-charts-angular canvas').first().waitFor();await stable();
  await page.waitForFunction(()=>window.chartText.some(text=>/^\d+(?:\.\d+)?[KM]?$/.test(text)));
  assert.equal(await page.evaluate(()=>window.chartText.includes('—')),false,'axis ticks render numbers, including AG whole-number strings');
  const heads=await page.locator('.tab-content thead th').evaluateAll(cells=>cells.map(cell=>({top:cell.getBoundingClientRect().top,height:cell.getBoundingClientRect().height})));
  assert.ok(heads.every(cell=>cell.top===heads[0].top && cell.height>=36),'ledger headers share one readable row: '+JSON.stringify(heads));
  assert.ok(await page.locator('.ledger-scroll').evaluate(el=>el.scrollWidth>el.clientWidth),'wide history scrolls locally');
  await page.screenshot({path:output+'/history-'+width+'.png'});
  const chartArea=page.locator('ag-charts-angular');await chartArea.scrollIntoViewIfNeeded();
  const chartBounds=await chartArea.boundingBox();
  const tooltip=page.locator('.ag-chart-tooltip:not(.ag-chart-tooltip-hidden) .ag-chart-tooltip-content');
  for(const y of [0.2,0.3,0.4,0.5,0.6]) {
   await page.mouse.move(chartBounds.x+chartBounds.width*0.6,chartBounds.y+chartBounds.height*y);
   if(await tooltip.isVisible())break;
   await page.waitForTimeout(80);
  }
  await tooltip.waitFor();assert.match(await tooltip.innerText(),/: -?[\d.,]+(?:[KM]|e[+-]?\d+)? USD$/);
  await page.mouse.move(0,0);
  await page.getByRole('tab',{name:'Chain',exact:true}).click();await page.locator('caption').filter({hasText:'Message chain'}).waitFor();await stable();
  await page.getByRole('tab',{name:'Balance illustration',exact:true}).click();await page.locator('caption').filter({hasText:'Balance illustration'}).waitFor();await stable();
  assert.equal(await page.locator('.tab-content tbody tr').count(),20);
  await page.getByRole('tab',{name:'Overview',exact:true}).click();await page.getByRole('tab',{name:'Overview',exact:true}).press('ArrowRight');
  assert.equal(await page.getByRole('tab',{name:'Inbox',exact:true}).getAttribute('aria-selected'),'true');
  for(const state of ['empty','error','loading']) {
   await page.getByRole('tab',{name:'Overview',exact:true}).click();await page.evaluate(state=>window.profileUI.state(state),state);
   await page.getByRole('tab',{name:'Inbox',exact:true}).click();
   await page.getByText(state==='empty'?'No conversations yet.':state==='error'?'Couldn’t load this section.':'Loading',{exact:true}).waitFor();await stable();
  }
  await page.evaluate(()=>window.profileUI.own());await page.getByRole('link',{name:'Settings',exact:true}).waitFor();
  await page.evaluate(()=>window.profileUI.profile(null));await page.getByText('User not found.',{exact:true}).waitFor();await stable();
  assert.equal(await page.getByText('Contribute funds',{exact:true}).count(),0);
  if(width===1440){assert.equal((await page.locator('.sideProfile .conversation').first().boundingBox()).height,42);await page.locator('.sideProfile .conversation').first().focus();await page.keyboard.press('Enter');assert.ok((await page.evaluate(()=>window.profileUI.navigation())).length);}
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({output,widths:[1440,768,390,320],checks:['overview and contribution totals','all tabs and charts','pagination','loading/error/empty','keyboard tabs','settings action','no horizontal page overflow','stable shell','compact sidebar'],errors}));
} finally {await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
