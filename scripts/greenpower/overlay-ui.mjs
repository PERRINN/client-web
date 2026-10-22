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
import {GreenpowerEventContextService} from '${folder}/greenpowerEventContext.service';
import {GreenpowerEventEditService} from '${folder}/greenpowerEventEdit.service';
import {selectionFor} from '${folder}/greenpowerView';
import {GreenpowerOverlayComponent} from '${folder}/greenpower-overlay.component';
import {GreenpowerChannelOptionComponent} from '${folder}/greenpower-channel-option.component';
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
let record={...selectionFor(channels()),chartOrder:['["A"]:A','["Spd"]:m/s','computed:voltage-left','computed:voltage-diff'],revision:1,updatedBy:'admin'};
const writes:any[]=[];
const ref:any={onSnapshot(options,callback){callback({exists:true,data:()=>record,metadata:{}});return ()=>{}},firestore:{
 async runTransaction(callback){await callback({get:async()=>({data:()=>record}),set:(_,value)=>{record=value;writes.push(value)}})}
}};
const permissions:any={current:{uid:'admin',ready:true,isAdmin:true},state:new BehaviorSubject({uid:'admin',ready:true,isAdmin:true})};
const view=new GreenpowerViewService(permissions,{firestore:{doc:()=>ref}} as any);
const telemetry:any={changed:new Subject(),access:'signed-in',day:'2026-10-20',live:true,error:'',more:false,channels:[],loading:false,start:0,end:1000,tick(){},select(){},connected:true};
const lapConfig:any={changed:new Subject(),saving:false,line:null,fixes:[],ready:false,selectionReady:false,candidates:[],
 analysis:{laps:[],channel:{id:'computed:gps-lap',label:'GPS lap',unit:'',value:'—',points:[]}},select(){},syncEditing(value){this.editing=value},update(){},
 selectionWrite(){if(overlay.active)throw new Error('Overlay must not request a track write');return undefined}
};
const events:any={changed:new Subject(),canEdit:true};
const eventEdit:any={changed:new Subject(),saved:new Subject(),locked:false,mode:'',canEditSessions:true,cancel(){}};
TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());
TestBed.configureTestingModule({declarations:[GreenpowerChannelOptionComponent,GreenpowerTelemetryComponent,GreenpowerOverlayComponent,GreenpowerChartComponent,GreenpowerMetadataFieldsComponent],imports:[CommonModule,FormsModule],providers:[{provide:GreenpowerEventsService,useValue:{tracks:[],loadingTracks:false}}],schemas:[NO_ERRORS_SCHEMA]});
TestBed.overrideComponent(GreenpowerTelemetryComponent,{set:{providers:[
 {provide:GreenpowerOverlayService,useValue:overlay},{provide:GreenpowerViewService,useValue:view},
 {provide:GreenpowerTelemetryService,useValue:telemetry},{provide:GreenpowerLapService,useValue:lapConfig},
 {provide:GreenpowerEventContextService,useValue:{changed:new Subject(),sessions:[],select(){},clear(){},acknowledge(){}}},{provide:GreenpowerEventsService,useValue:events},{provide:GreenpowerEventEditService,useValue:eventEdit}
]}});
const metadataFixture=TestBed.createComponent(GreenpowerMetadataFieldsComponent);metadataFixture.componentInstance.data=editableDay(emptyDay('2026-10-20'));metadataFixture.detectChanges();metadataFixture.changeDetectorRef.detach();metadataFixture.nativeElement.remove();
const fixture=TestBed.createComponent(GreenpowerTelemetryComponent);const detect=()=>{fixture.changeDetectorRef.markForCheck();fixture.detectChanges()};document.body.append(fixture.nativeElement);detect();
overlay.changed.subscribe(detect);view.changed.subscribe(detect);
const selectLoaded=()=>{const selection=selectionFor(overlay.active?overlay.channels:fixture.componentInstance.channels);record={...selection,chartOrder:Object.keys(selection.charts),revision:1,updatedBy:'admin'};view['saved']=record;view.changed.next()};

let electricalSaved, raceTimeSaved;
window.overlayHarness={resetView(){overlay.end=5970000;lapConfig.ready=false;lapConfig.selectionReady=false;record={...selectionFor(channels()),chartOrder:['["A"]:A','["Spd"]:m/s','computed:voltage-left','computed:voltage-diff'],revision:1,updatedBy:'admin'};view['saved']=record;view.changed.next();detect()},raceTime(mode){
 if(mode==='restore'){view['saved']=raceTimeSaved;raceTimeSaved=undefined;overlay.clear();view.changed.next();detect();return}
 raceTimeSaved ??= view['saved'];
 const samples=[1414,1415].map((raceseconds,receivedAt)=>({id:String(receivedAt),source:'424-phone',receivedAt:receivedAt*1000,raw:JSON.stringify({raceseconds})}));
 const rows=channelsFor(samples,samples.at(-1));
 const comparison=fixture.debugElement.query(By.directive(GreenpowerOverlayComponent)).componentInstance;comparison.window=undefined;comparison.cursor=undefined;
 overlay.clear();fixture.componentInstance.window=undefined;fixture.componentInstance.cursor=mode==='normal'?0:undefined;
 view['saved']={...selectionFor(rows),revision:1,updatedBy:'admin'};view.changed.next();
 telemetry.live=mode==='live';telemetry.channels=rows;telemetry.latest=samples.at(-1);telemetry.start=0;telemetry.end=1000;telemetry.changed.next();
 if(mode==='overlay'){overlay.active=true;overlay.end=1000;overlay.sessions=[{id:'race-time',label:'Race driver',colour:overlayColour(0),loaded:true,hidden:false,excluded:false,channels:rows,session:{startAt:0,endAt:1000}}];overlay.changed.next();}
 detect();
},distance(mode){
 const event={...emptyDay('2026-10-20'),defaults:{motorGearTeeth:12,wheelGearTeeth:60}};
 const session={id:'distance',type:'race',startAt:6000,endAt:30000,overrides:{},batteryIds:[]};
 const samples=Array.from({length:11},(_,i)=>({id:String(i),source:'424-phone',receivedAt:i*3000,raw:JSON.stringify({RPM:30*.44704*60*5/1.29,Spd:99})}));
 fixture.componentInstance.window=undefined;fixture.componentInstance.cursor=undefined;
 if(mode==='overlay'){overlay.active=true;overlay.end=24000;overlay.sessions=[{id:'distance',label:'Distance driver',colour:overlayColour(0),loaded:true,hidden:false,excluded:false,session,channels:overlayChannels(samples.filter(row=>row.receivedAt>=session.startAt),session as any,event)}];overlay.changed.next()}
 else{overlay.clear();fixture.componentInstance.eventContext.event=event;fixture.componentInstance.eventContext.sessions=[session as any];telemetry.live=false;telemetry.channels=channelsFor(samples,samples.at(-1));telemetry.latest=samples.at(-1);telemetry.start=0;telemetry.end=30000;telemetry.changed.next()}
 selectLoaded();detect();
},electrical(mode,voltagePair=false){
 if(mode==='restore'){view['saved']=electricalSaved;electricalSaved=undefined;fixture.componentInstance.eventContext.sessions=[];overlay.clear();view.changed.next();detect();return}
 electricalSaved ??= view['saved'];
 const samples=Array.from({length:11},(_,i)=>({id:String(i),source:'424-phone',receivedAt:i*3000,raw:JSON.stringify({Vt:24,A:20,AH:10+i/60,...(voltagePair?{V1:i<5?9:13}:{})})}));
 const event=emptyDay('2026-10-20'),session={id:'battery',type:'battery_dyno',startAt:6000,endAt:30000,overrides:{},batteryIds:['A','B']};
 const rows=channelsFor(samples,samples.at(-1));
 view['saved']={...selectionFor(rows),charts:{'["A"]:A':true,'computed:power':true,'["AH"]:Ah':true,'computed:energy':true},chartOrder:['["A"]:A','computed:power','["AH"]:Ah','computed:energy'],revision:1,updatedBy:'admin'};
 if(voltagePair)view['saved']={...view['saved'],charts:{'computed:voltage-left':true},chartOrder:['computed:voltage-left']};
 fixture.componentInstance.window=undefined;fixture.componentInstance.cursor=undefined;
 if(mode==='overlay'){overlay.sessionType='battery_dyno';overlay.active=true;overlay.end=24000;overlay.sessions=[{id:'battery',label:overlayLabel(event,session as any,overlayChannels(samples,session as any,event)),colour:overlayColour(0),loaded:true,hidden:false,excluded:false,session,channels:overlayChannels(samples,session as any,event)}];overlay.changed.next()}
 else{overlay.clear();fixture.componentInstance.eventContext.event=mode==='live'?undefined:event;fixture.componentInstance.eventContext.sessions=mode==='live'?[]:[session as any];telemetry.live=mode==='live';telemetry.channels=rows;telemetry.latest=samples.at(-1);telemetry.start=0;telemetry.end=30000;telemetry.changed.next()}
 detect();
},speed(mode,recorded=true,circumference=1.29){
 const event={...emptyDay('2026-10-20'),wheelCircumferenceM:circumference,defaults:{motorGearTeeth:12,wheelGearTeeth:60}};
 const samples=Array.from({length:4},(_,i)=>({id:String(i),source:'424-phone',receivedAt:i*3000,raw:JSON.stringify({RPM:2000+i*200,A:20,...(recorded?{Spd:10+i}: {})})}));
 if(mode==='overlay') {overlay.active=true;overlay.sessions=Array.from({length:2},(_,i)=>{const rows=i?samples.map(row=>({...row,raw:JSON.stringify({RPM:2400,A:20})})):samples;return {id:'speed-'+i,label:'Driver '+(i+1),colour:overlayColour(i),loaded:true,hidden:false,excluded:false,channels:overlayChannels(rows,{id:'s'+i,type:'race',startAt:0,endAt:9000,overrides:{}} as any,event),session:{startAt:0,endAt:9000}}});overlay.end=9000;overlay.changed.next()}
 else {overlay.clear();fixture.componentInstance.eventContext.event=event;telemetry.live=false;telemetry.channels=channelsFor(samples,samples.at(-1));telemetry.latest=samples.at(-1);telemetry.start=0;telemetry.end=9000;telemetry.changed.next()}
 selectLoaded();detect();
},metadata(){const editor=metadataFixture;const old={...emptyDay('2026-10-20')};delete old.wheelCircumferenceM;editor.componentRef.setInput('data',editableDay(old));editor.changeDetectorRef.reattach();document.body.append(editor.nativeElement);editor.detectChanges();this.metadataFixture=editor;return editor.componentInstance.data},metadataError(){return dayMetadataError(this.metadataFixture.componentInstance.data)},removeMetadata(){this.metadataFixture.changeDetectorRef.detach();this.metadataFixture.nativeElement.remove()},metrics(mode){
 const laps=[{time:0,end:120000,lap:1,complete:true,speed:25,current:20},{time:120000,end:240000,lap:2,complete:false},{time:240000,end:390000,lap:3,complete:true,speed:26,current:21}];
 if(mode==='overlay') {overlay.active=true;overlay.sessions=Array.from({length:3},(_,i)=>({id:'metric-'+i,label:'Driver '+(i+1),colour:overlayColour(i),loaded:true,hidden:false,excluded:false,channels:lapMetricChannels(laps),session:{startAt:0,endAt:390000}}));overlay.end=390000;overlay.changed.next()}
 else {overlay.clear();const event={...emptyDay('2026-10-20'),defaults:{motorGearTeeth:12,wheelGearTeeth:60}};fixture.componentInstance.eventContext.event=event;telemetry.live=false;
 const samples=Array.from({length:131},(_,i)=>({id:String(i),source:'424-phone',receivedAt:i*3000,raw:JSON.stringify({RPM:(i*3000<240000?25:26)*.44704*60*5/1.29,A:20,Spd:99})}));
 telemetry.channels=channelsFor(samples,samples.at(-1));telemetry.latest=samples.at(-1);lapConfig.analysis={...lapConfig.analysis,laps};telemetry.start=0;telemetry.end=390000;telemetry.changed.next()}
 selectLoaded();detect();
},fixture,overlay,view,writes,lapConfig,comparison:fixture.debugElement.query(By.directive(GreenpowerOverlayComponent)).componentInstance,async detect(){detect()},set(state){Object.assign(overlay,state);overlay.changed.next();detect()}};
`);
await build({entryPoints:[output+'/entry.ts'],outfile:output+'/bundle.js',bundle:true,format:'esm',platform:'browser',
 nodePaths:[root+'/node_modules'],logLevel:'silent',tsconfigRaw:{compilerOptions:{experimentalDecorators:true}},
 plugins:[{name:'angular-jit',setup(builder){builder.onLoad({filter:/greenpower-(telemetry|overlay|chart|metadata-fields|channel-option)\.component\.ts$/},async args=>{
  let source=await readFile(args.path,'utf8');
  source=source.replace(/templateUrl: '([^']+)'/,(_,name)=>'template: '+JSON.stringify(require('node:fs').readFileSync(resolve(dirname(args.path),name),'utf8')))
   .replace(/styleUrls: \[([^\]]+)\]/,(_,names)=>'styles: '+JSON.stringify([...names.matchAll(/'([^']+)'/g)].map(([,name])=>require('node:fs').readFileSync(resolve(dirname(args.path),name),'utf8'))));
  source += args.path.includes('channel-option') ? '' : args.path.includes('greenpower-telemetry.component')
   ? '\n(GreenpowerTelemetryComponent as any).ctorParameters = () => [{type:GreenpowerTelemetryService},{type:ChangeDetectorRef},{type:Title},{type:GreenpowerViewService},{type:GreenpowerLapService},{type:GreenpowerEventsService},{type:GreenpowerEventEditService},{type:GreenpowerOverlayService},{type:GreenpowerEventContextService}];'
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
  await page.setViewportSize({width,height});await page.evaluate(()=>window.overlayHarness.resetView());await page.evaluate(()=>{window.overlayHarness.fixture.componentInstance.live();window.overlayHarness.detect()});
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
  assert.equal(await page.locator('app-greenpower-chart h2 .math-channel-icon').count(),2,'mark voltage charts, leave raw charts unmarked');
  assert.equal(await page.locator('app-greenpower-chart').nth(2).locator('.overlay-name .math-channel-icon').count(),12,'both calculated voltage traces are marked');
  assert.equal(await page.locator('app-greenpower-chart').first().locator('.math-channel-icon').count(),0,'raw current stays unmarked');

  assert.equal(await page.locator('app-greenpower-chart').nth(2).locator('svg .trace').count(),12,'voltage has both traces per session');
  const chart=page.locator('app-greenpower-chart').first();const plot=chart.locator('svg');await plot.focus();await plot.press('ArrowRight');
  const names=await page.locator('.session-list .session-label').allTextContents();
  assert.deepEqual(await chart.locator('.overlay-name').allTextContents(),names,'charts show session names');
  assert.equal(await page.locator('.session-list .key').count(),0,'square replaces the separate list colour swatch');
  assert.ok((await chart.locator('svg .trace title').allTextContents()).every((text,index)=>text.startsWith(names[index])),'trace labels use session names');
  const readout=await chart.locator('.overlay-readout').boundingBox();await plot.press('ArrowRight');
  assert.deepEqual(await chart.locator('.overlay-readout').boundingBox(),readout,'readout updates preserve geometry');
  await chart.locator('.overlay-entry').first().scrollIntoViewIfNeeded();
  const geometryBefore=await plot.boundingBox();
  const cursorAtHover=await chart.locator('.overlay-time').textContent();
  await chart.locator('.overlay-entry').first().hover();
  await page.waitForTimeout(160);
  for (const graph of await page.locator('app-greenpower-chart').all()) {
    const paths=graph.locator('svg .trace');
    assert.equal(await paths.first().evaluate(el=>getComputedStyle(el).opacity),'1');
    assert.equal(await paths.last().evaluate(el=>getComputedStyle(el).opacity),'0.35','other sessions fade across every chart');
  }
  assert.deepEqual(await plot.boundingBox(),geometryBefore,'hover preserves graph geometry');
  assert.equal(await chart.locator('.overlay-time').textContent(),cursorAtHover,'hover preserves cursor');
  // Cross the actual inter-row gap slowly: it must never restore all traces.
  const firstLegend=await chart.locator('.overlay-entry').first().boundingBox();
  const secondLegend=await chart.locator('.overlay-entry').nth(1).boundingBox();
  await page.mouse.move(firstLegend.x+10,(firstLegend.y+firstLegend.height+secondLegend.y)/2);
  await page.waitForTimeout(180);
  assert.equal(await page.evaluate(()=>window.overlayHarness.comparison.legendHighlight?.sessionId),'session-0','gap retains the previous session');
  assert.equal(await chart.locator('.legend-hovered').count(),1,'legend background persists through the gap');
  assert.equal(await chart.locator('svg .trace').last().evaluate(el=>getComputedStyle(el).opacity),'0.35','unrelated traces never flash in the gap');
  await chart.locator('.overlay-entry').nth(1).hover();await page.waitForTimeout(160);
  assert.equal(await page.evaluate(()=>window.overlayHarness.comparison.legendHighlight?.sessionId),'session-1','next row directly replaces emphasis');
  for (const graph of await page.locator('app-greenpower-chart').all()) {
    assert.equal(await graph.locator('svg .trace').last().evaluate(el=>getComputedStyle(el).opacity),'0.35','unrelated traces stay dim during handoff');
  }
  await chart.locator('.overlay-entry').first().hover();await page.waitForTimeout(160);
  await page.screenshot({path:output+'/'+name+'-legend-hover.png',fullPage:true});
  await page.mouse.move(0,0);await page.waitForTimeout(160);
  assert.equal(await page.locator('svg .trace.trace-dimmed').count(),0,'pointer exit restores all traces');
  const voltage=page.locator('app-greenpower-chart').nth(2);
  await voltage.locator('.overlay-entry').nth(1).hover();await page.waitForTimeout(160);
  assert.equal(await voltage.locator('svg .trace').nth(0).evaluate(el=>getComputedStyle(el).opacity),'0.35');
  assert.equal(await voltage.locator('svg .trace').nth(1).evaluate(el=>getComputedStyle(el).opacity),'1','paired trace is isolated');
  assert.equal(await chart.locator('svg .trace').first().evaluate(el=>getComputedStyle(el).opacity),'1','session stays visible in another metric');
  await page.mouse.move(0,0);
  await chart.locator('.overlay-visibility').nth(1).focus();await page.waitForTimeout(160);
  assert.equal(await chart.locator('svg .trace').first().evaluate(el=>getComputedStyle(el).opacity),'0.35','keyboard focus also dims other traces');
  await plot.focus();await page.waitForTimeout(160);
  assert.equal(await page.locator('svg .trace.trace-dimmed').count(),0);
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
  assert.equal(await page.getByRole('checkbox',{name:'Vehicle speed / Motor-derived speed chart',exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'Save',exact:true}).isEnabled(),true,'track readiness cannot block chart saving');
  assert.deepEqual(await toolbar.boundingBox(),beforeEditing,'editing preserves toolbar geometry');
  const marker=page.locator('.channel-option[data-channel="computed:voltage-left"] .math-channel-icon');
  assert.equal(await marker.getAttribute('title'),'Calculated in the UI');
  assert.equal(await marker.getAttribute('aria-hidden'),'true');
  assert.equal(await marker.evaluate(el=>getComputedStyle(el).display),'inline-block');
  assert.equal(await marker.evaluate(el=>getComputedStyle(el).fontSize),'11px');
  assert.ok((await marker.boundingBox()).width<=14,'marker remains compact');
  assert.equal(await page.locator('.channel-option[data-channel=\'["A"]:A\'] .math-channel-icon').count(),0);
  await page.screenshot({path:output+'/'+name+'-editor.png',fullPage:true});
  const markerToggle=page.getByRole('checkbox',{name:'Current marker',exact:true});
  const markerValue=page.getByRole('spinbutton',{name:'Current marker value',exact:true});
  assert.equal(await markerToggle.isChecked(),true);assert.equal(await markerValue.inputValue(),'24');
  const markerRow=page.locator('.channel-option').filter({has:markerToggle});
  const markerHeight=(await markerRow.boundingBox()).height;
  await markerToggle.uncheck();assert.equal(await markerValue.isDisabled(),true);
  assert.equal((await markerRow.boundingBox()).height,markerHeight,'marker toggles preserve row height');
  await markerToggle.check();await markerValue.fill('');
  assert.equal(await markerValue.getAttribute('aria-invalid'),'true');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.overlayHarness.view.editing),true,'invalid marker preserves the draft');
  assert.equal(await page.getByText('Enter a number.',{exact:true}).count(),1);
  await markerValue.fill('26.5');
  assert.equal(await chart.locator('.marker-label').textContent(),'24','draft is private');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Edit view',exact:true}).click();
  assert.equal(await markerValue.inputValue(),'24','cancel restores the saved marker');
  await markerValue.fill('26.5');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.waitForFunction(()=>!window.overlayHarness.view.editing);
  assert.equal(await chart.locator('.marker-label').textContent(),'27');
  await page.getByRole('button',{name:'Edit view',exact:true}).click();await markerToggle.uncheck();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.waitForFunction(()=>!window.overlayHarness.view.editing);
  assert.equal(await chart.locator('.marker-label').count(),0,'disabled marker disappears');
  await page.getByRole('button',{name:'Edit view',exact:true}).click();
  assert.equal(await markerValue.inputValue(),'26.5','disabled markers retain their value');
  await markerToggle.check();await markerValue.fill('24');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.waitForFunction(()=>!window.overlayHarness.view.editing);
  assert.equal(await chart.locator('.marker-label').textContent(),'24');
  await page.getByRole('button',{name:'Edit view',exact:true}).click();
  await page.screenshot({path:output+'/'+name+'-marker-editor.png',fullPage:true});
  const scalarSettings=await page.evaluate(()=>JSON.stringify(window.overlayHarness.view.draft.scalars));
  await page.evaluate(()=>{const h=window.overlayHarness;h.comparison.window={start:1000,end:100000};h.detect()});
  const originalOrder=await page.locator('app-greenpower-chart h2').allTextContents();
  await page.getByRole('button',{name:'Reorder Vehicle speed / Motor-derived speed chart',exact:true}).press('ArrowUp');
  assert.equal(await page.locator('.channel-label').first().textContent(),'Vehicle speed / Motor-derived speed · m/s');
  await page.getByRole('checkbox',{name:'Current chart',exact:true}).uncheck();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.deepEqual(await page.locator('app-greenpower-chart h2').allTextContents(),originalOrder,'cancel preserves charts');
  await page.getByRole('button',{name:'Edit view',exact:true}).click();
  await page.getByRole('button',{name:'Reorder Vehicle speed / Motor-derived speed chart',exact:true}).press('ArrowUp');
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
  for(let step=0;step<3;step++) await page.getByRole('button',{name:'Reorder Current chart',exact:true}).press('ArrowUp');
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
  await page.evaluate(()=>{const h=window.overlayHarness;h.fixture.componentInstance.eventContext.event.wheelCircumferenceM=1.4;h.fixture.componentInstance.telemetry.changed.next();h.detect()});
  assert.match(await motorAverage.locator('.readout').textContent(),/27.1 mph/,'metadata-only changes recalculate the lap average');
  await page.evaluate(()=>{const h=window.overlayHarness;h.lapConfig.ready=true;h.lapConfig.selectionReady=true;h.detect()});
  const geometry=()=>toolbar.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height}});
  const beforeCalculatedEdit=await geometry();
  await page.getByRole('button',{name:'Edit view',exact:true}).click();
  await page.getByRole('button',{name:'Scalars',exact:true}).click();await page.evaluate(()=>window.overlayHarness.detect());
  for(const label of ['Motor-derived speed','Distance travelled','Power','Energy','Voltage left','Voltage right','Voltage diff','GPS lap','Lap time','Lap average speed · from motor','Lap average amps']) {
   assert.equal(await page.getByRole('checkbox',{name:label+' scalar',exact:true}).count(),1,label+' available as scalar');
  }
  await page.getByRole('checkbox',{name:'Voltage right scalar',exact:true}).check();
  await page.getByRole('checkbox',{name:'Lap time scalar',exact:true}).uncheck();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.waitForFunction(()=>!window.overlayHarness.view.editing);
  assert.equal(await page.locator('.reading').filter({has:page.locator('span').getByText('Lap time',{exact:true})}).count(),0);
  const unavailable=page.locator('.reading').filter({has:page.getByText('Voltage right',{exact:true})});
  assert.equal(await unavailable.locator('strong').textContent(),'— V','unavailable selected scalar remains labelled');
  const motorScalar=page.locator('.reading').filter({has:page.getByText('Motor-derived speed',{exact:true})});
  assert.match(await motorScalar.locator('strong').textContent(),/mph/);
  assert.equal(await motorScalar.locator('.math-channel-icon').count(),1,'calculated scalar marked');
  await page.getByRole('button',{name:'Edit view',exact:true}).click();
  await page.getByRole('button',{name:'Charts',exact:true}).click();await page.evaluate(()=>window.overlayHarness.detect());
  assert.equal(await page.getByRole('checkbox',{name:'Voltage left / right chart',exact:true}).count(),1);
  assert.equal(await page.getByRole('checkbox',{name:'Vehicle speed / Motor-derived speed chart',exact:true}).count(),1);
  await page.getByRole('checkbox',{name:'Lap time chart',exact:true}).uncheck();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.waitForFunction(()=>!window.overlayHarness.view.editing);
  assert.equal(await normalMetric.count(),0,'calculated chart hides after save');
  assert.deepEqual(await geometry(),beforeCalculatedEdit,'calculated settings retain toolbar geometry');
  await page.getByRole('button',{name:'Edit view',exact:true}).click();
  await page.getByRole('checkbox',{name:'Lap time chart',exact:true}).check();
  const selectedCalculated=await page.evaluate(()=>window.overlayHarness.view.draft.chartOrder.length);
  for(let step=0;step<selectedCalculated;step++) await page.getByRole('button',{name:'Reorder Lap time chart',exact:true}).press('ArrowUp');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.waitForFunction(()=>!window.overlayHarness.view.editing);
  assert.equal(await page.locator('app-greenpower-chart h2').first().textContent(),'Lap time · s','calculated chart follows saved order');
  await page.screenshot({path:output+'/'+name+'-calculated-settings.png',fullPage:true});
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
  assert.equal(await speedChart.locator('h2 .math-channel-icon').count(),0,'recorded speed heading stays raw');
  assert.equal(await speedChart.locator('.comparison-key .math-channel-icon').count(),1,'derived speed trace marked');
  assert.equal(await speedChart.locator('.raw-key .math-channel-icon').count(),0);
  await speedChart.locator('.comparison-key').hover();await page.waitForTimeout(160);
  assert.equal(await speedChart.locator('.trace:not(.comparison-trace)').evaluate(el=>getComputedStyle(el).opacity),'0.35');
  assert.equal(await speedChart.locator('.comparison-trace').evaluate(el=>getComputedStyle(el).opacity),'1');
  const rawLegend=await speedChart.locator('.raw-key').boundingBox();
  const derivedLegend=await speedChart.locator('.comparison-key').boundingBox();
  await page.mouse.move((rawLegend.x+rawLegend.width+derivedLegend.x)/2,derivedLegend.y+5);
  await page.waitForTimeout(180);
  assert.equal(await speedChart.locator('.trace:not(.comparison-trace)').evaluate(el=>getComputedStyle(el).opacity),'0.35','comparison column gap retains emphasis');
  await speedChart.locator('.raw-key').hover();await page.waitForTimeout(160);
  assert.equal(await speedChart.locator('.comparison-trace').evaluate(el=>getComputedStyle(el).opacity),'0.35','comparison handoff selects the next trace');
  await page.mouse.move(0,0);await page.waitForTimeout(160);
  assert.equal(await speedChart.locator('.trace-dimmed').count(),0,'ordinary comparison legends restore on exit');
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
   assert.equal(await page.locator('app-greenpower-chart .limit-key').count(),0,'limits are omitted from legends');
   assert.equal(await page.locator('app-greenpower-chart .current-legend').count(),0,'single traces have no redundant legend');
   assert.equal(await energy.locator('.marker-label').textContent(),'550');
   assert.equal(await energy.locator('svg .chart-marker').count(),1);
   assert.ok((await power.locator('svg .trace').first().getAttribute('d')).length>0);
   assert.ok((await energy.locator('svg .trace').first().getAttribute('d')).length>0);
   if(mode==='normal') {
    await page.evaluate(()=>{const h=window.overlayHarness;h.fixture.componentInstance.window={start:18000,end:30000};h.fixture.componentInstance.cursor=30000;h.detect()});
    assert.match(await energy.locator('.readout').textContent(),/3\s*Wh/,'zoom retains session energy baseline');
    await energy.locator('svg').focus();await energy.locator('svg').press('ArrowLeft');
    assert.equal(await energy.locator('.cursor').count(),1,'energy chart supports keyboard inspection');
   } else if(mode==='live') {
    await page.evaluate(()=>{const h=window.overlayHarness;h.fixture.componentInstance.cursor=30000;h.detect()});
    assert.match(await energy.locator('.readout').textContent(),/4\s*Wh/,'live energy starts at recording origin');
   } else {
    assert.equal(await page.getByRole('heading',{name:'2026 battery dyno tests',exact:true}).count(),1);
    assert.match(await energy.locator('.overlay-readout').textContent(),/3 Wh/,'computed maximum appears in chart session labels');
    if(!await page.locator('#telemetry-overlay-panel').count()) {await overlayButton.click();await page.evaluate(()=>window.overlayHarness.detect())}
    assert.match(await page.locator('.session-list .session-label').textContent(),/3 Wh/,'maximum appears in the main session list');
    await overlayButton.click();await page.evaluate(()=>window.overlayHarness.detect());
    assert.match(await page.locator('.session-key').textContent(),/3 Wh/,'maximum remains in the collapsed-panel legend');
    await page.evaluate(()=>{const h=window.overlayHarness;h.comparison.cursor=24000;h.detect()});
    assert.match(await energy.locator('.overlay-readout').textContent(),/3/,'overlay uses the same session energy');
   }
   await page.screenshot({path:output+'/'+name+'-electrical-'+mode+'.png',fullPage:true});
  }
  await page.evaluate(()=>window.overlayHarness.electrical('restore'));
  for(const mode of ['normal','live','overlay']) {
   await page.evaluate(mode=>window.overlayHarness.electrical(mode,true),mode);
   const voltage=page.locator('app-greenpower-chart').filter({has:page.getByRole('heading',{name:/^Voltage left \/ right/})});
   assert.equal(await voltage.count(),1);
   assert.equal(await voltage.locator('.limit-key').count(),0,'voltage limit is omitted from the legend');
   assert.equal(await voltage.locator('.marker-label').textContent(),'10');
   assert.equal(await voltage.locator('svg .chart-marker').count(),1);
   assert.equal(await voltage.locator('svg .trace').count(),2);
   assert.equal(await voltage.locator('.current-legend').count(),mode==='overlay'?0:1,'only measured comparison traces retain a legend');
   if(mode!=='overlay')assert.equal(await voltage.locator('.comparison-legend .legend-value').count(),2,'both measured readings remain');
   const geometry=await voltage.boundingBox();
   await voltage.locator('svg').focus();await voltage.locator('svg').press('ArrowLeft');
   await page.evaluate(()=>window.overlayHarness.detect());
   assert.equal((await voltage.boundingBox()).height,geometry.height,'cursor retains chart height');
   await page.evaluate(mode=>{const h=window.overlayHarness;if(mode==='overlay')h.comparison.zoom({start:18000,end:24000});else h.fixture.componentInstance.zoom({start:18000,end:24000});h.detect()},mode);
   assert.equal(await voltage.locator('.marker-label').textContent(),'10','zoom retains the limit');
   assert.doesNotMatch(await voltage.locator('svg .chart-marker').getAttribute('d'),/NaN|Infinity/);
   assert.equal((await voltage.boundingBox()).height,geometry.height,'zoom retains chart height');
   await page.screenshot({path:output+'/'+name+'-voltage-limit-'+mode+'.png',fullPage:true});
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

  for(const mode of ['normal','live','overlay']) {
   await page.evaluate(mode=>window.overlayHarness.raceTime(mode),mode);
   const race=page.locator('app-greenpower-chart').filter({has:page.getByRole('heading',{name:'Race time · min',exact:true})});
   assert.equal(await race.count(),1);
   if(mode==='overlay') {
    await race.locator('svg').focus();await race.locator('svg').press('ArrowLeft');await page.evaluate(()=>window.overlayHarness.detect());
    assert.equal(await race.locator('.overlay-value').textContent(),'23m 34s');
    assert.equal(await race.locator('.overlay-value').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'duration fits reserved value column');
    const before=await race.boundingBox();
    await race.getByRole('button',{name:'Hide Race driver',exact:true}).click();
    assert.equal(await race.locator('.overlay-value').textContent(),'—');
    const after=await race.boundingBox();
    assert.deepEqual({width:after.width,height:after.height},{width:before.width,height:before.height},'hiding readout retains chart dimensions');
   } else {
    assert.match(await race.locator('.readout').textContent(),mode==='live'?/23m 35s/:/23m 34s/);
    assert.match(await page.locator('.reading').textContent(),mode==='live'?/23m 35s/:/23m 34s/);
   }
   assert.equal(await page.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:output+'/'+name+'-race-time-'+mode+'.png',fullPage:true});
  }
  await page.evaluate(()=>window.overlayHarness.raceTime('restore'));
  await page.evaluate(()=>{const h=window.overlayHarness;h.removeMetadata();const t=h.fixture.componentInstance.telemetry;t.channels=[];t.latest=undefined;t.live=true;t.start=0;t.end=1000;h.fixture.componentInstance.eventContext.event=undefined;t.changed.next();h.detect()});


 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({output,widths:[1440,390,320],checks:['synchronized legend hover, paired traces, keyboard focus and reset','hover preserves geometry and cursor','toolbar stability','touch targets','no page overflow','loading/error/empty','Hide/Show retains data, identity, geometry and cursor','panel collapse retains charts','voltage pairs','keyboard cursor','readout stability','map/laps disabled and restored','chart editing, keyboard order, save, cancel, exit and permissions','calculated scalar catalogue, visibility and unavailable values','calculated chart visibility and saved order','300px overlay plots']}));
} finally {await browser.close();await new Promise(done=>server.close(done))}
