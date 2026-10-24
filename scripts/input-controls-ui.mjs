// Production field CSS audit with synthetic controls; no network or Firebase.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const read=path=>readFileSync(new URL('../src/'+path,import.meta.url),'utf8');
const select='<select aria-label="Choice"><option>British Pound Sterling</option><option>Euro</option></select>';
const cases=[
 ['Settings','settings.component.css','<input aria-label="Name"><textarea aria-label="Presentation"></textarea>'+select],
 ['Sign in/register','login.component.css','<div class="authForm"><label class="fieldLabel"><input class="fieldInput" type="email" aria-label="Email"></label><label class="fieldLabel"><input class="fieldInput" type="password" aria-label="Password"></label></div>'],
 ['Team','team.component.css','<div class="search-control"><input type="search" aria-label="Search"></div>'],
 ['Chat details','chat/chat.component.css','<div class="details-editor"><input aria-label="Subject"></div>'],
 ['Chat event','chat/chat-event/chat-event-editor.component.css','<input type="date" aria-label="Date"><input type="time" aria-label="Time"><textarea aria-label="Description"></textarea>'+select],
 ['Chat fund','chat/chat-fund/chat-fund-editor.component.css','<input type="number" aria-label="Target"><textarea aria-label="Description"></textarea>'],
 ['Chat PRN manager','chat/prn-send-manager/prn-send-manager.component.css','<input aria-label="Reference">'+select],
 ['Nürburgring telemetry','telemetry/telemetry.component.css','<div class="pairing-field"><input type="password" aria-label="Token"></div><div class="setup-cell">'+select+'<label class="amount-field"><input type="number" aria-label="Adjustment"><span>m</span></label></div>'],
 ['Greenpower track','greenpower-telemetry/greenpower-map.component.css','<input aria-label="Track name">'],
 ['Greenpower metadata','greenpower-telemetry/greenpower-metadata-fields.component.css','<label>Event name<input aria-label="Event name"></label><input type="number" aria-label="Ratio">'+select],
 ['Greenpower history','greenpower-telemetry/greenpower-event-selector.component.css','<span class="select-shell">'+select+'<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></span>'],
 ['Greenpower overlays','greenpower-telemetry/greenpower-overlay.component.css',select],
 ['Greenpower track selection','greenpower-telemetry/greenpower-telemetry.component.css','<div class="track-selection">'+select+'</div>'],
 ['Greenpower event editor','greenpower-telemetry/greenpower-event-editor.component.css',select],
 ['Greenpower marker','greenpower-telemetry/greenpower-channel-option.component.css','<input class="marker-value" type="number" aria-label="Marker value">']
];
const root=resolve(import.meta.dirname,'..'),output=await mkdtemp(resolve(tmpdir(),'perrinn-inputs-ui-'));
const entries=cases.map(([name,path,html])=>({name,html: name==='Nürburgring telemetry'?'<div class="live-link">'+html+'</div>':html,css:read('app/'+path)}));
await writeFile(output+'/entry.ts', `
import 'zone.js';import '@angular/compiler';
import {Component,provideZoneChangeDetection} from '@angular/core';import {TestBed} from '@angular/core/testing';
import {BrowserDynamicTestingModule,platformBrowserDynamicTesting} from '@angular/platform-browser-dynamic/testing';
const entries=${JSON.stringify(entries)},types=entries.map((entry,i)=>Component({selector:'field-audit-'+i,standalone:false,template:entry.html,styles:[entry.css,':host{display:block!important;width:calc(100% - 32px);max-width:450px;padding:16px;margin:16px;overflow:visible!important;height:auto!important;background:var(--color-surface)}:host>input,:host>select,:host>textarea{margin-bottom:12px}']})(class{}));
TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());TestBed.configureTestingModule({declarations:types,providers:[provideZoneChangeDetection()]});
let fixture;window.fieldUI={select(i){fixture?.destroy();fixture=TestBed.createComponent(types[i]);document.querySelector('#fields').replaceChildren(fixture.nativeElement);fixture.detectChanges();}};
`);
await build({entryPoints:[output+'/entry.ts'],outfile:output+'/bundle.js',bundle:true,platform:'browser',format:'iife',nodePaths:[root+'/node_modules'],logLevel:'silent'});
const server=createServer(async(req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?await readFile(output+'/bundle.js'):'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+read('styles.css')+'</style><div id="fields"></div><script src="/bundle.js"></script>');});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'}),checks=[];
try{
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:{width:mobile?390:1440,height:900},isMobile:mobile,hasTouch:mobile});
  const page=await context.newPage();await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());await page.goto(origin);await page.waitForFunction(()=>!!window.fieldUI);
  for(const [name,style,html]of cases){
   await page.evaluate(i=>window.fieldUI.select(i),cases.findIndex(entry=>entry[0]===name));
   for(const field of await page.locator('input,textarea,select').all()){
    const initial=await field.boundingBox();
    const skin=await field.evaluate(el=>{const s=getComputedStyle(el);return{border:s.borderTopColor,borderWidth:parseFloat(s.borderTopWidth),bg:s.backgroundColor,font:parseFloat(s.fontSize),clipped:el.scrollWidth>el.clientWidth,arrow:s.backgroundImage,padding:parseFloat(s.paddingInlineEnd),size:s.backgroundSize,position:s.backgroundPosition,appearance:s.appearance};});
    assert.ok(skin.border==='rgba(0, 0, 0, 0)'||skin.borderWidth===0,name+' idle edge');assert.equal(skin.clipped,false,name+' overflow');
    if(mobile)assert.ok(skin.font>=16,name+' mobile entry size: '+skin.font);
    if(await field.evaluate(el=>el.tagName==='SELECT')){
     assert.ok(initial.height>=44,name+' target');
     if(!mobile){assert.match(skin.arrow,/svg/);assert.ok(skin.padding>=46,name+' arrow clearance');assert.equal(skin.size,'20px 20px');assert.match(skin.position,/14px/);}
     else {assert.equal(skin.arrow,'none',name+' keeps mobile control');}
     if(name==='Greenpower history'&&!mobile)assert.equal(await page.locator('.select-shell svg').isVisible(),false,'one chevron');
    }
    await field.focus();const focused=await field.evaluate(el=>{const s=getComputedStyle(el);return{bg:s.backgroundColor,outline:s.outlineStyle,width:parseFloat(s.outlineWidth),parent:getComputedStyle(el.parentElement).backgroundColor,parentOutline:getComputedStyle(el.parentElement).outlineStyle};});
    assert.ok(focused.bg==='rgb(52, 69, 82)'||focused.parent==='rgb(52, 69, 82)',name+' editing fill '+JSON.stringify(focused));
    assert.ok(focused.outline==='solid'||focused.parentOutline==='solid',name+' visible focus');assert.deepEqual(await field.boundingBox(),initial,name+' stable focus geometry');
    await field.evaluate(el=>el.disabled=true);assert.deepEqual(await field.boundingBox(),initial,name+' stable disabled geometry');
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' page width');checks.push(name+(mobile?' mobile':' desktop'));
   if(name==='Settings')await page.screenshot({path:'/tmp/perrinn-fields-'+(mobile?'mobile':'desktop')+'.png'});
  }
  await context.close();
 }
 console.log(JSON.stringify({checks,assertions:['borderless shared skin','editing fill','keyboard focus','stable geometry','mobile text size','desktop chevron size/inset/clearance','native mobile selectors','no duplicate arrows']}));
}finally{await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
