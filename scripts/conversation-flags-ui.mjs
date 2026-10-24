// Real sidebar/row/flag components and cursor service, sharing simulated Firestore records.
// No real account data, Firebase requests or writes. No detectChanges calls after async updates.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(import.meta.dirname, '..'), output = await mkdtemp(resolve(tmpdir(), 'perrinn-flags-ui-'));
const read = path => readFile(root + '/src/app/' + path, 'utf8');
const metadata = async (base, selector) => `standalone:false,selector:'${selector}',template:${JSON.stringify(await read(base + '.html'))},styles:[${JSON.stringify(await read(base + '.css'))}]`;
const shell = await read('app.component.html');
const dots = shell.slice(shell.indexOf('<ng-template #activityDots>'));
const home = await read('home.component.html');
const homeMentions = home.slice(home.indexOf('@if (UI.currentUser && mentionActivity'), home.indexOf('<div class="dashboard-grid">'));
const template = `<div class="appShell sidebarShell"><header class="mobileShellHeader"><button type="button">Menu</button><span class="mobile-brand">PERRINN<ng-container [ngTemplateOutlet]="activityDots" /></span></header>
<div class="shellSidebar sidebarOpen"><nav class="navLeft"><div class="shellBrandRow"><button class="iconBtn">PERRINN<ng-container [ngTemplateOutlet]="activityDots" /></button></div><button class="iconBtn">Team</button></nav>
<div class="conversationSpace"><section class="sideProfile"><app-sidebar-conversations /></section></div><div class="automaticSection"><div class="automaticList">Automatic updates</div></div><div class="navRight"><button class="accountRow">Account</button></div></div>
<div id="main_container"><div class="contentWrap"><div class="contentCard"><div class="chat-controls"><app-chat-flag chain="chat" /></div><h2>Inbox</h2><app-conversation-list class="inbox" [items]="items" [cursors]="cursors" /><app-home-mentions /></div></div></div></div>${dots}`;
await writeFile(output + '/entry.ts', `
import 'zone.js'; import '@angular/compiler';
import {Component,ChangeDetectorRef,NgZone,inject,provideZoneChangeDetection} from '@angular/core';
import {TestBed} from '@angular/core/testing';import {BrowserDynamicTestingModule,platformBrowserDynamicTesting} from '@angular/platform-browser-dynamic/testing';
import {CommonModule} from '@angular/common';import {BehaviorSubject,Observable,Subscription} from 'rxjs';
import {ReadCursorService} from '${root}/src/app/readCursor.service';
import {MessageActivityService} from '${root}/src/app/messageActivity.service';
import {ConversationListComponent} from '${root}/src/app/conversation-list/conversation-list.component';
import {SidebarConversationsComponent} from '${root}/src/app/sidebar-conversations/sidebar-conversations.component';
import {ChatFlagComponent} from '${root}/src/app/chat/chat-flag/chat-flag.component';
import {UserAvatarComponent} from '${root}/src/app/user-avatar.component';
const now=Date.now(),UI={currentUser:'viewer',nowSeconds:Math.floor(now/1000),currentUserLastMessageObj:{user:'viewer',name:'Alex',createdTimestamp:now-86400000*100}};
const records=[{id:'z',chain:'chat',user:'author',name:'Nico',chatSubject:'Engineering review',text:'Hello ALEX! The latest design is ready.',serverTimestamp:{seconds:Math.floor(now/1000)}},{id:'other',chain:'other',user:'author',name:'Nico',chatSubject:'Testing',text:'The next test is ready.',recipients:{viewer:true},serverTimestamp:{seconds:Math.floor(now/1000)-86400}}];
const rows=new BehaviorSubject(records.map(row=>({payload:{doc:{id:row.id,data:()=>row}}}))),auth=new BehaviorSubject({uid:'viewer'});
let zone,service,activity,fixture,rootInstance,failWrites=false;const listeners=new Map(),store=new Map(),writes=[],requests=[];
const path=chain=>'lastSeen/'+(auth.value?.uid||'viewer')+'/chats/'+chain;
const deliver=(target,record)=>zone.runOutsideAngular(()=>setTimeout(()=>{store.set(target,record);for(const entry of listeners.get(target)||[])entry.next(record);},5));
function setup(){if(service)return;zone=inject(NgZone);const afs={doc:target=>({valueChanges:()=>new Observable(observer=>{requests.push(target);if(!listeners.has(target))listeners.set(target,new Set());listeners.get(target).add(observer);zone.runOutsideAngular(()=>setTimeout(()=>observer.next(store.get(target)),10));return()=>listeners.get(target)?.delete(observer);}),set:(data,options)=>zone.runOutsideAngular(()=>new Promise((resolve,reject)=>setTimeout(()=>{if(failWrites){reject(Error('offline'));return;}const record={...store.get(target),...data};writes.push({target,data,options});store.set(target,record);for(const observer of listeners.get(target)||[])observer.next(record);resolve();},10)))})};service=new ReadCursorService(afs as any,TestBed.inject(EnvironmentInjector),zone);activity=new MessageActivityService(zone);}
import {EnvironmentInjector} from '@angular/core';
@Component({${await metadata('conversation-list/conversation-list.component','app-conversation-list')}})
class List extends ConversationListComponent {constructor(){super(UI as any);}}
@Component({${await metadata('sidebar-conversations/sidebar-conversations.component','app-sidebar-conversations')}})
class Sidebar extends SidebarConversationsComponent {constructor(){setup();super({human:()=>rows} as any,service,{authState:auth} as any,activity,UI as any,{url:'/chat/chat',navigate(){}} as any,zone,inject(ChangeDetectorRef));}}
@Component({${await metadata('chat/chat-flag/chat-flag.component','app-chat-flag')}})
class Flag extends ChatFlagComponent {constructor(){setup();super(service,{authState:auth} as any,zone,inject(ChangeDetectorRef));}}
@Component({standalone:false,selector:'app-home-mentions',template:${JSON.stringify(homeMentions)},styles:[${JSON.stringify(await read('home.component.css'))}]})
class Home {UI=UI;mentionActivity={userId:null,status:'signed-out',chats:[]};subscription;constructor(){setup();const cd=inject(ChangeDetectorRef);this.subscription=activity.mentions().subscribe(value=>{this.mentionActivity=value;cd.markForCheck();});}timeAgo(){return 'Now';}openChat(){}ngOnDestroy(){this.subscription.unsubscribe();}}
@Component({standalone:false,selector:'app-root',template:${JSON.stringify(template)},styles:[${JSON.stringify(await read('app.component.css'))},'.chat-controls{display:flex;justify-content:flex-end}h2{font-size:17px;margin:12px;line-height:1.35}']})
class Root {items=records;cursors;activitySummary;session;subscription;authSubscription;constructor(){setup();rootInstance=this;this.activitySummary=activity.summary();const cd=inject(ChangeDetectorRef);this.session=service.createSession();this.subscription=this.session.changes.subscribe(value=>{this.cursors=value;cd.markForCheck();});this.authSubscription=auth.subscribe(user=>{this.session.update(user?.uid||null,this.items.map(item=>item.chain));cd.markForCheck();});}ngOnDestroy(){this.subscription.unsubscribe();this.authSubscription.unsubscribe();this.session.destroy();}}
TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());
TestBed.configureTestingModule({imports:[CommonModule],declarations:[Root,List,Sidebar,Flag,Home,UserAvatarComponent],providers:[provideZoneChangeDetection()]});
fixture=TestBed.createComponent(Root);document.querySelector('app-root').replaceWith(fixture.nativeElement);fixture.autoDetectChanges();fixture.detectChanges();
window.flagsUI={read(){deliver(path('chat'),{...store.get(path('chat')),serverTimestamp:{seconds:records[0].serverTimestamp.seconds},messageId:'z'});},unread(){deliver(path('chat'),{...store.get(path('chat')),serverTimestamp:{seconds:1},messageId:'old'});},flag(value){deliver(path('chat'),{...store.get(path('chat')),blueFlag:value});},failOther(){zone.runOutsideAngular(()=>setTimeout(()=>{for(const observer of [...listeners.get(path('other'))||[]])observer.error(Error('offline'));},5));},retryInbox(){rootInstance.session.retry();},failWrite(value){failWrites=value;},signOut(){zone.runOutsideAngular(()=>setTimeout(()=>{UI.currentUser=null;UI.currentUserLastMessageObj=null;auth.next(null);},5));},requests(){return requests;},writes(){return writes;},closeDrawer(){document.querySelector('.shellSidebar').classList.remove('sidebarOpen');},openDrawer(){document.querySelector('.shellSidebar').classList.add('sidebarOpen');}};
`);
await build({entryPoints:[output+'/entry.ts'],outfile:output+'/bundle.js',bundle:true,platform:'browser',format:'iife',nodePaths:[root+'/node_modules'],tsconfigRaw:{compilerOptions:{experimentalDecorators:true}},logLevel:'silent',plugins:[{name:'angular-resources',setup(plugin){plugin.onLoad({filter:/\.component\.ts$/},async args=>{
 let source=await readFile(args.path,'utf8');const template=/templateUrl:\s*'([^']+)'/.exec(source),style=/styleUrls:\s*\[([^\]]+)\]/.exec(source);
 if(template)source=source.replace(template[0],'template: '+JSON.stringify(await readFile(resolve(dirname(args.path),template[1]),'utf8')));
 if(style)source=source.replace(style[0],'styles: '+JSON.stringify(await Promise.all([...style[1].matchAll(/'([^']+)'/g)].map(([,name])=>readFile(resolve(dirname(args.path),name),'utf8')))));
 return{contents:source,loader:'ts',resolveDir:dirname(args.path)};
});}}]});
const styles=await readFile(root+'/src/styles.css','utf8');
const server=createServer(async(req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?await readFile(output+'/bundle.js'):`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body><app-root></app-root><script src="/bundle.js"></script></body></html>`);});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
try{
 const page=await browser.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
 const origin='http://127.0.0.1:'+server.address().port;await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:900});await page.goto(origin);
  await page.locator('.sideProfile .dot.mention').waitFor();await page.locator('.inbox .dot.mention').waitFor();await page.locator('.mention-row').waitFor();
  const row=page.locator('.inbox .conversation').first(),date=row.locator('time'),preview=row.locator('.preview');
  const initialDate=await date.boundingBox(),initialPreview=await preview.boundingBox(),main=await page.locator('#main_container').boundingBox();
  const stable=async()=>{assert.deepEqual(await date.boundingBox(),initialDate);assert.deepEqual(await preview.boundingBox(),initialPreview);assert.deepEqual(await page.locator('#main_container').boundingBox(),main);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);};
  await page.evaluate(()=>window.flagsUI.closeDrawer());
  assert.match(await date.innerText(),/^\d{2}:\d{2}$/);assert.equal(await page.locator('.inbox time').nth(1).innerText(),'Yesterday');
  await page.getByRole('button',{name:'Flag conversation',exact:true}).click();
  await page.locator('.inbox .flagged').waitFor();await page.locator('.activity-dot.flagged-dot:visible').first().waitFor();
  assert.equal((await row.locator('.dot.flagged').boundingBox()).width,8);await stable();
  await page.evaluate(()=>window.flagsUI.read());await page.locator('.inbox .dot.mention').waitFor({state:'detached'});await page.locator('.mention-row').waitFor({state:'detached'});
  assert.equal(await row.locator('.flagged').count(),1);await stable();
  await page.getByRole('button',{name:'Remove conversation flag',exact:true}).click();await row.locator('.flagged').waitFor({state:'detached'});await stable();
  await page.evaluate(()=>window.flagsUI.failWrite(true));await page.getByRole('button',{name:'Flag conversation',exact:true}).click();await page.getByText('Flag couldn’t save. Try again.',{exact:true}).waitFor();assert.equal(await row.locator('.flagged').count(),0);
  await page.evaluate(()=>window.flagsUI.failWrite(false));await page.getByRole('button',{name:'Flag conversation',exact:true}).click();await row.locator('.flagged').waitFor();
  await page.evaluate(()=>window.flagsUI.failOther());await page.locator('.activity-unavailable:visible').first().waitFor();assert.equal(await row.locator('.flagged').count(),1);
  const before=(await page.evaluate(()=>window.flagsUI.requests())).length;
  await page.evaluate(()=>window.flagsUI.openDrawer());await page.locator('.sideProfile').getByRole('button',{name:'Try again',exact:true}).click();
  await page.evaluate(()=>window.flagsUI.retryInbox());await page.locator('.activity-unavailable:visible').first().waitFor({state:'detached'});
  assert.equal((await page.evaluate(()=>window.flagsUI.requests())).length,before+2);
  assert.equal((await page.locator('.sideProfile .conversation').first().boundingBox()).height,42);
  await page.screenshot({path:output+'/sidebar-'+width+'.png'});
  await page.evaluate(()=>window.flagsUI.closeDrawer());
  await page.screenshot({path:output+'/inbox-'+width+'.png'});
  await page.evaluate(()=>window.flagsUI.signOut());await page.locator('.inbox .flagged').waitFor({state:'detached'});await page.locator('app-chat-flag button').waitFor({state:'detached'});await page.locator('.sideProfile .flagged').waitFor({state:'detached'});
  const writes=await page.evaluate(()=>window.flagsUI.writes());assert.ok(writes.every(write=>write.target==='lastSeen/viewer/chats/chat'&&write.options.merge&&!('serverTimestamp'in write.data)));
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({output,widths:[1440,390,320],checks:['asynchronous rendering without user clicks','manual flag add/remove across all views','reading preserves manual flag','Home mentions clear on reading','8px dots','stable Inbox dates/previews','friendly dates','one-chain error isolation and explicit bounded retry','sign-out cleanup','no Firebase requests'],errors}));
}finally{await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
