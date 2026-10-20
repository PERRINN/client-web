// Render actual telemetry templates and overlay/chart components with synthetic data; no Firebase requests.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(import.meta.dirname, '../..');
const folder = root + '/src/app/greenpower-telemetry';
const output = await mkdtemp(resolve(tmpdir(), 'greenpower-overlay-ui-'));
await writeFile(output + '/entry.ts', `
import 'zone.js'; import '@angular/compiler';
import {NO_ERRORS_SCHEMA} from '@angular/core';
import {CommonModule} from '@angular/common';
import {TestBed} from '@angular/core/testing';
import {BrowserDynamicTestingModule,platformBrowserDynamicTesting} from '@angular/platform-browser-dynamic/testing';
import {Subject,BehaviorSubject} from 'rxjs';
import {By} from '@angular/platform-browser';
import {GreenpowerTelemetryComponent} from '${folder}/greenpower-telemetry.component';
import {GreenpowerTelemetryService} from '${folder}/greenpowerTelemetry.service';
import {GreenpowerLapService} from '${folder}/greenpowerLap.service';
import {GreenpowerEventsService} from '${folder}/greenpowerEvents.service';
import {GreenpowerEventEditService} from '${folder}/greenpowerEventEdit.service';
import {selectionFor} from '${folder}/greenpowerView';
import {GreenpowerOverlayComponent} from '${folder}/greenpower-overlay.component';
import {GreenpowerChartComponent} from '${folder}/greenpower-chart.component';
import {GreenpowerOverlayService} from '${folder}/greenpowerOverlay.service';
import {GreenpowerViewService} from '${folder}/greenpowerView.service';
import {overlayColour} from '${folder}/greenpowerOverlay';
const channels=(offset=0)=>['Current','Voltage left','Voltage right','Voltage diff','Speed'].map((label,index)=>({
 id:['["A"]:A','computed:voltage-left','computed:voltage-right','computed:voltage-diff','["Spd"]:m/s'][index],label,unit:index===4?'m/s':index?'V':'A',value:'20',
 points:Array.from({length:200},(_,i)=>({time:i*30000,value:(index===0?20:index===3?1:12)+Math.sin(i/15+offset)*(index===0?4:.5)}))
}));
const overlay:any={active:false,loading:false,more:false,error:'',sessions:[],changed:new Subject(),end:5970000,hasMore:false,
 get channels(){return channels()},get visibleSessions(){return this.sessions.filter(s=>s.loaded&&!s.hidden)},get status(){return this.loading?'Loading race sessions…':this.sessions.length+' sessions'},
 async load(reset=false){this.active=true;this.loading=true;this.changed.next();await new Promise(r=>setTimeout(r,80));
  this.sessions=Array.from({length:6},(_,i)=>({id:'session-'+i,label:'2026-06-'+(14+i)+' · '+(i%2?'Goodwood':'Dunsfold')+' · Driver '+(i+1),colour:overlayColour(i),loaded:true,hidden:false,channels:channels(i),session:{startAt:0,endAt:this.end}}));
  this.loading=false;this.changed.next()},
 toggleVisibility(id){this.sessions=this.sessions.map(s=>s.id===id?{...s,hidden:!s.hidden}:s);this.changed.next()},
 clear(){this.active=false;this.sessions=[];this.loading=false;this.error='';this.changed.next()}
};
let record={...selectionFor(channels()),revision:1,updatedBy:'admin'};
const writes:any[]=[];
const ref:any={onSnapshot(options,callback){callback({exists:true,data:()=>record,metadata:{}});return ()=>{}},firestore:{
 async runTransaction(callback){await callback({get:async()=>({data:()=>record}),set:(_,value)=>{record=value;writes.push(value)}})}
}};
const permissions:any={current:{uid:'admin',ready:true,isAdmin:true},state:new BehaviorSubject({uid:'admin',ready:true,isAdmin:true})};
const view=new GreenpowerViewService(permissions,{firestore:{doc:()=>ref}} as any);
const telemetry:any={changed:new Subject(),access:'signed-in',day:'2026-10-20',live:true,error:'',more:false,channels:[],loading:false,start:0,end:1000,tick(){},select(){},connected:true};
const lapConfig:any={changed:new Subject(),saving:false,line:null,fixes:[],ready:false,selectionReady:false,candidates:[],
 analysis:{laps:[],channel:{id:'computed:gps-lap',label:'GPS lap',unit:'',value:'—',points:[]}},select(){},syncEditing(value){this.editing=value},update(){},
 selectionWrite(){throw new Error('Overlay must not request a track write')}
};
const events:any={changed:new Subject(),canEdit:true};
const eventEdit:any={changed:new Subject(),saved:new Subject(),locked:false,mode:'',canEditSessions:true,cancel(){}};
TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());
TestBed.configureTestingModule({declarations:[GreenpowerTelemetryComponent,GreenpowerOverlayComponent,GreenpowerChartComponent],imports:[CommonModule],schemas:[NO_ERRORS_SCHEMA]});
TestBed.overrideComponent(GreenpowerTelemetryComponent,{set:{providers:[
 {provide:GreenpowerOverlayService,useValue:overlay},{provide:GreenpowerViewService,useValue:view},
 {provide:GreenpowerTelemetryService,useValue:telemetry},{provide:GreenpowerLapService,useValue:lapConfig},
 {provide:GreenpowerEventsService,useValue:events},{provide:GreenpowerEventEditService,useValue:eventEdit}
]}});
const fixture=TestBed.createComponent(GreenpowerTelemetryComponent);const detect=()=>{fixture.changeDetectorRef.markForCheck();fixture.detectChanges()};document.body.append(fixture.nativeElement);detect();
overlay.changed.subscribe(detect);view.changed.subscribe(detect);
window.overlayHarness={fixture,overlay,view,writes,lapConfig,comparison:fixture.debugElement.query(By.directive(GreenpowerOverlayComponent)).componentInstance,async detect(){detect()},set(state){Object.assign(overlay,state);overlay.changed.next();detect()}};
`);
await build({entryPoints:[output+'/entry.ts'],outfile:output+'/bundle.js',bundle:true,format:'esm',platform:'browser',
 nodePaths:[root+'/node_modules'],logLevel:'silent',tsconfigRaw:{compilerOptions:{experimentalDecorators:true}},
 plugins:[{name:'angular-jit',setup(builder){builder.onLoad({filter:/greenpower-(telemetry|overlay|chart)\.component\.ts$/},async args=>{
  let source=await readFile(args.path,'utf8');
  source=source.replace(/templateUrl: '([^']+)'/,(_,name)=>'template: '+JSON.stringify(require('node:fs').readFileSync(resolve(dirname(args.path),name),'utf8')))
   .replace(/styleUrls: \[\'([^']+)\'\]/,(_,name)=>'styles: ['+JSON.stringify(require('node:fs').readFileSync(resolve(dirname(args.path),name),'utf8'))+']');
  source += args.path.includes('greenpower-telemetry.component')
   ? '\n(GreenpowerTelemetryComponent as any).ctorParameters = () => [{type:GreenpowerTelemetryService},{type:ChangeDetectorRef},{type:Title},{type:GreenpowerViewService},{type:GreenpowerLapService},{type:GreenpowerEventsService},{type:GreenpowerEventEditService},{type:GreenpowerOverlayService}];'
   : args.path.includes('greenpower-overlay') ? '\n(GreenpowerOverlayComponent as any).ctorParameters = () => [{type:GreenpowerOverlayService},{type:GreenpowerViewService},{type:ChangeDetectorRef}];' : '\n(GreenpowerChartComponent as any).ctorParameters = () => [{type:ChangeDetectorRef},{type:NgZone}];';
  return {contents:ts.transpileModule(source,{compilerOptions:{experimentalDecorators:true,emitDecoratorMetadata:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,loader:'js'};
 })}}]});
const styles = await readFile(root+'/src/styles.css','utf8');
const server=createServer(async(req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(output+'/bundle.js'))}
 else{res.setHeader('Content-Type','text/html');res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+styles+' body{overflow:auto;height:auto} app-test{display:block}</style></head><body><script type="module" src="/bundle.js"></script></body></html>')}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.overlayHarness);
 for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844],['small-mobile',320,740]]) {
  await page.setViewportSize({width,height});await page.evaluate(()=>{window.overlayHarness.fixture.componentInstance.live();window.overlayHarness.detect()});
  const toolbar=page.locator('.actions');const initial=await toolbar.boundingBox();
  const overlayButton=page.getByRole('button',{name:'Overlay',exact:true});await overlayButton.click();await page.evaluate(()=>window.overlayHarness.detect());
  const after=await toolbar.boundingBox();assert.deepEqual(after,initial,'opening preserves toolbar geometry at '+width);
  await page.locator('#overlay-source').selectOption('2026-race');
  await page.waitForFunction(()=>window.overlayHarness.overlay.sessions.length===6&&!window.overlayHarness.overlay.loading);
  assert.equal(await page.getByRole('button',{name:'Track map',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Lap list',exact:true}).isDisabled(),true);
  assert.equal(await page.locator('app-greenpower-chart').count(),4);
  assert.equal(await page.locator('app-greenpower-chart').nth(2).locator('svg .trace').count(),12,'voltage has both traces per session');
  const chart=page.locator('app-greenpower-chart').first();const plot=chart.locator('svg');await plot.focus();await plot.press('ArrowRight');
  const names=await page.locator('.session-list .session-label').allTextContents();
  assert.deepEqual(await chart.locator('.overlay-name').allTextContents(),names,'charts show session names');
  assert.equal(await page.locator('.session-list .key').count(),0,'square replaces the separate list colour swatch');
  assert.ok((await chart.locator('svg .trace title').allTextContents()).every((text,index)=>text.startsWith(names[index])),'trace labels use session names');
  const readout=await chart.locator('.overlay-readout').boundingBox();await plot.press('ArrowRight');
  assert.deepEqual(await chart.locator('.overlay-readout').boundingBox(),readout,'readout updates preserve geometry');
  await page.screenshot({path:output+'/'+name+'.png',fullPage:true});
  const keysBefore=await page.locator('.session-list .session-label').allTextContents();
  const toggle=page.locator('.session-list').getByRole('button',{name:'Hide '+keysBefore[0],exact:true});
  await toggle.scrollIntoViewIfNeeded();
  assert.deepEqual(await toggle.evaluate(el=>({width:el.offsetWidth,height:el.offsetHeight,radius:getComputedStyle(el).borderRadius,text:el.textContent})),{width:14,height:14,radius:'0px',text:''},'session list uses matching compact squares');
  assert.notEqual(await toggle.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
  const buttonBefore=await toggle.boundingBox();
  const cursorBefore=await chart.locator('.overlay-time').textContent();
  await toggle.click();
  const show=page.locator('.session-list').getByRole('button',{name:'Show '+keysBefore[0],exact:true});
  assert.deepEqual(await show.boundingBox(),buttonBefore,'Hide/Show retains button geometry');
  assert.equal(await show.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)','hidden list square is empty');
  assert.deepEqual(await page.locator('.session-list .session-label').allTextContents(),keysBefore,'hidden session stays loaded in list');
  assert.equal(await chart.locator('svg .trace').count(),5,'hidden session leaves chart');
  assert.equal(await chart.locator('.overlay-time').textContent(),cursorBefore,'visibility preserves cursor');
  await show.click();
  assert.equal(await chart.locator('svg .trace').count(),6,'shown session returns without loading');
  const chartToggle=chart.getByRole('button',{name:'Hide '+keysBefore[0],exact:true});
  await chartToggle.scrollIntoViewIfNeeded();
  assert.deepEqual(await chartToggle.evaluate(el=>({width:el.offsetWidth,height:el.offsetHeight,radius:getComputedStyle(el).borderRadius,text:el.textContent})),{width:14,height:14,radius:'0px',text:''},'compact square without visible text');
  assert.equal(await chart.locator('.overlay-entry i').count(),0,'square is the only colour key in chart rows');
  const filled=await chartToggle.evaluate(el=>getComputedStyle(el).backgroundColor);
  assert.notEqual(filled,'rgba(0, 0, 0, 0)');
  assert.equal(await chart.locator('.overlay-readout').evaluate(el=>el.scrollHeight<=el.clientHeight),true,'session list needs no internal scrolling');
  const rowBefore=await chart.locator('.overlay-entry').first().boundingBox();
  const plotBefore=await plot.boundingBox();
  await chartToggle.focus();await chartToggle.press('Enter');
  const chartShow=chart.getByRole('button',{name:'Show '+keysBefore[0],exact:true});
  assert.equal(await chart.locator('svg .trace').count(),5);
  assert.equal(await page.locator('app-greenpower-chart').nth(2).locator('svg .trace').count(),10,'hides both voltage traces');
  assert.equal(await chartShow.getAttribute('aria-pressed'),'false');
  assert.equal(await chartShow.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)','hidden square is empty');
  assert.equal(await chartShow.evaluate(el=>el===document.activeElement),true,'toggle retains focus');
  assert.deepEqual(await chart.locator('.overlay-entry').first().boundingBox(),rowBefore,'hidden row stays in place');
  assert.deepEqual(await plot.boundingBox(),plotBefore,'toggle preserves plot geometry');
  assert.equal(await chart.locator('.overlay-time').textContent(),cursorBefore);
  await chartShow.press('Space');
  assert.equal(await chart.locator('svg .trace').count(),6);

  await page.evaluate(()=>{for(const session of window.overlayHarness.overlay.sessions)window.overlayHarness.overlay.toggleVisibility(session.id)});
  assert.equal(await page.getByText('All sessions hidden.',{exact:true}).count(),1);
  assert.equal(await page.locator('.session-list li').count(),6);
  assert.equal(await chart.locator('svg .trace').count(),0);
  assert.equal(await chart.getByRole('button',{name:/^Show /}).count(),6,'all hidden sessions can be restored from chart');
  await page.evaluate(()=>{for(const session of window.overlayHarness.overlay.sessions)window.overlayHarness.overlay.toggleVisibility(session.id)});
  assert.equal(await chart.locator('svg .trace').count(),6);

  assert.equal((await plot.boundingBox()).height,300,'overlay plot height doubles');
  await page.evaluate(()=>window.scrollTo(0,0));
  const beforeEditing=await toolbar.boundingBox();
  const edit=page.getByRole('button',{name:'Edit view',exact:true});
  assert.equal(await edit.isEnabled(),true);
  await edit.click();
  assert.equal(await page.locator('.editor-tabs').count(),0,'overlay offers charts only');
  assert.equal(await page.getByRole('checkbox',{name:'Current chart',exact:true}).count(),1,'uses overlay channels with no underlying samples');
  assert.equal(await page.getByRole('checkbox',{name:'Speed chart',exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'Save',exact:true}).isEnabled(),true,'track readiness cannot block chart saving');
  assert.deepEqual(await toolbar.boundingBox(),beforeEditing,'editing preserves toolbar geometry');
  await page.screenshot({path:output+'/'+name+'-editor.png',fullPage:true});
  const scalarSettings=await page.evaluate(()=>JSON.stringify(window.overlayHarness.view.draft.scalars));
  await page.evaluate(()=>{const h=window.overlayHarness;h.comparison.window={start:1000,end:100000};h.detect()});
  const originalOrder=await page.locator('app-greenpower-chart h2').allTextContents();
  await page.getByRole('button',{name:'Reorder Speed chart',exact:true}).press('ArrowUp');
  assert.equal(await page.locator('.channel-label').first().textContent(),'Speed · m/s');
  await page.getByRole('checkbox',{name:'Current chart',exact:true}).uncheck();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.deepEqual(await page.locator('app-greenpower-chart h2').allTextContents(),originalOrder,'cancel preserves charts');
  await page.getByRole('button',{name:'Edit view',exact:true}).click();
  await page.getByRole('button',{name:'Reorder Speed chart',exact:true}).press('ArrowUp');
  const writesBefore=await page.evaluate(()=>window.overlayHarness.writes.length);
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.waitForFunction(()=>!window.overlayHarness.view.saving&&!window.overlayHarness.view.editing);
  assert.equal(await page.locator('app-greenpower-chart h2').first().textContent(),'Speed · m/s');
  assert.equal(await page.evaluate(()=>window.overlayHarness.writes.length),writesBefore+1);
  assert.equal(await page.evaluate(()=>window.overlayHarness.lapConfig.editing),false);
  assert.equal(await page.evaluate(()=>JSON.stringify(window.overlayHarness.writes.at(-1).scalars)),scalarSettings,'chart save preserves scalar selection');
  assert.deepEqual(await page.evaluate(()=>window.overlayHarness.comparison.window),{start:1000,end:100000},'chart save preserves zoom');
  await page.getByRole('button',{name:'Edit view',exact:true}).click();
  await page.getByRole('checkbox',{name:'Current chart',exact:true}).uncheck();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.waitForFunction(()=>!window.overlayHarness.view.saving&&!window.overlayHarness.view.editing);
  assert.equal(await page.locator('app-greenpower-chart').count(),3,'save hides the selected chart');
  await page.getByRole('button',{name:'Edit view',exact:true}).click();
  await page.getByRole('checkbox',{name:'Current chart',exact:true}).check();
  await page.getByRole('button',{name:'Reorder Current chart',exact:true}).press('ArrowUp');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.waitForFunction(()=>!window.overlayHarness.view.saving&&!window.overlayHarness.view.editing);
  assert.deepEqual(await page.locator('app-greenpower-chart h2').allTextContents(),originalOrder,'re-enable and restore ordering');
  assert.equal(await chart.locator('.overlay-time').textContent(),cursorBefore,'saves preserve elapsed cursor');
  await page.screenshot({path:output+'/'+name+'-edited.png',fullPage:true});

  await overlayButton.click();await page.evaluate(()=>window.overlayHarness.detect());assert.equal(await page.locator('#telemetry-overlay-panel').count(),0);
  assert.equal(await page.locator('app-greenpower-chart').count(),4,'panel closes without losing comparison');
  assert.equal(await page.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'page fits viewport');
  const actions=await page.locator('.actions > button').evaluateAll(buttons=>buttons.map(button=>({width:button.getBoundingClientRect().width,y:button.getBoundingClientRect().y})));
  assert.ok(actions.every(button=>button.width>=44&&button.y===actions[0].y),'actions retain touch targets on one row');
  await overlayButton.click();await page.evaluate(()=>window.overlayHarness.detect());await page.getByRole('button',{name:'Edit view',exact:true}).click();
  await page.getByRole('checkbox',{name:'Current chart',exact:true}).uncheck();
  await page.getByRole('button',{name:'Exit overlay',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.overlayHarness.view.editing),false,'exit discards draft');
  assert.equal(await page.getByRole('button',{name:'Track map',exact:true}).isEnabled(),true);
  assert.equal(await page.locator('app-greenpower-chart').count(),0);
  await page.evaluate(()=>{const h=window.overlayHarness;h.fixture.componentInstance.telemetry.channels=h.overlay.channels;h.fixture.componentInstance.telemetry.changed.next();h.detect()});
  assert.equal((await page.locator('app-greenpower-chart svg').first().boundingBox()).height,150,'ordinary plot height stays unchanged');
  await page.evaluate(()=>{const h=window.overlayHarness;h.fixture.componentInstance.telemetry.channels=[];h.fixture.componentInstance.telemetry.changed.next();h.detect()});
  await page.evaluate(()=>{window.overlayHarness.view.permissions.current.isAdmin=false;window.overlayHarness.detect()});
  assert.equal(await page.getByRole('button',{name:'Edit view',exact:true}).count(),1,'underlying metadata editor remains available');
  await page.evaluate(()=>window.overlayHarness.set({active:true,error:'Could not load race sessions.',hasMore:true}));
  assert.equal(await page.getByRole('button',{name:'Edit view',exact:true}).count(),0,'non-admin cannot edit overlay');
  assert.equal(await page.getByRole('alert').count(),1);assert.equal(await page.getByRole('button',{name:'Retry',exact:true}).count(),1);
  await page.evaluate(()=>window.overlayHarness.set({error:'',hasMore:false}));assert.equal(await page.getByText('No race sessions loaded.',{exact:true}).count(),1);
  await page.evaluate(()=>{window.overlayHarness.view.permissions.current.isAdmin=true;window.overlayHarness.detect()});
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({output,widths:[1440,390,320],checks:['toolbar stability','touch targets','no page overflow','loading/error/empty','Hide/Show retains data, identity, geometry and cursor','panel collapse retains charts','voltage pairs','keyboard cursor','readout stability','map/laps disabled and restored','chart editing, keyboard order, save, cancel, exit and permissions','300px overlay plots']}));
} finally {await browser.close();await new Promise(done=>server.close(done))}
