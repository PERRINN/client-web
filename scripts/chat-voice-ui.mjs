// Real Angular production templates with synthetic state; never contacts Firebase or a microphone.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(import.meta.dirname, '..'), output = await mkdtemp(resolve(tmpdir(), 'perrinn-chat-voice-'));
const template = await readFile(root + '/src/app/chat/chat.component.html', 'utf8'), styles = await readFile(root + '/src/app/chat/chat.component.css', 'utf8');
await writeFile(output + '/entry.ts', `
import 'zone.js'; import '@angular/compiler';
import {Component,Pipe,NgZone,ChangeDetectorRef,NO_ERRORS_SCHEMA,provideZoneChangeDetection} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {BrowserDynamicTestingModule,platformBrowserDynamicTesting} from '@angular/platform-browser-dynamic/testing';
import {CommonModule} from '@angular/common'; import {FormsModule} from '@angular/forms'; import {EMPTY,Subject} from 'rxjs';
import {ChatComponent} from '${root}/src/app/chat/chat.component';
import {ChatComposerComponent} from '${root}/src/app/chat/chat-composer/chat-composer.component';
import {VoiceComposerComponent} from '${root}/src/app/voice/voice-composer/voice-composer.component';
import {ChatMessageComponent} from '${root}/src/app/chat/chat-message/chat-message.component';
import {ChatVoiceMessageComponent} from '${root}/src/app/chat/chat-voice-message/chat-voice-message.component';
import {ChatInputSettingsComponent} from '${root}/src/app/chat/chat-input-settings/chat-input-settings.component';
import {ChatDataService} from '${root}/src/app/chat/chatData.service';
import {ChatVoiceService} from '${root}/src/app/chat/chatVoice.service';
import {VoiceInputService} from '${root}/src/app/voice/voiceInput.service';
import {PermissionsService} from '${root}/src/app/permissions.service';
import {UserAvatarComponent} from '${root}/src/app/user-avatar.component';
let failSave=false,requests=[],plays=[];
const input:any={changed:new Subject(),phase:'idle',uid:'alice',ready:true,levels:Array(9).fill(.25),replies:[],queue:{storageError:''},pendingCount:0,
 get busy(){return ['requesting','recording','sending'].includes(this.phase)},get canRecord(){return !this.busy},get canToggle(){return this.canRecord||this.phase==='recording'||this.phase==='requesting'},get waiting(){return false},get label(){return this.phase==='recording'?'Stop recording':'Start recording'},
 press(){this.phase='recording'},release(){this.phase='idle'},cancel(){this.phase='idle'}};
const voice:any={changed:new Subject(),mode:'text',keyboard:false,canListen:true,loading:'',active:'',error:'',input,configure(){},unlock(){},useKeyboard(){input.cancel();this.keyboard=true},useVoice(){this.keyboard=false},
 available(m){return this.canListen&&m.voice.expiresAt>Date.now()},toggle(m){plays.push(m.id);this.active=this.active===m.id?'':m.id}};
const permissions={current:{ready:true,isAdmin:true,uid:'alice'}};
const data={viewerName:'Alice',fundCurrency:{code:'gbp',perGBP:1},async updateInputMode(chain,mode){requests.push({chain,mode});if(failSave)throw Error('Offline');voice.mode=mode;},timeCreditAmount(){return ''}};
@Pipe({name:'linky',standalone:false})class Linky {transform(value){return value}}
@Component({standalone:false,template:${JSON.stringify(template)},styles:[${JSON.stringify(styles)}]})
class Area extends ChatComponent {
 constructor(){super({paramMap:EMPTY} as any,{} as any,data as any,{} as any,{run:fn=>fn()} as any,{error:'',attach(){},scan(){}} as any,{} as any,voice);
 this.chain='engineering';this.title='Engineering';this.signedIn=true;this.state='ready';this.members=[{id:'alice',name:'Alice',avatarName:'Alice',avatar:''}];
 this.messages=[{id:'voice',user:'bob',author:'Bob',avatarName:'Bob',avatarSources:[],text:'A full voice transcription. '.repeat(30),timestamp:Date.now(),own:false,verified:true,image:'',originalImage:'',imageName:'',voice:{eventId:'recording',durationMs:30000,expiresAt:Date.now()+60000,transcription:'completed'}}];}
}
// esbuild does not emit Angular ctor metadata; supply the production dependency tokens for this JIT harness.
(VoiceComposerComponent as any).ctorParameters=()=>[{type:VoiceInputService},{type:ChangeDetectorRef}];
(ChatVoiceMessageComponent as any).ctorParameters=()=>[{type:ChatVoiceService},{type:ChangeDetectorRef}];
(ChatInputSettingsComponent as any).ctorParameters=()=>[{type:PermissionsService},{type:ChatDataService},{type:NgZone}];
TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());
TestBed.configureTestingModule({imports:[CommonModule,FormsModule],declarations:[Area,ChatComposerComponent,VoiceComposerComponent,ChatMessageComponent,ChatVoiceMessageComponent,ChatInputSettingsComponent,UserAvatarComponent,Linky],schemas:[NO_ERRORS_SCHEMA],providers:[provideZoneChangeDetection(),{provide:ChatVoiceService,useValue:voice},{provide:VoiceInputService,useValue:input},{provide:ChatDataService,useValue:data},{provide:PermissionsService,useValue:permissions}]});
const fixture=TestBed.createComponent(Area);document.body.append(fixture.nativeElement);fixture.autoDetectChanges();fixture.detectChanges();
window.voiceUI={own(value){fixture.componentInstance.messages[0]={...fixture.componentInstance.messages[0],own:value};fixture.detectChanges()},state(value){fixture.componentInstance.state=value;fixture.detectChanges()},mode(value){voice.mode=value;fixture.detectChanges()},recipient(value){voice.canListen=value;fixture.detectChanges()},admin(value){permissions.current.isAdmin=value;fixture.detectChanges()},fail(value){failSave=value},error(){input.phase='error';input.replies=[{kind:'error',text:'Microphone access denied.'}];fixture.detectChanges()},quota(){input.phase='idle';input.replies=[{kind:'pending',text:'Daily limit reached. Saved until 00:00 UTC.',recording:{conversationId:'chat:engineering',error:'Daily limit reached. Saved until 00:00 UTC.'}}];fixture.detectChanges()},pending(){input.phase='idle';input.replies=[];input.pendingCount=2;fixture.detectChanges()},expired(){fixture.componentInstance.messages[0].voice.expiresAt=1;fixture.detectChanges()},audioOnly(){fixture.componentInstance.messages[0]={...fixture.componentInstance.messages[0],text:'',voice:{...fixture.componentInstance.messages[0].voice,transcription:'unavailable'}};fixture.detectChanges()},requests(){return requests},plays(){return plays},playback(state){voice.loading=state==='loading'?'voice':'';voice.active=state==='playing'?'voice':'';voice.errorId=state==='error'?'voice':'';voice.error=state==='error'?'Recording unavailable. Tap to try again.':'';fixture.detectChanges()},flush(){fixture.detectChanges()}};
`);
await build({ entryPoints: [output + '/entry.ts'], outfile: output + '/bundle.js', bundle: true, platform: 'browser', format: 'iife', nodePaths: [root + '/node_modules'], tsconfigRaw: { compilerOptions: { experimentalDecorators: true } }, logLevel: 'silent', plugins: [{ name: 'angular-resources', setup(plugin) {
  plugin.onLoad({ filter: /\.component\.ts$/ }, async args => {
    let source = await readFile(args.path, 'utf8');
    const template = /templateUrl:\s*'([^']+)'/.exec(source), style = /styleUrls:\s*\[([^\]]+)\]/.exec(source);
    if (template) source = source.replace(template[0], 'template: ' + JSON.stringify(await readFile(resolve(dirname(args.path), template[1]), 'utf8')));
    if (style) source = source.replace(style[0], 'styles: ' + JSON.stringify(await Promise.all([...style[1].matchAll(/'([^']+)'/g)].map(([, name]) => readFile(resolve(dirname(args.path), name), 'utf8')))));
    return { contents: source, loader: 'ts', resolveDir: dirname(args.path) };
  });
} }] });
const globalStyles = await readFile(root + '/src/styles.css', 'utf8');
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/bundle.js' ? await readFile(output + '/bundle.js') : `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${globalStyles}\nhtml,body{margin:0;width:100%;height:100%}body>ng-component{display:block;height:100%}</style></head><body><script src="/bundle.js"></script></body></html>`); });
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
try {
  const page = await browser.newPage(), errors = []; page.setDefaultTimeout(10000); page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 850 }); await page.goto(origin); await page.locator('textarea').waitFor();
    const frame = await page.locator('.chat-frame').boundingBox(), composer = await page.locator('.composer-area').boundingBox();
    const stable = async () => { assert.deepEqual(await page.locator('.chat-frame').boundingBox(), frame); assert.deepEqual(await page.locator('.composer-area').boundingBox(), composer); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); };
    await page.locator('textarea').fill('Unsent draft'); await page.evaluate(() => window.voiceUI.mode('voice')); await page.getByRole('button', { name: 'Use keyboard' }).waitFor(); await stable();
    assert.equal(await page.locator('.waveform').count(), 0);
    const mic = await page.locator('.mic svg').boundingBox(), pill = await page.locator('.voice-composer').boundingBox();
    assert.ok(Math.abs(mic.x + mic.width / 2 - pill.x - pill.width / 2) < 1);
    assert.equal(await page.locator('.talk-logo').count(), 0);
    await page.screenshot({path:output+'/chat-voice-composer-'+width+'.png'});
    await page.getByRole('button', { name: /Start recording/ }).click(); await page.getByRole('button', { name: /Stop recording/ }).waitFor(); await stable();
    assert.equal(await page.locator('.waveform i').count(), 9);
    assert.equal(await page.locator('.waveform').evaluate(node => getComputedStyle(node).flexDirection), 'row');
    const dock = await page.locator('.voice-dock').boundingBox(), wave = await page.locator('.waveform').boundingBox();
    assert.ok(wave.x - dock.x < 12);
    const recordingMic = await page.locator('.mic svg').boundingBox(); assert.deepEqual(recordingMic, mic);
    await page.screenshot({path:output+'/chat-voice-recording-'+width+'.png'});
    await page.getByRole('button', { name: /Stop recording/ }).click(); assert.equal(await page.locator('.waveform').count(), 0); await page.evaluate(() => window.voiceUI.error()); await page.getByText('Microphone access denied.', { exact: true }).first().waitFor(); await stable();
    await page.evaluate(() => window.voiceUI.quota()); await page.getByText('Daily limit reached. Saved until 00:00 UTC.',{exact:true}).first().waitFor(); await stable();
    await page.evaluate(() => window.voiceUI.pending()); await page.getByText('2 processing', {exact:true}).waitFor(); assert.equal(await page.locator('.waveform').count(), 0); await stable();
    await page.getByRole('button', { name: 'Use keyboard' }).click(); await page.locator('textarea').waitFor(); assert.equal(await page.locator('textarea').inputValue(),'Unsent draft'); await page.locator('textarea').fill(''); await stable();
    await page.getByRole('button', { name: 'Use voice', exact: true }).click(); await page.getByRole('button', { name: 'Use keyboard' }).waitFor(); await stable();
    await page.getByRole('button', { name: 'Play voice recording' }).click(); assert.deepEqual(await page.evaluate(() => window.voiceUI.plays()), ['voice']);
    const recording = page.locator('app-chat-voice-message button');
    assert.equal(await recording.innerText(), 'Voice · 30s');
    const recordingBounds = await recording.boundingBox();
    assert.equal(recordingBounds.height,28);
    assert.equal(await recording.evaluate(node => getComputedStyle(node,'::after').top),'-8px');
    for (const state of ['loading', 'playing', 'error', 'idle']) {
      await page.evaluate(value => window.voiceUI.playback(value), state);
      assert.deepEqual(await recording.boundingBox(), recordingBounds); await stable();
      if (state === 'loading') assert.equal(await recording.getAttribute('aria-busy'), 'true');
      if (state === 'playing') assert.equal(await recording.getAttribute('aria-pressed'), 'true');
      await page.screenshot({path:output+'/chat-voice-playback-'+state+'-'+width+'.png'});
    }
    await page.evaluate(() => window.voiceUI.own(true));
    const ownBounds=await recording.boundingBox();
    assert.equal(ownBounds.height,28);
    for(const state of ['idle','loading','playing','error']) {
      await page.evaluate(value=>window.voiceUI.playback(value),state);
      assert.deepEqual(await recording.boundingBox(),ownBounds);await stable();
      const appearance=await recording.evaluate(node=>({background:getComputedStyle(node).backgroundColor,bubble:getComputedStyle(node.closest('.message-content')).backgroundColor,border:getComputedStyle(node).borderTopWidth}));
      assert.notEqual(appearance.background,appearance.bubble);assert.equal(appearance.border,'0px');
      await page.screenshot({path:output+'/chat-voice-own-'+state+'-'+width+'.png'});
    }
    await page.evaluate(() => {window.voiceUI.own(false);window.voiceUI.playback('idle')});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(() => window.voiceUI.playback('loading'));
    assert.equal(await page.locator('.feedback').evaluate(node => getComputedStyle(node).animationName), 'none');
    await page.evaluate(() => window.voiceUI.playback('idle')); await page.emulateMedia({reducedMotion:'no-preference'});
    assert.equal(await page.getByRole('button', {name:/Download/}).count(),0);
    await page.evaluate(() => window.voiceUI.recipient(false)); assert.equal(await recording.count(), 0); await page.getByText('Voice · 30s', { exact: true }).waitFor(); await stable();
    await page.evaluate(() => { window.voiceUI.recipient(true); window.voiceUI.audioOnly(); }); await page.getByText('Transcription unavailable').waitFor(); await stable();
    await page.evaluate(() => window.voiceUI.expired()); assert.equal(await page.getByRole('button', { name: 'Play voice recording' }).isDisabled(), true);
    await page.getByRole('button', { name: 'Chat details: Engineering' }).click(); await page.getByRole('switch').waitFor();
    await page.evaluate(() => window.voiceUI.fail(true)); await page.getByRole('switch').click(); await page.evaluate(()=>new Promise(requestAnimationFrame)); await page.getByRole('alert').filter({ hasText: 'Input mode couldn’t save' }).waitFor();
    await page.evaluate(() => window.voiceUI.fail(false)); await page.getByRole('switch').click(); await page.waitForFunction(() => document.querySelector('[role=switch]')?.getAttribute('aria-checked') === 'false');
    await page.evaluate(() => window.voiceUI.admin(false)); assert.equal(await page.getByRole('switch').count(), 0);
    await page.getByRole('button', { name: 'Close chat details' }).click(); await stable();
    for (const state of ['loading', 'error', 'empty', 'ready']) { await page.evaluate(value => window.voiceUI.state(value), state); await stable(); }
    await page.screenshot({ path: output + '/chat-voice-' + width + '.png' });
  }
  assert.deepEqual(errors, []); console.log(JSON.stringify({ output, widths: [1440, 390, 320], checks: ['text/voice/keyboard stable geometry', 'recording and error states', 'pending', 'long transcript', 'audio-only', 'recipient-only 28px pill with 44px touch area', 'loading/playing/error stable feedback', 'reduced motion', 'expiry', 'admin toggle failure/retry/role loss', 'loading/error/empty', 'no overflow'], errors }));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
