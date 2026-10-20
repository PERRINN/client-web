// Real Angular templates and services, synthetic telemetry and metadata only; never initializes Firebase.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), folder = root + '/src/app/greenpower-telemetry';
const output = await mkdtemp(resolve(tmpdir(), 'greenpower-day-ui-'));
await writeFile(output + '/entry.ts', `
import 'zone.js'; import '@angular/compiler';
import { ChangeDetectorRef, NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { Title } from '@angular/platform-browser';
import { CommonModule } from '@angular/common'; import { FormsModule } from '@angular/forms'; import { RouterModule } from '@angular/router';
import { AngularFirestore } from '@angular/fire/compat/firestore'; import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { BehaviorSubject, Subject, defer } from 'rxjs';
import { PermissionsService } from '${root}/src/app/permissions.service';
import { GreenpowerTelemetryComponent } from '${folder}/greenpower-telemetry.component';
import { GreenpowerTelemetryService } from '${folder}/greenpowerTelemetry.service';
import { GreenpowerEventsService } from '${folder}/greenpowerEvents.service';
import { GreenpowerEventEditService } from '${folder}/greenpowerEventEdit.service';
import { GreenpowerEventSelectorComponent } from '${folder}/greenpower-event-selector.component';
import { GreenpowerEventEditorComponent } from '${folder}/greenpower-event-editor.component';
import { GreenpowerMetadataFieldsComponent } from '${folder}/greenpower-metadata-fields.component';
import { GreenpowerViewService } from '${folder}/greenpowerView.service';
import { GreenpowerLapService } from '${folder}/greenpowerLap.service';
import { GreenpowerMapComponent } from '${folder}/greenpower-map.component';
import { GreenpowerLapListComponent } from '${folder}/greenpower-lap-list.component';
import { GreenpowerChartComponent } from '${folder}/greenpower-chart.component';
import { channelsFor } from '${folder}/greenpowerData';
import { emptyDay } from '${folder}/greenpowerDay';
const state = new BehaviorSubject({ ready:true, uid:'viewer', isAdmin:false });
const permissions = { state, get current(){return state.value;} };
const records = new Map(), calls = [], listeners = []; let fail = false, saveFail = false;
const date='2026-06-14', first=Date.parse(date+'T08:00:00Z');
const event=emptyDay(date); event.eventName='Workshop'; event.trackId='workshop'; event.defaults={driver:'Alex',motorGearTeeth:12,wheelGearTeeth:60};
for(let i=0;i<2;i++){const id='s'+i, startAt=first+i*3600000,endAt=startAt+1800000; records.set('GreenpowerTelemetry/424/days/'+date+'/sessions/'+id,{id,type:i?'race':'practice',startAt,endAt,batteryIds:['A','B'],overrides:i?{driver:'Sam'}:{},ranges:[{day:date,source:'424-phone',firstChunk:'0000000000',lastChunk:'0000000000',firstIndex:0,lastIndex:1,firstSampleId:'a',lastSampleId:'b',firstAt:startAt,lastAt:endAt}],schemaVersion:2,telemetryRoot:'GreenpowerTelemetry/424',revision:1,updatedBy:'viewer'});}
records.set('GreenpowerTelemetry/424/days/'+date,event);
records.set('GreenpowerTelemetry/424/days/2026-06-15',{...emptyDay('2026-06-15'),eventName:'Circuit test'});
records.set('GreenpowerTelemetry/424/tracks/workshop',{name:'Workshop',bounds:null,line:null,cells:[],revision:1,updatedBy:'admin'});
const snapshot=path=>({exists:records.has(path),id:path.split('/').at(-1),data:()=>records.get(path),metadata:{fromCache:false,hasPendingWrites:false}});
const notify=()=>listeners.filter(l=>l.active).forEach(l=>l.next(snapshot(l.path)));
const ref=(path,spec={filters:[],order:[]})=>({path,id:path.split('/').at(-1),doc:(id='new-track')=>ref(path+'/'+id),
 where:(key,op,value)=>ref(path,{...spec,filters:[...spec.filters,[key,op,value]]}),orderBy:(key,direction='asc')=>ref(path,{...spec,order:[...spec.order,[key,direction]]}),limit:limit=>ref(path,{...spec,limit}),startAfter:cursor=>ref(path,{...spec,after:cursor.id}),
 async get(){calls.push(path);if(fail)throw Error('synthetic');if(path.split('/').length%2===0)return snapshot(path);
 const field=(doc,key)=>key==='__name__'?doc.id:doc.data()[key];let docs=[...records.keys()].filter(key=>key.startsWith(path+'/')&&!key.slice(path.length+1).includes('/')).map(snapshot).filter(doc=>spec.filters.every(([key,op,value])=>op==='=='?field(doc,key)===value:op==='>='?field(doc,key)>=value:field(doc,key)<=value));
 docs.sort((a,b)=>{for(const [key,direction] of spec.order){if(field(a,key)!==field(b,key))return(field(a,key)<field(b,key)?-1:1)*(direction==='desc'?-1:1);}return 0;});if(spec.after)docs=docs.slice(docs.findIndex(doc=>doc.id===spec.after)+1);docs=docs.slice(0,spec.limit);return {docs,size:docs.length};},
 onSnapshot(options,next,error){const l={path,next,error,active:true};listeners.push(l);queueMicrotask(()=>{if(l.active)next(snapshot(path));});return()=>l.active=false;}});
const db={doc:ref,collection:ref,async runTransaction(callback){const writes=[];await callback({get:async r=>snapshot(r.path),set:(r,value)=>writes.push([r.path,value])});writes.forEach(([path,value])=>records.set(path,value));notify();}};
const telemetry={changed:new Subject(),access:'signed-in',live:false,day:'2026-06-13',loading:false,error:'',more:false,recordingKey:'',connected:true,channels:[],latest:undefined,start:0,end:0,dayLoads:0,sessionLoads:0,
 seed(start,end){const samples=Array.from({length:40},(_,i)=>({id:String(i),receivedAt:start+(end-start)*i/39,source:'424-phone',raw:JSON.stringify({Vt:24+i/100,Spd:10})}));this.start=start;this.end=end;this.latest=samples.at(-1);this.channels=channelsFor(samples,this.latest);},
 async select(day,live=false){this.dayLoads++;this.day=day;this.live=live;this.recordingKey='';this.seed(Date.parse(day+'T08:00:00Z'),Date.parse(day+'T16:00:00Z'));this.changed.next();},
 async selectRecording(key,ranges){this.sessionLoads++;this.day=ranges[0].day;this.live=false;this.recordingKey=key;this.seed(ranges[0].firstAt,ranges.at(-1).lastAt);this.changed.next();},
 range(start,end){return [{day:this.day,source:'424-phone',firstChunk:'0000000000',lastChunk:'0000000000',firstIndex:0,lastIndex:1,firstSampleId:'a',lastSampleId:'b',firstAt:Math.round(start),lastAt:Math.round(end)}];},tick(){},loadMore(){}};
telemetry.seed(Date.parse('2026-06-13T08:00:00Z'),Date.parse('2026-06-13T09:00:00Z'));
const view={changed:new Subject(),ready:true,editing:false,canEdit:false,saving:false,error:'',draft:{scalars:{},charts:{}},scalars:channels=>channels.slice(0,1),charts:channels=>channels.slice(0,1),available:()=>[],cancel(){this.editing=false;},save(){}};
const laps={changed:new Subject(),eventTrack:true,ready:true,selectionReady:true,canEdit:false,candidates:[],fixes:[],analysis:{channel:{id:'lap',label:'Lap',unit:'',points:[]},laps:[]},select(){},syncEditing(){},update(){},line:null,name:'',revision:0,mismatch:false};
const functions={httpsCallable:()=>input=>defer(async()=>{if(saveFail)throw {code:'functions/failed-precondition'};
const parentPath='GreenpowerTelemetry/424/days/'+input.date;
if(input.kind==='session'){const next={...input.session,telemetryRoot:'GreenpowerTelemetry/424',schemaVersion:2,revision:input.expectedSessionRevision+1,updatedBy:'viewer'};records.set(parentPath+'/sessions/'+next.id,next);notify();return {date:input.date,revision:input.expectedRevision,sessionId:next.id,sessionRevision:next.revision,changeId:'synthetic'};}
const next={...input.data,schemaVersion:2,revision:input.expectedRevision+1,updatedBy:'viewer'};records.set(parentPath,next);notify();return {date:input.date,revision:next.revision,changeId:'synthetic'};})};
GreenpowerTelemetryComponent.ctorParameters=()=>[{type:GreenpowerTelemetryService},{type:ChangeDetectorRef},{type:Title},{type:GreenpowerViewService},{type:GreenpowerLapService},{type:GreenpowerEventsService},{type:GreenpowerEventEditService}];
GreenpowerEventsService.ctorParameters=()=>[{type:PermissionsService},{type:AngularFirestore}];
GreenpowerEventEditService.ctorParameters=()=>[{type:GreenpowerEventsService},{type:GreenpowerTelemetryService},{type:AngularFireFunctions}];
GreenpowerEventSelectorComponent.ctorParameters=()=>[{type:GreenpowerEventsService},{type:ChangeDetectorRef}];
GreenpowerEventEditorComponent.ctorParameters=()=>[{type:GreenpowerEventEditService},{type:GreenpowerEventsService},{type:GreenpowerTelemetryService},{type:ChangeDetectorRef}];
GreenpowerMetadataFieldsComponent.ctorParameters=()=>[{type:GreenpowerEventsService}];
GreenpowerMapComponent.ctorParameters=()=>[{type:ChangeDetectorRef}];GreenpowerChartComponent.ctorParameters=()=>[{type:ChangeDetectorRef},{type:NgZone}];
TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());
TestBed.configureTestingModule({imports:[CommonModule,FormsModule,RouterModule.forRoot([])],declarations:[GreenpowerTelemetryComponent,GreenpowerEventSelectorComponent,GreenpowerEventEditorComponent,GreenpowerMetadataFieldsComponent,GreenpowerChartComponent,GreenpowerMapComponent,GreenpowerLapListComponent],providers:[{provide:PermissionsService,useValue:permissions},{provide:AngularFirestore,useValue:{firestore:db}},{provide:AngularFireFunctions,useValue:functions}]});
TestBed.overrideComponent(GreenpowerTelemetryComponent,{set:{providers:[{provide:GreenpowerTelemetryService,useValue:telemetry},{provide:GreenpowerViewService,useValue:view},{provide:GreenpowerLapService,useValue:laps},GreenpowerEventsService,GreenpowerEventEditService]}});
const fixture=TestBed.createComponent(GreenpowerTelemetryComponent);document.querySelector('.contentCard').append(fixture.nativeElement);fixture.autoDetectChanges();
window.dayHarness={stats:()=>({dayLoads:telemetry.dayLoads,sessionLoads:telemetry.sessionLoads,calls:[...calls]}),admin(){state.next({ready:true,uid:'viewer',isAdmin:true});fixture.detectChanges();},empty(){records.clear();fixture.componentInstance.events.loadEvents(true);},failure(value){fail=value;},saveFailure(value){saveFail=value;},error(){telemetry.error='Synthetic load failure';telemetry.changed.next();},loading(value){telemetry.loading=value;telemetry.changed.next();},logout(){telemetry.access='signed-out';state.next({ready:true,uid:'',isAdmin:false});telemetry.changed.next();}};
`);
await build({ entryPoints: [output + '/entry.ts'], outfile: output + '/bundle.js', bundle: true, platform: 'browser', format: 'iife', nodePaths: [root + '/node_modules'], tsconfigRaw: { compilerOptions: { experimentalDecorators: true } }, plugins: [{ name: 'angular-resources', setup(plugin) {
  plugin.onLoad({ filter: /\.component\.ts$/ }, async args => {
    let source = await readFile(args.path, 'utf8');
    const template = /templateUrl:\s*'([^']+)'/.exec(source), style = /styleUrls:\s*\[\s*'([^']+)'\s*\]/.exec(source);
    if (template) source = source.replace(template[0], 'template: ' + JSON.stringify(await readFile(resolve(dirname(args.path), template[1]), 'utf8')));
    if (style) source = source.replace(style[0], 'styles: [' + JSON.stringify(await readFile(resolve(dirname(args.path), style[1]), 'utf8')) + ']');
    return { contents: source, loader: 'ts', resolveDir: dirname(args.path) };
  });
} }] });
const shellStyle = (await readFile(root + '/src/app/app.component.css', 'utf8')).replaceAll(':host', '.shell-harness');
const html = `<!doctype html><html><head><base href="/"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${await readFile(root + '/src/styles.css', 'utf8')} ${shellStyle}</style></head><body><div class="shell-harness"><div class="appShell sidebarShell"><header class="mobileShellHeader">PERRINN</header><aside class="topNav shellSidebar"></aside><div id="main_container"><div class="contentWrap"><div class="contentCard"></div></div></div></div></div><script src="/bundle.js"></script></body></html>`;
const server = createServer(async (req, res) => { res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/bundle.js' ? await readFile(output + '/bundle.js') : html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(10000); page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    await page.goto('http://127.0.0.1:' + server.address().port); await page.locator('.telemetry-page h1').waitFor();
    const origin = await page.locator('.controls').boundingBox(); const originalHeader = await page.locator('h1').innerText();
    await page.getByRole('button', { name: 'Load history', exact: true }).click();
    await page.locator('#history-event option[value="2026-06-14"]').waitFor({ state: 'attached' });
    await page.locator('#history-event').selectOption('2026-06-14'); await page.locator('#history-session option[value="s1"]').waitFor({ state: 'attached' });
    await page.locator('#history-session').selectOption('s1');
    assert.deepEqual(await page.evaluate(() => [window.dayHarness.stats().dayLoads, window.dayHarness.stats().sessionLoads]), [0, 0]);
    assert.equal(await page.locator('h1').innerText(), originalHeader); assert.deepEqual(await page.locator('.controls').boundingBox(), origin);
    await page.getByRole('button', { name: 'Load', exact: true }).click(); assert.deepEqual(await page.evaluate(() => [window.dayHarness.stats().dayLoads, window.dayHarness.stats().sessionLoads]), [0, 1]);
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Workshop');
    assert.equal(await page.locator('h1').innerText(), 'Workshop'); assert.match(await page.locator('[aria-label="Loaded recording"]').innerText(), /Race/);
    await page.locator('#history-event').selectOption('2026-06-15');
    assert.equal(await page.locator('h1').innerText(), 'Workshop'); assert.match(await page.locator('[aria-label="Loaded recording"]').innerText(), /Race/);
    await page.getByRole('button', { name: 'Load', exact: true }).click(); await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Circuit test'); assert.equal(await page.locator('h1').innerText(), 'Circuit test');
    assert.equal(await page.evaluate(() => window.dayHarness.stats().dayLoads), 1);
    await page.locator('#history-event').selectOption('2026-06-14'); await page.locator('#history-session option[value="s1"]').waitFor({ state: 'attached' });
    await page.evaluate(() => window.dayHarness.admin()); await page.getByRole('button', { name: 'Edit view', exact: true }).click();
    await page.getByRole('button', { name: 'Edit event', exact: true }).click();
    await page.getByLabel('Motor gear · teeth', { exact: true }).fill('13');
    await page.screenshot({ path: output + '/editor-' + width + '.png', fullPage: true });
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    await page.evaluate(() => window.dayHarness.saveFailure(true)); await page.getByRole('button', { name: 'Confirm save', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Metadata changed elsewhere' }).waitFor();
    assert.equal(await page.getByLabel('Motor gear · teeth', { exact: true }).inputValue(), '13');
    await page.evaluate(() => window.dayHarness.saveFailure(false)); await page.getByRole('button', { name: 'Review', exact: true }).click(); await page.getByRole('button', { name: 'Confirm save', exact: true }).click();
    await page.getByText('Saved', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Add session', exact: true }).isDisabled(), true, 'a different loaded day cannot supply session ranges');
    await page.getByRole('button', { name: 'Edit view', exact: true }).click();
    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Workshop');
    await page.getByRole('button', { name: 'Edit view', exact: true }).click();
    await page.getByRole('button', { name: 'Add session', exact: true }).click();
    const fields = page.locator('app-greenpower-metadata-fields');
    await fields.getByLabel('Session type', { exact: true }).selectOption('practice');
    for (const retired of ['Name', 'Notes', 'Description', 'Operator', 'Tags', 'Result', 'Purpose', 'Outcome']) assert.equal(await fields.getByLabel(retired, { exact: true }).count(), 0);
    assert.equal(await fields.getByLabel('Motor gear · teeth', { exact: true }).getAttribute('placeholder'), '13');
    await fields.getByLabel('Driver', { exact: true }).fill('Sam');
    await page.getByLabel('Start · UK', { exact: true }).fill('10:00:00');
    await page.getByLabel('End · UK', { exact: true }).fill('10:30:00');
    await page.getByRole('button', { name: 'Use times', exact: true }).click();
    await fields.getByLabel('Driver', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: output + '/session-' + width + '.png', fullPage: true });
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm save', exact: true }).click();
    await page.getByText('Saved', { exact: true }).waitFor();
    await page.screenshot({ path: output + '/history-' + width + '.png', fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: 'Edit view', exact: true }).click();
    await page.locator('app-greenpower-event-editor').waitFor({ state: 'detached' });
    const load = page.getByRole('button', { name: 'Load', exact: true }); const before = await load.boundingBox(); const scrollBefore = await page.locator('#main_container').evaluate(el => el.scrollTop);
    await page.evaluate(() => window.dayHarness.loading(true)); assert.equal(await page.getByRole('button', { name: 'Loading', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('#main_container').evaluate(el => el.scrollTop), scrollBefore, 'loading preserves the scroll position');
    assert.deepEqual(await page.getByRole('button', { name: 'Loading', exact: true }).boundingBox(), before);
    await page.evaluate(() => window.dayHarness.loading(false)); await page.evaluate(() => window.dayHarness.logout());
    await page.getByRole('link', { name: 'Sign in to view telemetry' }).waitFor();
    await page.close();
  }
  const states = await browser.newPage({ viewport: { width: 390, height: 900 } });
  states.on('pageerror', error => errors.push(error.message));
  await states.goto('http://127.0.0.1:' + server.address().port); await states.locator('h1').waitFor();
  await states.evaluate(() => window.dayHarness.failure(true));
  await states.getByRole('button', { name: 'Load history', exact: true }).click();
  await states.getByRole('alert').filter({ hasText: 'Could not load events' }).waitFor();
  const count = await states.evaluate(() => window.dayHarness.stats().calls.length);
  await states.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
  assert.equal(await states.evaluate(() => window.dayHarness.stats().calls.length), count);
  await states.evaluate(() => { window.dayHarness.failure(false); window.dayHarness.empty(); });
  await states.getByText('No events.', { exact: true }).waitFor();
  await states.close();
  assert.deepEqual(errors, []); console.log(JSON.stringify({ widths: [1440, 390, 320], errors, output, status: 'passed' }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
