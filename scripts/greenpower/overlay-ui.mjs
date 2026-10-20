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
import {FormsModule} from '@angular/forms';
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
import {lapMetricChannels} from '${folder}/greenpowerLapMetrics';
import {GreenpowerMetadataFieldsComponent} from '${folder}/greenpower-metadata-fields.component';
import {channelsFor} from '${folder}/greenpowerData';
import {emptyDay,editableDay,dayMetadataError} from '${folder}/greenpowerDay';
import {overlayChannels,overlayColour,overlayLabel} from '${folder}/greenpowerOverlay';
const channels=(offset=0)=>['Current','Voltage left','Voltage right','Voltage diff','Speed'].map((label,index)=>({
 id:['["A"]:A','computed:voltage-left','computed:voltage-right','computed:voltage-diff','["Spd"]:m/s'][index],label,unit:index===4?'m/s':index?'V':'A',value:'20',
 points:Array.from({length:200},(_,i)=>({time:i*30000,value:(index===0?20:index===3?1:12)+Math.sin(i/15+offset)*(index===0?4:.5)}))
}));
const overlay:any={active:false,loading:false,more:false,error:'',sessions:[],changed:new Subject(),end:5970000,hasMore:false,
 get title(){return Object.getOwnPropertyDescriptor(GreenpowerOverlayService.prototype,'title').get.call(this)},
 get channels(){return this.sessions.length?Object.getOwnPropertyDescriptor(GreenpowerOverlayService.prototype,'channels').get.call(this):channels()},get visibleSessions(){return this.sessions.filter(s=>s.loaded&&!s.hidden&&!s.excluded)},get status(){return this.loading?'Loading sessions…':this.sessions.length+' sessions'},
 async load(reset=false,sessionType='race'){this.sessionType=sessionType;this.active=true;this.loading=true;this.changed.next();await new Promise(r=>setTimeout(r,80));
  this.sessions=Array.from({length:6},(_,i)=>({id:'session-'+i,label:overlayLabel({...emptyDay('2026-06-'+(14+i)),eventName:i%2?'Goodwood':'Dunsfold',defaults:{driver:'Driver '+(i+1)}},{type:sessionType,batteryIds:['Battery '+(i+1)+'A','Battery '+(i+1)+'B'],overrides:{}} as any),colour:overlayColour(i),loaded:true,hidden:false,excluded:false,channels:channels(i),session:{startAt:0,endAt:this.end}}));
  this.loading=false;this.changed.next()},
 toggleVisibility:GreenpowerOverlayService.prototype.toggleVisibility,
 toggleInclusion:GreenpowerOverlayService.prototype.toggleInclusion,
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
TestBed.configureTestingModule({declarations:[GreenpowerTelemetryComponent,GreenpowerOverlayComponent,GreenpowerChartComponent,GreenpowerMetadataFieldsComponent],imports:[CommonModule,FormsModule],providers:[{provide:GreenpowerEventsService,useValue:{tracks:[],loadingTracks:false}}],schemas:[NO_ERRORS_SCHEMA]});
TestBed.overrideComponent(GreenpowerTelemetryComponent,{set:{providers:[
 {provide:GreenpowerOverlayService,useValue:overlay},{provide:GreenpowerViewService,useValue:view},
 {provide:GreenpowerTelemetryService,useValue:telemetry},{provide:GreenpowerLapService,useValue:lapConfig},
 {provide:GreenpowerEventsService,useValue:events},{provide:GreenpowerEventEditService,useValue:eventEdit}
]}});
const metadataFixture=TestBed.createComponent(GreenpowerMetadataFieldsComponent);metadataFixture.componentInstance.data=editableDay(emptyDay('2026-10-20'));metadataFixture.detectChanges();metadataFixture.changeDetectorRef.detach();metadataFixture.nativeElement.remove();
const fixture=TestBed.createComponent(GreenpowerTelemetryComponent);const detect=()=>{fixture.changeDetectorRef.markForCheck();fixture.detectChanges()};document.body.append(fixture.nativeElement);detect();
overlay.changed.subscribe(detect);view.changed.subscribe(detect);
let electricalSaved;
window.overlayHarness={distance(mode){
 const event={...emptyDay('2026-10-20'),defaults:{motorGearTeeth:12,wheelGearTeeth:60}};
 const session={id:'distance',type:'race',startAt:6000,endAt:30000,overrides:{},batteryIds:[]};
 const samples=Array.from({length:11},(_,i)=>({id:String(i),source:'424-phone',receivedAt:i*3000,raw:JSON.stringify({RPM:30*.44704*60*5/1.29,Spd:99})}));
 fixture.componentInstance.window=undefined;fixture.componentInstance.cursor=undefined;
 if(mode==='overlay'){overlay.active=true;overlay.end=24000;overlay.sessions=[{id:'distance',label:'Distance driver',colour:overlayColour(0),loaded:true,hidden:false,excluded:false,session,channels:overlayChannels(samples.filter(row=>row.receivedAt>=session.startAt),session as any,event)}];overlay.changed.next()}
 else{overlay.clear();fixture.componentInstance['loadedEvent']=event;fixture.componentInstance.recordingSessions=[session as any];telemetry.live=false;telemetry.channels=channelsFor(samples,samples.at(-1));telemetry.latest=samples.at(-1);telemetry.start=0;telemetry.end=30000;telemetry.changed.next()}
 detect();
},electrical(mode){
 if(mode==='restore'){view['saved']=electricalSaved;electricalSaved=undefined;fixture.componentInstance.recordingSessions=[];overlay.clear();view.changed.next();detect();return}
 electricalSaved ??= view['saved'];
 const samples=Array.from({length:11},(_,i)=>({id:String(i),source:'424-phone',receivedAt:i*3000,raw:JSON.stringify({Vt:24,A:20,AH:10+i/60})}));
 const event=emptyDay('2026-10-20'),session={id:'battery',type:'battery_dyno',startAt:6000,endAt:30000,overrides:{},batteryIds:['A','B']};
 const rows=channelsFor(samples,samples.at(-1));
 view['saved']={...selectionFor(rows),charts:{'["A"]:A':true,'["AH"]:Ah':true},chartOrder:['["A"]:A','["AH"]:Ah'],revision:1,updatedBy:'admin'};
 fixture.componentInstance.window=undefined;fixture.componentInstance.cursor=undefined;
 if(mode==='overlay'){overlay.sessionType='battery_dyno';overlay.active=true;overlay.end=24000;overlay.sessions=[{id:'battery',label:overlayLabel(event,session as any,overlayChannels(samples,session as any,event)),colour:overlayColour(0),loaded:true,hidden:false,excluded:false,session,channels:overlayChannels(samples,session as any,event)}];overlay.changed.next()}
 else{overlay.clear();fixture.componentInstance['loadedEvent']=mode==='live'?undefined:event;fixture.componentInstance.recordingSessions=mode==='live'?[]:[session as any];telemetry.live=mode==='live';telemetry.channels=rows;telemetry.latest=samples.at(-1);telemetry.start=0;telemetry.end=30000;telemetry.changed.next()}
 detect();
},speed(mode,recorded=true,circumference=1.29){
 const event={...emptyDay('2026-10-20'),wheelCircumferenceM:circumference,defaults:{motorGearTeeth:12,wheelGearTeeth:60}};
 const samples=Array.from({length:4},(_,i)=>({id:String(i),source:'424-phone',receivedAt:i*3000,raw:JSON.stringify({RPM:2000+i*200,A:20,...(recorded?{Spd:10+i}: {})})}));
 if(mode==='overlay') {overlay.active=true;overlay.sessions=Array.from({length:2},(_,i)=>{const rows=i?samples.map(row=>({...row,raw:JSON.stringify({RPM:2400,A:20})})):samples;return {id:'speed-'+i,label:'Driver '+(i+1),colour:overlayColour(i),loaded:true,hidden:false,excluded:false,channels:overlayChannels(rows,{id:'s'+i,type:'race',startAt:0,endAt:9000,overrides:{}} as any,event),session:{startAt:0,endAt:9000}}});overlay.end=9000;overlay.changed.next()}
 else {overlay.clear();fixture.componentInstance['loadedEvent']=event;telemetry.live=false;telemetry.channels=channelsFor(samples,samples.at(-1));telemetry.latest=samples.at(-1);telemetry.start=0;telemetry.end=9000;telemetry.changed.next()}
 detect();
},metadata(){const editor=metadataFixture;const old={...emptyDay('2026-10-20')};delete old.wheelCircumferenceM;editor.componentRef.setInput('data',editableDay(old));editor.changeDetectorRef.reattach();document.body.append(editor.nativeElement);editor.detectChanges();this.metadataFixture=editor;return editor.componentInstance.data},metadataError(){return dayMetadataError(this.metadataFixture.componentInstance.data)},removeMetadata(){this.metadataFixture.changeDetectorRef.detach();this.metadataFixture.nativeElement.remove()},metrics(mode){
 const laps=[{time:0,end:120000,lap:1,complete:true,speed:25,current:20},{time:120000,end:240000,lap:2,complete:false},{time:240000,end:390000,lap:3,complete:true,speed:26,current:21}];
 if(mode==='overlay') {overlay.active=true;overlay.sessions=Array.from({length:3},(_,i)=>({id:'metric-'+i,label:'Driver '+(i+1),colour:overlayColour(i),loaded:true,hidden:false,excluded:false,channels:lapMetricChannels(laps),session:{startAt:0,endAt:390000}}));overlay.end=390000;overlay.changed.next()}
 else {overlay.clear();const event={...emptyDay('2026-10-20'),defaults:{motorGearTeeth:12,wheelGearTeeth:60}};fixture.componentInstance['loadedEvent']=event;telemetry.live=false;
 const samples=Array.from({length:131},(_,i)=>({id:String(i),source:'424-phone',receivedAt:i*3000,raw:JSON.stringify({RPM:(i*3000<240000?25:26)*.44704*60*5/1.29,A:20,Spd:99})}));
 telemetry.channels=channelsFor(samples,samples.at(-1));telemetry.latest=samples.at(-1);lapConfig.analysis={...lapConfig.analysis,laps};telemetry.start=0;telemetry.end=390000;telemetry.changed.next()}
 detect();
},fixture,overlay,view,writes,lapConfig,comparison:fixture.debugElement.query(By.directive(GreenpowerOverlayComponent)).componentInstance,async detect(){detect()},set(state){Object.assign(overlay,state);overlay.changed.next();detect()}};
`);
await build({entryPoints:[output+'/entry.ts'],outfile:output+'/bundle.js',bundle:true,format:'esm',platform:'browser',
 nodePaths:[root+'/node_modules'],logLevel:'silent',tsconfigRaw:{compilerOptions:{experimentalDecorators:true}},
 plugins:[{name:'angular-jit',setup(builder){builder.onLoad({filter:/greenpower-(telemetry|overlay|chart|metadata-fields)\.component\.ts$/},async args=>{
  let source=await readFile(args.path,'utf8');
  source=source.replace(/templateUrl: '([^']+)'/,(_,name)=>'template: '+JSON.stringify(require('node:fs').readFileSync(resolve(dirname(args.path),name),'utf8')))
   .replace(/styleUrls: \[\'([^']+)\'\]/,(_,name)=>'styles: ['+JSON.stringify(require('node:fs').readFileSync(resolve(dirname(args.path),name),'utf8'))+']');
  source += args.path.includes('greenpower-telemetry.component')
   ? '\n(GreenpowerTelemetryComponent as any).ctorParameters = () => [{type:GreenpowerTelemetryService},{type:ChangeDetectorRef},{type:Title},{type:GreenpowerViewService},{type:GreenpowerLapService},{type:GreenpowerEventsService},{type:GreenpowerEventEditService},{type:GreenpowerOverlayService}];'
   : args.path.includes('metadata-fields') ? '\n(GreenpowerMetadataFieldsComponent as any).ctorParameters = () => [{type:GreenpowerEventsService}];' : args.path.includes('greenpower-overlay') ? '\n(GreenpowerOverlayComponent as any).ctorParameters = () => [{type:GreenpowerOverlayService},{type:GreenpowerViewService},{type:ChangeDetectorRef}];' : '\n(GreenpowerChartComponent as any).ctorParameters = () => [{type:ChangeDetectorRef},{type:NgZone}];';
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
  assert.equal(await page.locator('#overlay-source option[value="2026-battery-dyno"]').textContent(),'2026 battery dyno tests');
  await page.locator('#overlay-source').selectOption('2026-battery-dyno');
  await page.waitForFunction(()=>window.overlayHarness.overlay.sessionType==='battery_dyno'&&!window.overlayHarness.overlay.loading);
  assert.deepEqual(await toolbar.boundingBox(),initial,'battery dyno selection preserves toolbar geometry at '+width);
  assert.equal(await page.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(await page.getByRole('heading',{name:'2026 battery dyno tests',exact:true}).count(),1);
  assert.equal(await page.title(),'2026 battery dyno tests · PERRINN');
  const batteryLabels=await page.locator('.session-list .session-label').allTextContents();
  assert.ok(batteryLabels.every((label,index)=>label.endsWith('Battery '+(index+1)+'A, Battery '+(index+1)+'B')));
  assert.deepEqual(await page.locator('app-greenpower-chart').first().locator('.overlay-name').allTextContents(),batteryLabels);
  await page.screenshot({path:output+'/'+name+'-battery-dyno.png',fullPage:true});
  await page.locator('#overlay-source').selectOption('2026-race');
  await page.waitForFunction(()=>window.overlayHarness.overlay.sessionType==='race'&&!window.overlayHarness.overlay.loading);
  assert.equal(await page.getByRole('heading',{name:'2026 race sessions',exact:true}).count(),1);
  assert.equal(await page.title(),'2026 race sessions · PERRINN');
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
  const plotHeightBefore=(await plot.boundingBox()).height;
  await toggle.click();
  const show=page.locator('.session-list').getByRole('button',{name:'Show '+keysBefore[0],exact:true});
  assert.deepEqual(await show.boundingBox(),buttonBefore,'Hide/Show retains button geometry');
  assert.equal(await show.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)','hidden list square is empty');
  assert.deepEqual(await page.locator('.session-list .session-label').allTextContents(),keysBefore,'hidden session stays loaded in list');
  assert.equal(await chart.locator('svg .trace').count(),5,'hidden session leaves chart');
  assert.equal(await chart.locator('.overlay-entry').count(),5,'main list removes the reading row');
  assert.equal(await page.locator('app-greenpower-chart').nth(2).locator('.overlay-entry').count(),10,'both voltage rows are removed');
  assert.equal((await plot.boundingBox()).height,plotHeightBefore,'plot height stays stable');
  assert.equal(await chart.locator('.overlay-time').textContent(),cursorBefore,'visibility preserves cursor');
  await show.click();
  assert.equal(await chart.locator('svg .trace').count(),6,'shown session returns without loading');
  assert.deepEqual(await chart.locator('.overlay-name').allTextContents(),keysBefore,'restoring returns rows in original order');
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
  assert.equal(await page.locator('.session-list').getByRole('button',{name:'Hide '+keysBefore[0],exact:true}).getAttribute('aria-pressed'),'true','graph hiding preserves main list inclusion');
  await page.locator('.session-list').getByRole('button',{name:'Hide '+keysBefore[0],exact:true}).click();
  assert.equal(await chart.locator('.overlay-entry').count(),5);
  await page.locator('.session-list').getByRole('button',{name:'Show '+keysBefore[0],exact:true}).click();
  assert.equal(await chartShow.count(),1,'restoring inclusion preserves graph hiding');
  await chartShow.focus();await chartShow.press('Space');
  assert.equal(await chart.locator('svg .trace').count(),6);

  await page.evaluate(()=>{for(const session of window.overlayHarness.overlay.sessions)window.overlayHarness.overlay.toggleVisibility(session.id)});
  assert.equal(await page.getByText('All sessions hidden.',{exact:true}).count(),1);
  assert.equal(await page.locator('.session-list li').count(),6);
  assert.equal(await chart.locator('svg .trace').count(),0);
  assert.equal(await chart.getByRole('button',{name:/^Show /}).count(),6,'all hidden sessions can be restored from chart');
  await page.evaluate(()=>{for(const session of window.overlayHarness.overlay.sessions)window.overlayHarness.overlay.toggleVisibility(session.id)});
  assert.equal(await chart.locator('svg .trace').count(),6);

  await page.evaluate(()=>{for(const session of window.overlayHarness.overlay.sessions)window.overlayHarness.overlay.toggleInclusion(session.id)});
  assert.equal(await chart.locator('.overlay-entry').count(),0,'all excluded rows disappear');
  assert.equal(await chart.locator('svg .trace').count(),0,'all excluded traces disappear');
  assert.equal(await page.locator('app-greenpower-chart').count(),4,'empty chart frames remain');
  assert.equal(await page.getByText('All sessions hidden.',{exact:true}).count(),1);
  assert.equal((await plot.boundingBox()).height,300);
  await page.screenshot({path:output+'/'+name+'-excluded.png',fullPage:true});
  await page.evaluate(()=>{for(const session of window.overlayHarness.overlay.sessions)window.overlayHarness.overlay.toggleInclusion(session.id)});
  assert.deepEqual(await chart.locator('.overlay-name').allTextContents(),keysBefore);
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
  await page.evaluate(()=>window.overlayHarness.set({active:true,error:'Could not load sessions.',hasMore:true}));
  assert.equal(await page.getByRole('button',{name:'Edit view',exact:true}).count(),0,'non-admin cannot edit overlay');
  assert.equal(await page.getByRole('alert').count(),1);assert.equal(await page.getByRole('button',{name:'Retry',exact:true}).count(),1);
  await page.evaluate(()=>window.overlayHarness.set({error:'',hasMore:false}));assert.equal(await page.getByText('No sessions loaded.',{exact:true}).count(),1);
  await page.evaluate(()=>{window.overlayHarness.view.permissions.current.isAdmin=true;window.overlayHarness.detect()});
  await page.evaluate(()=>window.overlayHarness.metrics('normal'));
  for(const label of ['Lap time · s','Lap average speed · from motor · mph','Lap average amps · A']) {
   const metric=page.locator('app-greenpower-chart').filter({has:page.getByRole('heading',{name:label,exact:true})});
   assert.equal(await metric.count(),1,'normal metric '+label);
   assert.equal((await metric.locator('svg').boundingBox()).height,150);
   assert.equal(await metric.locator('.lap-dot').count(),2,'one dot per completed lap');
   assert.equal((await metric.locator('svg .trace').getAttribute('d')).match(/M/g).length,1,'lap finishes connect with one line');
  }
  await page.evaluate(()=>{const h=window.overlayHarness;h.fixture.componentInstance.window={start:60000,end:390000};h.fixture.componentInstance.cursor=120000;h.detect()});
  const normalMetric=page.locator('app-greenpower-chart').filter({has:page.getByRole('heading',{name:'Lap time · s',exact:true})});
  assert.match(await normalMetric.locator('.readout').textContent(),/Lap 1.*120/,'finish reading identifies the completed lap');
  assert.ok((await normalMetric.locator('svg .trace').getAttribute('d')).includes('L'),'zoom retains connecting line');
  await page.screenshot({path:output+'/'+name+'-lap-metrics-normal.png',fullPage:true});
  const motorAverage=page.locator('app-greenpower-chart').filter({has:page.getByRole('heading',{name:'Lap average speed · from motor · mph',exact:true})});
  assert.match(await motorAverage.locator('.readout').textContent(),/25.0 mph/,'normal average uses motor speed despite recorded 99 m/s');
  await page.evaluate(()=>{const h=window.overlayHarness;h.fixture.componentInstance['loadedEvent'].wheelCircumferenceM=1.4;h.fixture.componentInstance.telemetry.changed.next();h.detect()});
  assert.match(await motorAverage.locator('.readout').textContent(),/27.1 mph/,'metadata-only changes recalculate the lap average');
  await page.evaluate(()=>window.overlayHarness.metrics('overlay'));
  assert.equal(await page.locator('app-greenpower-chart').count(),3,'all three overlay metric charts');
  const metric=page.locator('app-greenpower-chart').first();
  assert.equal(await metric.locator('.overlay-entry').count(),3);
  assert.equal(await metric.locator('.lap-dot').count(),6,'two dots per overlay session');
  assert.equal((await metric.locator('svg').boundingBox()).height,300);
  await page.evaluate(()=>{const h=window.overlayHarness;h.comparison.cursor=120000;h.detect()});
  assert.ok((await metric.locator('.overlay-value').allTextContents()).every(value=>Number(value)===120));
  const metricBox=await metric.locator('.overlay-readout').boundingBox();
  await page.evaluate(()=>{const h=window.overlayHarness;h.comparison.cursor=390000;h.detect()});
  assert.ok((await metric.locator('.overlay-value').allTextContents()).every(value=>Number(value)===150),'cursor reads the finished lap');
  assert.deepEqual(await metric.locator('.overlay-readout').boundingBox(),metricBox);
  await metric.getByRole('button',{name:'Hide Driver 1',exact:true}).click();
  assert.equal(await metric.locator('.overlay-entry').count(),3);
  assert.equal(await metric.locator('svg .trace').count(),2);
  assert.equal(await metric.locator('.lap-dot').count(),4,'graph hiding removes dots too');
  await page.evaluate(()=>window.overlayHarness.overlay.toggleInclusion('metric-1'));
  assert.equal(await metric.locator('.overlay-entry').count(),2);
  assert.equal(await metric.locator('.lap-dot').count(),2,'main-list hiding removes dots too');
  await page.screenshot({path:output+'/'+name+'-lap-metrics-overlay.png',fullPage:true});
  assert.equal(await page.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.evaluate(()=>{const h=window.overlayHarness;h.overlay.clear();h.lapConfig.analysis={...h.lapConfig.analysis,laps:[]};h.fixture.componentInstance.telemetry.channels=[];h.fixture.componentInstance.telemetry.changed.next();h.detect()});
  await page.evaluate(()=>window.overlayHarness.speed('normal'));
  const speedChart=page.locator('app-greenpower-chart').filter({has:page.getByRole('heading',{name:'Vehicle speed · mph',exact:true})});
  assert.equal(await speedChart.count(),1);
  assert.equal(await speedChart.locator('.comparison-trace').count(),1);
  assert.match(await speedChart.locator('.comparison-legend').textContent(),/Motor-derived speed/);
  const initialPath=await speedChart.locator('.comparison-trace').getAttribute('d');
  await speedChart.locator('svg').focus();await speedChart.locator('svg').press('ArrowRight');
  assert.notEqual(await speedChart.locator('.comparison-legend .legend-value').last().textContent(),'—');
  await page.screenshot({path:output+'/'+name+'-motor-speed.png',fullPage:true});
  await page.evaluate(()=>window.overlayHarness.speed('normal',false));
  assert.equal(await speedChart.count(),1,'RPM-only chart remains available');
  assert.equal(await speedChart.locator('.trace:not(.comparison-trace)').getAttribute('d'),'');
  assert.ok((await speedChart.locator('.comparison-trace').getAttribute('d')).length>0);
  await speedChart.locator('svg').focus();await speedChart.locator('svg').press('ArrowRight');
  assert.equal(await speedChart.locator('.cursor').count(),1,'RPM-only keyboard cursor works');
  assert.equal(await speedChart.locator('.comparison-legend .legend-value').first().textContent(),'—','recorded reading never borrows the derived value');
  assert.notEqual(await speedChart.locator('.comparison-legend .legend-value').last().textContent(),'—');
  await page.evaluate(()=>window.overlayHarness.speed('normal',true,1.4));
  assert.notEqual(await speedChart.locator('.comparison-trace').getAttribute('d'),initialPath,'event circumference changes derived trace');
  await page.evaluate(()=>window.overlayHarness.speed('overlay'));
  const overlaySpeed=page.locator('app-greenpower-chart').filter({has:page.getByRole('heading',{name:'Vehicle speed · mph',exact:true})});
  assert.equal(await overlaySpeed.locator('.trace').count(),3,'one recorded and two derived overlay traces');
  assert.equal(await overlaySpeed.locator('.overlay-name').filter({hasText:'Motor-derived'}).count(),2);
  assert.equal(await overlaySpeed.locator('.trace').evaluateAll(paths=>paths.filter(path=>getComputedStyle(path).strokeDasharray!=='none').length),2,'motor-derived traces are dashed');
  await page.screenshot({path:output+'/'+name+'-motor-speed-overlay.png',fullPage:true});
  await overlaySpeed.getByRole('button',{name:'Hide Driver 1',exact:true}).first().click();
  assert.equal(await overlaySpeed.locator('.trace').count(),1,'graph Hide applies to both speed sources');
  assert.equal(await overlaySpeed.locator('.overlay-entry').count(),3);
  await page.evaluate(()=>window.overlayHarness.overlay.toggleInclusion('speed-1'));
  assert.equal(await overlaySpeed.locator('.overlay-entry').count(),2,'main-list exclusion applies to both sources');
  await page.evaluate(()=>window.overlayHarness.overlay.clear());
  await page.evaluate(()=>window.overlayHarness.metadata());
  const circumference=page.getByLabel('Wheel circumference · m',{exact:true});
  assert.equal(await circumference.inputValue(),'1.29','legacy event editor receives default');
  await circumference.fill('1.36');
  assert.equal(await page.evaluate(()=>window.overlayHarness.metadataFixture.componentInstance.data.wheelCircumferenceM),1.36);
  assert.equal(await page.evaluate(()=>window.overlayHarness.metadataError()),'');
  await circumference.fill('0');
  assert.match(await page.evaluate(()=>window.overlayHarness.metadataError()),/positive wheel circumference/);
  await circumference.fill('1.36');
  assert.equal(await page.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:output+'/'+name+'-circumference.png',fullPage:true});
  await page.evaluate(()=>window.overlayHarness.removeMetadata());
  const electricalHeadings=['Current · A','Power · W','Amp hours used · Ah','Energy · Wh'];
  for(const mode of ['normal','live','overlay']) {
   await page.evaluate(mode=>window.overlayHarness.electrical(mode),mode);
   assert.deepEqual(await page.locator('app-greenpower-chart h2').allTextContents(),electricalHeadings);
   assert.equal(await page.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const power=page.locator('app-greenpower-chart').nth(1),energy=page.locator('app-greenpower-chart').nth(3);
   assert.ok((await power.locator('svg .trace').first().getAttribute('d')).length>0);
   assert.ok((await energy.locator('svg .trace').first().getAttribute('d')).length>0);
   if(mode==='normal') {
    await page.evaluate(()=>{const h=window.overlayHarness;h.fixture.componentInstance.window={start:18000,end:30000};h.fixture.componentInstance.cursor=30000;h.detect()});
    assert.match(await energy.locator('.readout').textContent(),/3\.2\s*Wh/,'zoom retains session energy baseline');
    await energy.locator('svg').focus();await energy.locator('svg').press('ArrowLeft');
    assert.equal(await energy.locator('.cursor').count(),1,'energy chart supports keyboard inspection');
   } else if(mode==='live') {
    await page.evaluate(()=>{const h=window.overlayHarness;h.fixture.componentInstance.cursor=30000;h.detect()});
    assert.match(await energy.locator('.readout').textContent(),/4\.0\s*Wh/,'live energy starts at recording origin');
   } else {
    assert.equal(await page.getByRole('heading',{name:'2026 battery dyno tests',exact:true}).count(),1);
    assert.match(await energy.locator('.overlay-readout').textContent(),/3\.2 Wh/,'computed maximum appears in chart session labels');
    if(!await page.locator('#telemetry-overlay-panel').count()) {await overlayButton.click();await page.evaluate(()=>window.overlayHarness.detect())}
    assert.match(await page.locator('.session-list .session-label').textContent(),/3\.2 Wh/,'maximum appears in the main session list');
    await overlayButton.click();await page.evaluate(()=>window.overlayHarness.detect());
    assert.match(await page.locator('.session-key').textContent(),/3\.2 Wh/,'maximum remains in the collapsed-panel legend');
    await page.evaluate(()=>{const h=window.overlayHarness;h.comparison.cursor=24000;h.detect()});
    assert.match(await energy.locator('.overlay-readout').textContent(),/3\.2/,'overlay uses the same session energy');
   }
   await page.screenshot({path:output+'/'+name+'-electrical-'+mode+'.png',fullPage:true});
  }
  await page.evaluate(()=>window.overlayHarness.electrical('restore'));
  for(const mode of ['normal','overlay']) {
   await page.evaluate(mode=>window.overlayHarness.distance(mode),mode);
   const chart=page.locator('app-greenpower-chart').filter({has:page.getByRole('heading',{name:'Distance travelled · mi',exact:true})});
   assert.equal(await chart.count(),1);
   assert.ok((await chart.locator('svg .trace').first().getAttribute('d')).length>0);
   const toolbarGeometry=()=>page.locator('.controls').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height}});
   const controls=await toolbarGeometry();
   if(mode==='normal') {
    await page.evaluate(()=>{const h=window.overlayHarness;h.fixture.componentInstance.window={start:18000,end:30000};h.fixture.componentInstance.cursor=30000;h.detect()});
    assert.match(await chart.locator('.readout').textContent(),/0\.20\s*mi/,'zoom retains race distance origin');
    await chart.locator('svg').focus();await chart.locator('svg').press('ArrowLeft');
    assert.equal(await chart.locator('.cursor').count(),1);
   } else {
    await page.evaluate(()=>{const h=window.overlayHarness;h.comparison.cursor=24000;h.detect()});
    assert.match(await chart.locator('.overlay-readout').textContent(),/0\.2/,'elapsed overlay uses the same race baseline');
    await chart.getByRole('button',{name:'Hide Distance driver',exact:true}).click();
    assert.equal(await chart.locator('svg .trace').count(),0);
    assert.equal(await chart.count(),1,'Hide retains distance chart frame');
   }
   assert.deepEqual(await toolbarGeometry(),controls,'cursor and Hide preserve toolbar geometry while focus can scroll the document');
   assert.equal(await page.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:output+'/'+name+'-distance-'+mode+'.png',fullPage:true});
  }

  await page.evaluate(()=>{const h=window.overlayHarness;h.removeMetadata();const t=h.fixture.componentInstance.telemetry;t.channels=[];t.latest=undefined;t.live=true;t.start=0;t.end=1000;h.fixture.componentInstance['loadedEvent']=undefined;t.changed.next();h.detect()});


 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({output,widths:[1440,390,320],checks:['toolbar stability','touch targets','no page overflow','loading/error/empty','Hide/Show retains data, identity, geometry and cursor','panel collapse retains charts','voltage pairs','keyboard cursor','readout stability','map/laps disabled and restored','chart editing, keyboard order, save, cancel, exit and permissions','300px overlay plots']}));
} finally {await browser.close();await new Promise(done=>server.close(done))}
