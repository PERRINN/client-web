// Real article, Apps and shell templates; mocked account/sidebar services, no Firebase initialization.
// Run with node scripts/greenpower/launch-preview.mjs; inspect http://127.0.0.1:4318 in a browser.
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, dirname, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';

const root = process.cwd();
const output = await mkdtemp(resolve(tmpdir(), 'greenpower-launch-preview-'));
await writeFile(output + '/entry.ts', `
import 'zone.js'; import '@angular/compiler';
import { Component, NO_ERRORS_SCHEMA, Inject, ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { Router, RouterModule } from '@angular/router';
import { CommonModule, DOCUMENT, PlatformLocation, BrowserPlatformLocation } from '@angular/common';
import { Title, Meta, By } from '@angular/platform-browser';
import { SwUpdate } from '@angular/service-worker';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { BehaviorSubject, Subject, of, Subscription } from 'rxjs';
import { AppComponent } from '${root}/src/app/app.component';
import { AppsComponent } from '${root}/src/app/apps.component';
import { PrototypeGalleryComponent } from '${root}/src/app/prototypes/prototype-gallery.component';
import { GreenpowerLaunchComponent } from '${root}/src/app/greenpower-launch/greenpower-launch.component';
import { GreenpowerPhotoComponent } from '${root}/src/app/greenpower-launch/greenpower-photo.component';
import { UserInterfaceService } from '${root}/src/app/userInterface.service';
import { PresenceService } from '${root}/src/app/presence.service';
import { MessageActivityService } from '${root}/src/app/messageActivity.service';
import { SidebarConversationsService } from '${root}/src/app/sidebarConversations.service';
import { RadioLifecycleService } from '${root}/src/app/prototypes/team-radio/radioLifecycle.service';
import { GreenpowerLiveService } from '${root}/src/app/greenpower-telemetry/greenpowerLive.service';
@Component({standalone:false, template:'<a routerLink="/apps">Apps</a><h1>Destination {{label}}</h1>'})
class Destination { label=''; }
const live = new BehaviorSubject(false), radio = {changed:new Subject(), returnLabel:''};
AppComponent.ctorParameters=()=>[Router,AngularFirestore,UserInterfaceService,SwUpdate,PresenceService,MessageActivityService,SidebarConversationsService,RadioLifecycleService,GreenpowerLiveService,ChangeDetectorRef].map(type=>({type}));
AppsComponent.ctorParameters=()=>[{type:UserInterfaceService}];
GreenpowerLaunchComponent.ctorParameters=()=>[{type:Title},{type:Meta},{type:undefined,decorators:[{type:Inject,args:[DOCUMENT]}]}];
TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());
TestBed.configureTestingModule({declarations:[AppComponent,AppsComponent,PrototypeGalleryComponent,GreenpowerLaunchComponent,GreenpowerPhotoComponent,Destination],
 imports:[CommonModule,RouterModule.forRoot([
 {path:'apps',component:AppsComponent},
 {path:'prototypes',component:PrototypeGalleryComponent},
 {path:'prototypes/team-radio',component:Destination},
 {path:'424-greenpower-2027',component:GreenpowerLaunchComponent,data:{editorial:true}},
 {path:'424-greenpower-telemetry',component:Destination},
 {path:'chat/:id',component:Destination},
 {path:'**',redirectTo:'apps'}])], schemas:[NO_ERRORS_SCHEMA], providers:[
 {provide:PlatformLocation,useClass:BrowserPlatformLocation},
 {provide:UserInterfaceService,useValue:{currentUser:null,convertAndFormatPRNToPRNCurrency:()=>''}},
 {provide:AngularFirestore,useValue:{}}, {provide:SwUpdate,useValue:{isEnabled:false}},
 {provide:PresenceService,useValue:{trackActivity:()=>new Subscription()}},
 {provide:MessageActivityService,useValue:{summary:()=>of({})}},
 {provide:SidebarConversationsService,useValue:{automatic:()=>of([])}},
 {provide:RadioLifecycleService,useValue:radio}, {provide:GreenpowerLiveService,useValue:{live$:live}}]});
const fixture=TestBed.createComponent(AppComponent);document.body.append(fixture.nativeElement);fixture.autoDetectChanges();
TestBed.inject(Router).initialNavigation();
const toggle=document.createElement('button');toggle.textContent='Toggle test activity';toggle.id='test-activity';toggle.style.cssText='position:fixed;right:0;bottom:0;z-index:20000';
toggle.onclick=()=>{live.next(!live.value);radio.returnLabel=live.value?'Radio · 2m':'';radio.changed.next();fixture.detectChanges();};if(new URLSearchParams(location.search).has('qa')) {
  document.body.append(toggle);
  let originalPhoto;
  const fail=document.createElement('button');fail.id='test-image';fail.textContent='Toggle test image failure';fail.style.cssText='position:fixed;right:0;bottom:36px;z-index:20000';
  fail.onclick=()=>{const article=fixture.debugElement.query(By.directive(GreenpowerLaunchComponent))?.componentInstance;if(!article){const apps=fixture.debugElement.query(By.directive(AppsComponent))?.componentInstance;if(apps){apps.greenpowerImageFailed=!apps.greenpowerImageFailed;fixture.debugElement.query(By.directive(AppsComponent)).injector.get(ChangeDetectorRef).detectChanges();}return;}if(originalPhoto){article.photos.racing=originalPhoto;originalPhoto=undefined;}else{originalPhoto=article.photos.racing;article.photos.racing={...originalPhoto,name:'missing-image'};}fixture.detectChanges();};document.body.append(fail);
  const drive=document.createElement('button');drive.textContent='Toggle test Drive';drive.style.cssText='position:fixed;right:0;bottom:72px;z-index:20000';drive.onclick=()=>{const ui=TestBed.inject(UserInterfaceService);ui.PERRINNProfileLastMessageObj=ui.PERRINNProfileLastMessageObj?null:{publicLink:'https://drive.google.com/drive/folders/preview-only'};fixture.debugElement.query(By.directive(AppsComponent))?.injector.get(ChangeDetectorRef).detectChanges();};document.body.append(drive);
}
`);
await build({entryPoints:[output+'/entry.ts'],outfile:output+'/bundle.js',bundle:true,platform:'browser',format:'iife',nodePaths:[root+'/node_modules'],tsconfigRaw:{compilerOptions:{experimentalDecorators:true}},plugins:[{name:'angular-resources',setup(plugin){
  plugin.onLoad({filter:/\.component\.ts$/},async args=>{
    let source=await readFile(args.path,'utf8');
    const template=/templateUrl:\s*'([^']+)'/.exec(source),style=/styleUrls:\s*\[([^\]]+)\]/.exec(source);
    if(template)source=source.replace(template[0],'template: '+JSON.stringify(await readFile(resolve(dirname(args.path),template[1]),'utf8')));
    if(style)source=source.replace(style[0],'styles: '+JSON.stringify(await Promise.all([...style[1].matchAll(/'([^']+)'/g)].map(([,name])=>readFile(resolve(dirname(args.path),name),'utf8')))));
    return{contents:source,loader:'ts',resolveDir:dirname(args.path)};
  });
}}]});
const fontLinks=(await readFile(root+'/src/index.html','utf8')).match(/<link[^>]+(?:fonts.googleapis.com)[^>]+>/g)?.join('') || '';
const html=`<!doctype html><html><head><base href="/"><meta name="viewport" content="width=device-width,initial-scale=1">${fontLinks}<title>PERRINN preview</title><meta name="description" content="Previous description"><style>${await readFile(root+'/src/styles.css','utf8')}</style></head><body><script src="/bundle.js"></script></body></html>`;
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  try {
    if(path==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(output+'/bundle.js'));}
    else if(path.startsWith('/assets/')){
      const file=resolve(root+'/src', '.'+decodeURIComponent(path));
      if(!file.startsWith(root+'/src/assets/')){res.writeHead(403);res.end();return;}
      res.setHeader('Content-Type',extname(file)==='.webp'?'image/webp':'application/octet-stream');res.end(await readFile(file));
    }else{res.setHeader('Content-Type','text/html');res.end(html);}
  }catch{res.writeHead(404);res.end();}
});
server.listen(4318,'127.0.0.1',()=>console.log('Greenpower article preview: http://127.0.0.1:4318/apps (mock services; no Firebase reads)'));
