// Render real Chat markup, behavior and shared avatars with synthetic data, without Firebase.
// PLAYWRIGHT_MODULE may point to a bundled Playwright installation.
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
const output = await mkdtemp(resolve(tmpdir(), 'perrinn-chat-avatars-'));
const template = await readFile(root + '/src/app/chat/chat.component.html', 'utf8');
const styles = await readFile(root + '/src/app/chat/chat.component.css', 'utf8');
const profileTemplate = await readFile(root + '/src/app/profile.component.html', 'utf8');
const sidebarAvatar = profileTemplate.match(/<app-user-avatar class="profile-list-avatar"[\s\S]*?<\/app-user-avatar>/)[0];
const profileStyles = await readFile(root + '/src/app/profile.component.css', 'utf8');
await writeFile(output + '/entry.ts', `
import 'zone.js'; import '@angular/compiler';
import {Component,NO_ERRORS_SCHEMA,provideZoneChangeDetection} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {BrowserDynamicTestingModule,platformBrowserDynamicTesting} from '@angular/platform-browser-dynamic/testing';
import {CommonModule} from '@angular/common'; import {FormsModule} from '@angular/forms';
import {EMPTY} from 'rxjs';
import {ChatComponent} from '${root}/src/app/chat/chat.component';
import {UserAvatarComponent} from '${root}/src/app/user-avatar.component';
let failSave=false,writes=[];
const data={updateDetails:async(chain,changes)=>{if(failSave)throw Error('offline');writes.push({chain,subject:changes.subject,image:changes.image?.name});},fundCurrency:{code:'gbp',perGBP:1}};
@Component({standalone:false,template:${JSON.stringify(template)},styles:[${JSON.stringify(styles)}]})
class Area extends ChatComponent {
 constructor(){super({paramMap:EMPTY} as any,{} as any,data as any,{} as any,{run:fn=>fn()} as any,{error:'',attach(){},scan(){}} as any,{} as any,{mode:'text',configure(){},unlock(){}} as any);
 this.state='empty';this.chain='synthetic';this.title='Engineering Team';this.signedIn=true;this.avatarSources=['/broken.png','/photo.svg'];}
}
@Component({standalone:false,template:${JSON.stringify('<ul class="sidebar-conversations listLight"><li><div class="prof-avatar-wrap">'+sidebarAvatar+'</div><span>Engineering Team</span></li></ul>')},styles:[${JSON.stringify(profileStyles)}]})
class SidebarArea {record={chain:'team',user:'author',name:'Alex Morgan',chatSubject:'Engineering Team',chatProfileImageUrlThumb:'/broken.png',chatProfileImageUrlMedium:'/photo.svg'};message={payload:{doc:{data:()=>this.record}}};}
TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());
TestBed.configureTestingModule({imports:[CommonModule,FormsModule],declarations:[Area,SidebarArea,UserAvatarComponent],schemas:[NO_ERRORS_SCHEMA],providers:[provideZoneChangeDetection()]});
const fixture=TestBed.createComponent(Area);document.body.append(fixture.nativeElement);fixture.autoDetectChanges();fixture.detectChanges();
window.avatarUI={sidebar(){fixture.destroy();fixture.nativeElement.remove();const sidebar=TestBed.createComponent(SidebarArea);document.body.append(sidebar.nativeElement);sidebar.autoDetectChanges();sidebar.detectChanges();window.sidebarUI={missing(){sidebar.componentInstance.record.chatProfileImageUrlThumb='';sidebar.componentInstance.record.chatProfileImageUrlMedium='';sidebar.detectChanges();}};},flush(){fixture.detectChanges();},sources(values){fixture.componentInstance.avatarSources=values;fixture.detectChanges();},state(value){fixture.componentInstance.state=value;fixture.detectChanges();},fail(value){failSave=value;},writes(){return writes;},title(value){fixture.componentInstance.title=value;fixture.detectChanges();}};
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
 if(req.url==='/broken.png'){res.writeHead(404);res.end();return;}
 if(req.url==='/photo.svg'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#344552"/><circle cx="40" cy="40" r="24" fill="#E5C477"/></svg>');return;}
 res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');
 res.end(req.url==='/bundle.js'?await readFile(output+'/bundle.js'):`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${globalStyles}\nhtml,body{margin:0;width:100%;height:100%}body>ng-component{display:block;height:100%}</style></head><body><script src="/bundle.js"></script></body></html>`);
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {})});
try{
 const page=await browser.newPage(),errors=[];page.setDefaultTimeout(10000);
 // Broken-image HTTP failures are intentional; JavaScript failures remain fatal.
 page.on('pageerror',error=>(errors.push(error.message),console.error(error.message)));
 const origin='http://127.0.0.1:'+server.address().port;
 await page.route('**/*',route=>route.request().url().startsWith(origin)||route.request().url().startsWith('blob:')?route.continue():route.abort());
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:850});await page.goto(origin);
  const header=page.locator('.chat-avatar'),details=page.locator('.details-avatar');
  await page.waitForFunction(()=>document.querySelector('.chat-avatar img')?.getAttribute('src')==='/photo.svg');
  assert.equal((await header.boundingBox()).width,44);
  const frame=await page.locator('.chat-frame').boundingBox();
  await page.getByRole('button',{name:'Chat details: Engineering Team'}).click();
  await details.waitFor();assert.equal((await details.boundingBox()).width,80);
  const stable=async()=>{
   assert.deepEqual(await page.locator('.chat-frame').boundingBox(),frame);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.equal((await details.boundingBox()).width,80);
  };
  await page.evaluate(()=>window.avatarUI.sources(['/broken.png']));
  await page.waitForFunction(()=>!document.querySelector('.details-avatar img'));
  assert.equal(await details.innerText(),'ET');await stable();
  await page.evaluate(()=>window.avatarUI.sources([]));await stable();
  await page.evaluate(()=>window.avatarUI.sources(['/photo.svg']));
  await details.locator('img').waitFor();await stable();
  await page.getByRole('button',{name:'Edit chat',exact:true}).click();
  await page.getByLabel('Subject',{exact:true}).fill('Design Review');
  assert.equal(await details.locator('.initials').innerText(),'DR');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a12sAAAAASUVORK5CYII=','base64');
  const choose=()=>page.locator('input[type=file]').setInputFiles({name:'preview.png',mimeType:'image/png',buffer:png});
  await choose();assert.match(await details.locator('img').getAttribute('src'),/^blob:/);await stable();
  await page.getByRole('button',{name:'Undo image change'}).click();
  assert.equal(await details.locator('img').getAttribute('src'),'/photo.svg');await stable();
  await choose();await page.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await details.locator('img').getAttribute('src'),'/photo.svg');
  assert.equal(await details.locator('.initials').innerText(),'ET');
  assert.deepEqual(await page.evaluate(()=>window.avatarUI.writes()),[]);
  await page.getByRole('button',{name:'Edit chat',exact:true}).click();await choose();
  await page.evaluate(()=>window.avatarUI.fail(true));await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.evaluate(()=>window.avatarUI.flush());await page.getByRole('alert').waitFor();assert.match(await details.locator('img').getAttribute('src'),/^blob:/);await stable();
  await page.evaluate(()=>window.avatarUI.fail(false));await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.evaluate(()=>window.avatarUI.flush());await page.getByRole('button',{name:'Edit chat',exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.avatarUI.writes()),[{chain:'synthetic',subject:undefined,image:'preview.png'}]);
  assert.equal(await details.locator('img').getAttribute('src'),'/photo.svg');await stable();
  await page.screenshot({path:output+'/details-'+width+'.png'});
  await page.getByRole('button',{name:'Close chat details'}).click();
  assert.equal((await header.boundingBox()).width,44);
  for(const state of ['loading','error','empty']){
   await page.evaluate(state=>window.avatarUI.state(state),state);
   assert.deepEqual(await page.locator('.chat-frame').boundingBox(),frame);
  }
  await page.screenshot({path:output+'/header-'+width+'.png'});
  await page.evaluate(()=>window.avatarUI.sidebar());
  const sidebar=page.locator('.profile-list-avatar');
  await page.waitForFunction(()=>document.querySelector('.profile-list-avatar img')?.getAttribute('src')==='/photo.svg');
  assert.equal((await sidebar.boundingBox()).width,24);
  await page.evaluate(()=>window.sidebarUI.missing());
  assert.equal(await sidebar.innerText(),'ET');assert.equal(await sidebar.locator('img').count(),0);
  assert.equal((await sidebar.boundingBox()).width,24);
  await page.screenshot({path:output+'/sidebar-'+width+'.png'});
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({output,widths:[1440,390,320],checks:['image fallback','initials','image replacement','preview','undo','cancel','save failure/retry','stable avatar/frame','loading/error/empty','no overflow','sidebar photo/fallback and dimensions'],errors}));
}finally{await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
