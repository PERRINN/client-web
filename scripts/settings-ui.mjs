// Production Angular Settings with synthetic services: no Firebase/network requests.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(import.meta.dirname, '..'), output = await mkdtemp(resolve(tmpdir(), 'perrinn-settings-ui-'));
const template = await readFile(root+'/src/app/settings.component.html','utf8'), css = await readFile(root+'/src/app/settings.component.css','utf8');
await writeFile(output+'/entry.ts', `
import 'zone.js';import '@angular/compiler';
import {Component,ChangeDetectorRef,EnvironmentInjector,NgZone,inject,provideZoneChangeDetection} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {BrowserDynamicTestingModule,platformBrowserDynamicTesting} from '@angular/platform-browser-dynamic/testing';
import {CommonModule} from '@angular/common';import {FormsModule} from '@angular/forms';import {RouterTestingModule} from '@angular/router/testing';
import {BehaviorSubject} from 'rxjs';
import {SettingsComponent} from '${root}/src/app/settings.component';
import {SettingsDataService} from '${root}/src/app/settings/settingsData.service';
import {UserAvatarComponent} from '${root}/src/app/user-avatar.component';
const record={name:'Alex',userPresentation:'Engineering the future of 424.',publicLink:'https://example.test',userCurrency:'usd',wallet:{balance:1245},contract:{level:3,levelTimeAdjusted:3.5,signed:true,createdTimestamp:1234567890123}};
const authState=new BehaviorSubject({uid:'owner'}),rows=new BehaviorSubject([record]),writes=[];let mode='ready',finish,service,queries=0;
const UI={currentUser:'owner',currentUserLastMessageObj:record,PERRINNAdminLastMessageObj:{currencyList:{usd:{designation:'US Dollar'},gbp:{designation:'British Pound Sterling'},eur:{designation:'Euro'}},contract:{hourlyRateLevel1:10}},profileSimulatorLoggedOut:false,
 convertAndFormatPRNToPRNCurrency:(_,n)=>'PRN '+n.toLocaleString('en-GB'),showFullScreenImage(){},logout(){UI.currentUser=null;authState.next(null);},
 toggleprofileSimulatorLoggedOut(){UI.profileSimulatorLoggedOut=!UI.profileSimulatorLoggedOut;UI.currentUser=UI.profileSimulatorLoggedOut?null:'owner';},
 async createMessage(message){writes.push(message);if(mode==='pending')await new Promise(resolve=>finish=resolve);if(mode==='error')throw Error('offline');}}
const email={currentAddress:'current@example.test',address:'current@example.test',password:'',status:'Verify the new address by email.',busy:false,canSend:false,edit(){},cancel(){},send:async()=>{},refresh:async()=>{}};
const wake={state$:new BehaviorSubject('off'),enabled:false,supported:true,toggle(){this.enabled=!this.enabled;this.state$.next(this.enabled?'on':'off');}};
@Component({selector:'settings',standalone:false,providers:[],template:${JSON.stringify(template)},styles:[${JSON.stringify(css)}]})
class Area extends SettingsComponent{constructor(){const settings=new SettingsDataService({authState,get currentUser(){return Promise.resolve(authState.value)}} as any,{collection:(_,build)=>{queries++;const query={where:()=>query,orderBy:()=>query,limit:n=>{if(n!==1)throw Error('unbounded');return query;}};build(query);return{valueChanges:()=>rows};}} as any,{upload:async()=> 'pasted-photo'} as any,UI as any,inject(EnvironmentInjector),inject(NgZone));service=settings;super(settings,UI as any,email as any,wake as any,inject(ChangeDetectorRef));}ngOnDestroy(){super.ngOnDestroy();service.ngOnDestroy();}}
TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());
TestBed.configureTestingModule({imports:[CommonModule,FormsModule,RouterTestingModule.withRoutes([])],declarations:[Area,UserAvatarComponent],providers:[provideZoneChangeDetection()]});
const fixture=TestBed.createComponent(Area);document.querySelector('.contentCard').append(fixture.nativeElement);fixture.autoDetectChanges();fixture.detectChanges();
window.settingsUI={mode(value){mode=value;},async finish(){finish?.();await new Promise(resolve=>setTimeout(resolve,0));fixture.detectChanges();},state(value){if(value==='loading')service.loading=true;if(value==='error'){service.loading=false;service.unavailable=true;}fixture.detectChanges();},stats(){return{queries,writes}},wake(value){wake.state$.next(value);wake.supported=value!=='unsupported';fixture.detectChanges();}};
`);
await build({entryPoints:[output+'/entry.ts'],outfile:output+'/bundle.js',bundle:true,platform:'browser',format:'iife',nodePaths:[root+'/node_modules'],tsconfigRaw:{compilerOptions:{experimentalDecorators:true}},logLevel:'silent',plugins:[{name:'angular-resources',setup(plugin){
plugin.onLoad({filter:/\.component\.ts$/},async args=>{let source=await readFile(args.path,'utf8');const template=/templateUrl:\s*'([^']+)'/.exec(source),style=/styleUrls:\s*\[([^\]]+)\]/.exec(source);if(template)source=source.replace(template[0],'template:'+JSON.stringify(await readFile(resolve(dirname(args.path),template[1]),'utf8')));if(style)source=source.replace(style[0],'styles:'+JSON.stringify(await Promise.all([...style[1].matchAll(/'([^']+)'/g)].map(([,name])=>readFile(resolve(dirname(args.path),name),'utf8')))));return{contents:source,loader:'ts',resolveDir:dirname(args.path)};});}}]});
const globalStyles=await readFile(root+'/src/styles.css','utf8');
const server=createServer(async(req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?await readFile(output+'/bundle.js'):`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${globalStyles}\napp-root{display:flex;height:100dvh}.sideProfile{width:260px;flex-shrink:0}#main_container{flex:1;min-width:0;overflow-y:auto;padding:16px}.contentWrap{max-width:980px;margin:auto}.contentCard{overflow:visible}@media(max-width:899px){.sideProfile{display:none}#main_container{padding:0 8px}}</style></head><body><app-root><aside class="sideProfile"></aside><div id="main_container"><div class="contentWrap"><div class="contentCard"></div></div></div></app-root><script src="/bundle.js"></script></body></html>`);});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
try{
 const page=await browser.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{read:async()=>{
   if(window.clipboardFail)throw Error('denied');
   return[{types:['image/png'],getType:async()=>new Blob(['synthetic'],{type:'image/png'})}];
  }}});
 });
 const origin='http://127.0.0.1:'+server.address().port;await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:900});await page.goto(origin);await page.getByLabel('First name',{exact:true}).waitFor();
  const shell=await page.locator('#main_container').boundingBox();
  const stable=async()=>{assert.deepEqual(await page.locator('#main_container').boundingBox(),shell);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.locator('.settings-page').evaluate(el=>el.scrollWidth>el.clientWidth),false);};
  assert.equal(await page.getByRole('tab').count(),0);assert.equal(await page.getByRole('heading',{level:2}).count(),5);
  assert.equal((await page.evaluate(()=>window.settingsUI.stats())).queries,1);
  assert.equal(await page.locator('.photo-row').evaluate(el=>el.scrollWidth>el.clientWidth),false);
  await stable();await page.screenshot({path:output+'/settings-'+width+'.png',fullPage:true});
  const name=page.getByLabel('First name',{exact:true}),save=page.getByRole('button',{name:'Save changes',exact:true});
  await name.fill('Sam');await page.getByRole('button',{name:'Cancel',exact:true}).first().click();assert.equal(await name.inputValue(),'Alex');
  await name.fill('Sam');await page.getByLabel('Short presentation',{exact:true}).fill('Building 424 together.');await page.evaluate(()=>window.settingsUI.mode('pending'));await save.click();
  await page.getByRole('button',{name:'Saving',exact:true}).waitFor();assert.equal(await name.isDisabled(),true);await stable();
  await page.evaluate(()=>window.settingsUI.finish());await page.getByText('Saved',{exact:true}).waitFor();await stable();
  assert.equal((await page.evaluate(()=>window.settingsUI.stats())).writes.length,1);
  await name.fill('Taylor');await page.evaluate(()=>window.settingsUI.mode('error'));await save.click();await page.getByText('Profile couldn’t save. Try again.',{exact:true}).waitFor();assert.equal(await name.inputValue(),'Taylor');await stable();
  await page.getByRole('button',{name:'Cancel',exact:true}).first().click();await page.evaluate(()=>window.settingsUI.mode('ready'));
  const select=page.getByLabel('Preferred currency',{exact:true});await select.selectOption('gbp');await page.waitForFunction(()=>window.settingsUI.stats().writes.length===3);assert.equal(await select.inputValue(),'gbp');
  const bounds=await select.boundingBox();assert.ok(bounds.height>=44&&bounds.x+bounds.width<=width);assert.ok(await select.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=16));
  await page.getByRole('switch',{name:'Keep screen on',exact:true}).click();assert.equal(await page.getByRole('switch',{name:'Keep screen on',exact:true}).getAttribute('aria-checked'),'true');
  await page.getByLabel('Contract level',{exact:true}).fill('5');await page.getByRole('button',{name:'Update contract',exact:true}).click();await page.getByText('Submitted for signature',{exact:true}).waitFor();await stable();
  const simulator=page.getByRole('switch',{name:'Profile simulator · Logged-out preview',exact:true});await simulator.click();assert.equal(await save.isDisabled(),true);await simulator.click();assert.equal(await name.isDisabled(),false);await stable();
  await page.getByRole('button',{name:'Change photo',exact:true}).click();await page.getByRole('dialog').waitFor();await page.screenshot({path:output+'/photo-chooser-'+width+'.png'});await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').isVisible(),false);
  await page.getByRole('button',{name:'Change photo',exact:true}).click();await page.getByRole('button',{name:'Paste image',exact:true}).click();await page.waitForFunction(()=>window.settingsUI.stats().writes.at(-1)?.imageUrlOriginal==='pasted-photo');
  const count=(await page.evaluate(()=>window.settingsUI.stats())).writes.length;
  await page.getByRole('button',{name:'Change photo',exact:true}).click();await page.getByRole('dialog').evaluate(el=>{const data=new DataTransfer();data.items.add(new File(['synthetic'],'pasted.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
  await page.waitForFunction(count=>window.settingsUI.stats().writes.length===count+1,count);
  await page.evaluate(()=>window.clipboardFail=true);await page.getByRole('button',{name:'Change photo',exact:true}).click();await page.getByRole('button',{name:'Paste image',exact:true}).click();await page.getByText('Use Paste (⌘V or Ctrl+V) here, or choose a photo.',{exact:true}).waitFor();await stable();
  const chooserEvent=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload photo',exact:true}).click();const chooser=await chooserEvent;await chooser.setFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from('synthetic')});
  await page.waitForFunction(count=>window.settingsUI.stats().writes.length===count+2,count);await stable();
  await page.evaluate(()=>window.settingsUI.wake('unsupported'));await page.getByText('Not supported by this browser.',{exact:true}).waitFor();await stable();
  await page.evaluate(()=>window.settingsUI.state('loading'));await page.getByText('Loading',{exact:true}).waitFor();await stable();
  await page.evaluate(()=>window.settingsUI.state('error'));await page.getByRole('button',{name:'Try again',exact:true}).click();await name.waitFor();await stable();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('link',{name:'Sign in',exact:true}).waitFor();await stable();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({output,widths:[1440,768,390,320],checks:['single scrolling view','Save/Cancel','pending/failure','currency','photo chooser/upload/paste','contract','simulator','wake lock','loading/error/retry/sign-out','stable shell/no overflow'],errors}));
}finally{await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
