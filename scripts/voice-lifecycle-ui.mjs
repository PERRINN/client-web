// Real voice components and Web Audio, synthetic microphone, no Firebase calls.
// Set PLAYWRIGHT_MODULE to a Playwright installation if it is not on Node's path.
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
const output = await mkdtemp(resolve(tmpdir(), 'perrinn-voice-lifecycle-'));
await writeFile(output + '/entry.ts', `
import 'zone.js'; import '@angular/compiler';
import {Component,NO_ERRORS_SCHEMA,inject,ChangeDetectorRef,provideZoneChangeDetection} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {BrowserDynamicTestingModule,platformBrowserDynamicTesting} from '@angular/platform-browser-dynamic/testing';
import {CommonModule} from '@angular/common';
import {BehaviorSubject,Subject} from 'rxjs';
import {VoiceInputComponent} from '${root}/src/app/prototypes/voice-input/voice-input.component';
import {VoiceInputService} from '${root}/src/app/prototypes/voice-input/voiceInput.service';
import {VoiceCaptureService} from '${root}/src/app/prototypes/voice-input/voiceCapture.service';
import {VoicePlaybackService} from '${root}/src/app/prototypes/voice-input/voicePlayback.service';
import {VoiceAudioSessionService} from '${root}/src/app/prototypes/voice-input/voiceAudioSession.service';
import {UserAvatarComponent} from '${root}/src/app/user-avatar.component';
const audio=new VoiceAudioSessionService(),capture=new VoiceCaptureService(audio),tracks=[],submitted=[];
let remoteCalls=0,micRequests=0;
navigator.mediaDevices.getUserMedia=async()=>{
 micRequests++;const driver=new AudioContext({sampleRate:16000}),tone=driver.createOscillator(),sink=driver.createMediaStreamDestination();
 tone.frequency.value=220;tone.connect(sink);tone.start();await driver.resume();
 const track=sink.stream.getAudioTracks()[0],stop=track.stop.bind(track);let stopped=false;
 track.stop=()=>{if(stopped)return;stopped=true;stop();tone.stop();void driver.close();};tracks.push(track);return sink.stream;
};
const queue={items:[],changed:new Subject(),completed:new Subject(),ready:true,canRecord:true,
 start(){},enqueue:async bytes=>{submitted.push(bytes.length);},diagnostics:{ready:true,total:0,unsent:0,unsaved:false,
 received:0,storageError:false,storageRetries:0,resultRetries:0,listeners:0,confirmedResults:0,resultFailures:0}};
const voice=new VoiceInputService({authState:new BehaviorSubject({uid:'synthetic'})} as any,queue as any,capture,{run:fn=>fn()} as any);
const conversation={allowed:true,ready:true,uid:'synthetic',messages:[],changed:new Subject(),incoming:new Subject()};
const playback=new VoicePlaybackService({httpsCallable(){remoteCalls++;throw Error('Unexpected remote call');}} as any,{} as any,conversation as any,voice,audio);
@Component({standalone:false,templateUrl:'${root}/src/app/prototypes/voice-input/voice-input.component.html',styleUrls:['${root}/src/app/prototypes/voice-input/voice-input.component.css']})
class Area extends VoiceInputComponent {constructor(){super({} as any,playback,voice,conversation as any,inject(ChangeDetectorRef));}}
TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());
TestBed.configureTestingModule({imports:[CommonModule],declarations:[Area,UserAvatarComponent],schemas:[NO_ERRORS_SCHEMA],providers:[provideZoneChangeDetection()]});
const fixture=TestBed.createComponent(Area);document.body.append(fixture.nativeElement);fixture.autoDetectChanges();fixture.detectChanges();
window.voiceHarness={
 leave(){fixture.componentInstance.pageHide();},returned(){fixture.componentInstance.pageShow();},
 async suspend(){await audio.current?.suspend();},
 async stop(){await voice.release();fixture.detectChanges();},
 flush(){fixture.componentInstance.diagnosticUpdatedAt=0;(fixture.componentInstance as any).updateDiagnostics();fixture.detectChanges();},
 stats(){return{phase:voice.phase,context:audio.current?.state||'released',live:tracks.filter(track=>track.readyState==='live').length,micRequests,remoteCalls,submitted,trace:audio.diagnosticRows.find(row=>row.label==='Session trace').value};},
 destroy(){fixture.destroy();playback.ngOnDestroy();voice.ngOnDestroy();capture.ngOnDestroy();audio.ngOnDestroy();}
};
`);
await build({ entryPoints: [output + '/entry.ts'], outfile: output + '/bundle.js', bundle: true, platform: 'browser', format: 'iife', nodePaths: [root + '/node_modules'], tsconfigRaw: { compilerOptions: { experimentalDecorators: true } }, logLevel: 'silent', plugins: [{ name: 'angular-resources', setup(plugin) {
  plugin.onLoad({ filter: /\.component\.ts$|entry\.ts$/ }, async args => {
    let source = await readFile(args.path, 'utf8');
    const template = /templateUrl:\s*'([^']+)'/.exec(source), style = /styleUrls:\s*\[([^\]]+)\]/.exec(source);
    if (template) source = source.replace(template[0], 'template: ' + JSON.stringify(await readFile(resolve(dirname(args.path), template[1]), 'utf8')));
    if (style) source = source.replace(style[0], 'styles: ' + JSON.stringify(await Promise.all([...style[1].matchAll(/'([^']+)'/g)].map(([, name]) => readFile(resolve(dirname(args.path), name), 'utf8')))));
    return { contents: source, loader: 'ts', resolveDir: dirname(args.path) };
  });
} }] });
const globalStyles = await readFile(root + '/src/styles.css', 'utf8');
const server = createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  const file = path === '/bundle.js' ? output + '/bundle.js' : path === '/assets/voice-input/capture.worklet.js' ? root + '/src/assets/voice-input/capture.worklet.js' : null;
  if (path.startsWith('/assets/') && !file) { res.writeHead(204); res.end(); return; }
  res.setHeader('Content-Type', file ? 'text/javascript' : 'text/html');
  res.end(file ? await readFile(file) : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + globalStyles + '\nhtml,body{margin:0;height:100%;width:100%}body>ng-component{display:block;height:100%}</style></head><body><script src="/bundle.js"></script></body></html>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage(), errors = [];
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  const origin = 'http://127.0.0.1:' + server.address().port;
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 850 }); await page.goto(origin);
    await page.waitForFunction(() => !!window.voiceHarness);
    const dock = page.locator('.voice-dock'), frame = await page.locator('.voice-page').boundingBox(), dockBox = await dock.boundingBox();
    await page.getByRole('button', { name: 'Open diagnostics', exact: true }).click();
    await page.evaluate(() => window.voiceHarness.flush());
    await page.locator('[data-state="Session trace"]').waitFor();
    assert.deepEqual(await page.locator('.voice-page').boundingBox(), frame);
    assert.deepEqual(await dock.boundingBox(), dockBox);
    await page.screenshot({ path: output + '/diagnostics-' + width + '.png' });
    await page.getByRole('button', { name: 'Close diagnostics', exact: true }).click();
    // Leave an activated playback context suspended, then exercise the real page lifecycle.
    await page.evaluate(async () => { await window.voiceHarness.suspend(); window.voiceHarness.leave(); window.voiceHarness.returned(); });
    assert.equal((await page.evaluate(() => window.voiceHarness.stats())).context, 'released');
    await dock.click(); await page.waitForFunction(() => window.voiceHarness.stats().phase === 'recording');
    await page.waitForFunction(() => document.querySelector('.voice-dock.recording .waveform i[style]') && [...document.querySelectorAll('.voice-dock.recording .waveform i')].some(bar => parseFloat(bar.style.height) > 4));
    await page.waitForTimeout(500); await page.evaluate(() => window.voiceHarness.stop());
    let stats = await page.evaluate(() => window.voiceHarness.stats());
    assert.equal(stats.live, 0); assert.equal(stats.submitted.length, 1); assert.ok(stats.submitted[0] > 12844);
    await dock.click(); await page.waitForFunction(() => window.voiceHarness.stats().phase === 'recording');
    await page.evaluate(() => { window.voiceHarness.leave(); window.voiceHarness.returned(); });
    stats = await page.evaluate(() => window.voiceHarness.stats());
    assert.equal(stats.live, 0); assert.equal(stats.phase, 'idle'); assert.equal(stats.submitted.length, 1);
    assert.equal(stats.remoteCalls, 0); assert.equal(stats.micRequests, 2);
    await page.getByRole('button', { name: 'Open diagnostics', exact: true }).click(); await page.evaluate(() => window.voiceHarness.flush());
    assert.deepEqual(await page.locator('.voice-page').boundingBox(), frame); assert.deepEqual(await dock.boundingBox(), dockBox);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: output + '/returned-' + width + '.png' });
    await page.getByRole('button', { name: 'Close diagnostics', exact: true }).click();
    assert.deepEqual(await dock.boundingBox(), dockBox);
    await page.evaluate(() => window.voiceHarness.destroy());
    console.log(width + 'px: context recovery, recording, interrupted capture, stable diagnostics; zero remote calls');
  }
  assert.deepEqual(errors, []); console.log('Screenshots: ' + output);
} finally { await browser.close(); await new Promise(done => server.close(done)); }
