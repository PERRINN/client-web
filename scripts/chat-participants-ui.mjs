// Real Angular Chat/details/participant markup with synthetic services; no Firebase traffic.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(import.meta.dirname, '..'), output = await mkdtemp(resolve(tmpdir(), 'perrinn-participants-ui-'));
const template = await readFile(root + '/src/app/chat/chat.component.html', 'utf8');
const styles = await readFile(root + '/src/app/chat/chat.component.css', 'utf8');
await writeFile(output + '/entry.ts', `
import 'zone.js'; import '@angular/compiler';
import {Component,NgZone,NO_ERRORS_SCHEMA,provideZoneChangeDetection} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {BrowserDynamicTestingModule,platformBrowserDynamicTesting} from '@angular/platform-browser-dynamic/testing';
import {CommonModule} from '@angular/common'; import {FormsModule} from '@angular/forms'; import {EMPTY,BehaviorSubject} from 'rxjs';
import {ChatComponent} from '${root}/src/app/chat/chat.component';
import {ChatComposerComponent} from '${root}/src/app/chat/chat-composer/chat-composer.component';
import {ChatParticipantsComponent} from '${root}/src/app/chat/chat-participants/chat-participants.component';
import {ChatParticipantsService} from '${root}/src/app/chat/chat-participants/chatParticipants.service';
import {ChatDataService} from '${root}/src/app/chat/chatData.service';
import {PermissionsService} from '${root}/src/app/permissions.service';
import {UserAvatarComponent} from '${root}/src/app/user-avatar.component';
const alex={id:'alex',name:'Alex With A Long Contributor Name',avatarName:'Alex With A Long Contributor Name',avatar:'',balance:12500};
const state=new BehaviorSubject({uid:'admin',isAdmin:true,ready:true});
const permissions={state,get current(){return state.value}};
let fail=false,requests=[],searches=0,resolveSearch;
const directory={search:async()=>{searches++;if(fail)throw Error('offline');return new Promise(resolve=>resolveSearch=()=>resolve({people:[alex],hasMore:false}));}};
const data={participantBalance:amount=>amount==null?'PRN —':'PRN £'+amount.toLocaleString('en-GB'),fundCurrency:{code:'gbp',perGBP:1},changeParticipant:async(chain,action,person)=>{if(fail)throw Error('offline');requests.push({chain,action,person});return 'saved-'+requests.length;}};
@Component({standalone:false,template:${JSON.stringify(template)},styles:[${JSON.stringify(styles)}]})
class Area extends ChatComponent {
 constructor(){super({paramMap:EMPTY} as any,{} as any,data as any,{} as any,{run:fn=>fn()} as any,{error:'',attach(){},scan(){}} as any,{} as any,{mode:'text',configure(){},unlock(){}} as any);
 this.chain='engineering';this.title='Engineering';this.signedIn=true;this.state='ready';this.members=[{id:'admin',name:'You',avatarName:'Admin',avatar:''}];}
}
(ChatParticipantsComponent as any).ctorParameters=()=>[{type:PermissionsService},{type:ChatParticipantsService},{type:ChatDataService},{type:NgZone}];
TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());
TestBed.configureTestingModule({imports:[CommonModule,FormsModule],declarations:[Area,ChatComposerComponent,ChatParticipantsComponent,UserAvatarComponent],schemas:[NO_ERRORS_SCHEMA],providers:[provideZoneChangeDetection(),{provide:PermissionsService,useValue:permissions},{provide:ChatDataService,useValue:data},{provide:ChatParticipantsService,useValue:directory}]});
const fixture=TestBed.createComponent(Area);document.body.append(fixture.nativeElement);fixture.autoDetectChanges();fixture.detectChanges();
window.participantsUI={searchDone(){resolveSearch();},fail(value){fail=value;},confirm(){const request=requests.at(-1),area=fixture.componentInstance;area.members=request.action==='add'?[...area.members,request.person]:area.members.filter(p=>p.id!==request.person.id);area.messages=[{id:'saved-'+requests.length,verified:true} as any];fixture.detectChanges();},role(value){state.next({uid:value?'admin':'viewer',isAdmin:value,ready:true});fixture.detectChanges();},empty(){fixture.componentInstance.members=[];fixture.detectChanges();},requests(){return requests},searches(){return searches}};
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
const globals=await readFile(root+'/src/styles.css','utf8');
const server=createServer(async(req,res)=>{
 res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');
 res.end(req.url==='/bundle.js'?await readFile(output+'/bundle.js'):`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${globals}\nhtml,body{margin:0;width:100%;height:100%}body>ng-component{display:block;height:100%}</style></head><body><script src="/bundle.js"></script></body></html>`);
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
try {
 const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
 const origin='http://127.0.0.1:'+server.address().port;
 await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 for(const width of [1440,390,320]) {
  await page.setViewportSize({width,height:850});await page.goto(origin);
  await page.getByRole('button',{name:'Chat details: Engineering'}).click();
  const panel=page.locator('app-chat-participants'),frame=await page.locator('.chat-frame').boundingBox();
  const detailsBody=await page.locator('.details-body').boundingBox(),composer=width>700?await page.locator('.composer-area').boundingBox():null;
  const stable=async()=>{assert.deepEqual(await page.locator('.chat-frame').boundingBox(),frame);assert.deepEqual(await page.locator('.details-body').boundingBox(),detailsBody);if(composer)assert.deepEqual(await page.locator('.composer-area').boundingBox(),composer);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);};
  await panel.getByRole('button',{name:'Add',exact:true}).click();
  await page.getByRole('textbox',{name:'Contributor name'}).fill('Alex');
  await panel.getByRole('button',{name:'Search',exact:true}).click();
  await panel.getByRole('status').filter({hasText:'Loading'}).waitFor();await stable();
  await page.evaluate(()=>window.participantsUI.searchDone());
  const add=panel.getByRole('button',{name:'Add Alex With A Long Contributor Name',exact:true});await add.waitFor();
  await stable();assert.equal(await page.evaluate(()=>window.participantsUI.searches()),1);
  const balance=panel.getByLabel('PRN balance: PRN £12,500',{exact:true});await balance.waitFor();
  assert.equal(await balance.innerText(),'PRN £12,500');
  const row=await balance.locator('xpath=ancestor::li').boundingBox(),value=await balance.boundingBox();assert.ok(value.x>=row.x && value.x+value.width<=row.x+row.width);
  await page.screenshot({path:output+'/participant-balance-'+width+'.png'});
  if(width<600)assert.equal(await page.getByRole('textbox',{name:'Contributor name'}).evaluate(el=>getComputedStyle(el).fontSize),'16px');
  await page.getByRole('textbox',{name:'Contributor name'}).focus();
  assert.equal(await page.getByRole('textbox',{name:'Contributor name'}).evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
  await add.click();await panel.getByText('Updating participants',{exact:true}).waitFor();
  await stable();assert.equal(await page.getByRole('button',{name:'Close chat details'}).isDisabled(),true);
  await page.evaluate(()=>window.participantsUI.confirm());
  await panel.getByRole('button',{name:'Remove Alex With A Long Contributor Name',exact:true}).waitFor();
  await stable();
  await page.screenshot({path:output+'/participants-active-'+width+'.png'});
  await panel.getByRole('button',{name:'Done',exact:true}).click();
  await panel.getByRole('button',{name:'Remove Alex With A Long Contributor Name',exact:true}).click();
  await panel.getByRole('button',{name:'Keep',exact:true}).waitFor();
  await page.waitForFunction(()=>document.activeElement?.textContent==='Keep');
  await page.evaluate(()=>window.participantsUI.fail(true));
  await panel.getByRole('button',{name:'Remove participant',exact:true}).click();
  await panel.getByRole('alert').waitFor();await stable();
  assert.equal(await panel.getByRole('button',{name:'Remove participant',exact:true}).isEnabled(),true);
  await page.evaluate(()=>window.participantsUI.fail(false));
  await panel.getByRole('button',{name:'Remove participant',exact:true}).click();
  await panel.getByText('Updating participants',{exact:true}).waitFor();
  await page.evaluate(()=>window.participantsUI.confirm());
  assert.equal(await panel.getByRole('button',{name:'Remove Alex With A Long Contributor Name',exact:true}).count(),0);await stable();
  await panel.getByRole('button',{name:'Add',exact:true}).click();
  await page.evaluate(()=>window.participantsUI.role(false));
  assert.equal(await panel.getByRole('button').count(),0);assert.equal(await panel.getByRole('textbox').count(),0);await stable();
  await page.evaluate(()=>window.participantsUI.empty());await panel.getByText('No participants',{exact:true}).waitFor();await stable();
  await page.screenshot({path:output+'/participants-'+width+'.png'});
 }
 assert.deepEqual(errors,[]);console.log('Participant UI passed at 1440, 390 and 320px. Screenshots: '+output);
} finally {await browser.close();await new Promise(done=>server.close(done));}
