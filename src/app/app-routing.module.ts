import { GreenpowerDashboardComponent } from './greenpower-dashboard/greenpower-dashboard.component';
import { GreenpowerTelemetryComponent } from './greenpower-telemetry/greenpower-telemetry.component';
import { RearWingPilotComponent } from './prototypes/rear-wing-pilot/rear-wing-pilot.component';
import { TelemetryComponent } from './telemetry/telemetry.component';
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LoginComponent } from './login.component';
import { ProfileComponent } from './profile.component';
import { SettingsComponent } from './settings.component';
import { TeamComponent } from './team.component';
import { AppsComponent } from './apps.component';
import { BuyPrnComponent } from './buy-prn.component';
import { PrototypeGalleryComponent } from './prototypes/prototype-gallery.component';
import { ClearSlateComponent } from './prototypes/clear-slate/clear-slate.component';
import { WarmGraphiteComponent } from './prototypes/warm-graphite/warm-graphite.component';
import { DeepTideComponent } from './prototypes/deep-tide/deep-tide.component';
import { QuietPlumComponent } from './prototypes/quiet-plum/quiet-plum.component';
import { ClayEmberComponent } from './prototypes/clay-ember/clay-ember.component';
import { ColorPalettePreviewComponent } from './prototypes/color-palette-preview.component';
import { NightSignalComponent } from './prototypes/night-signal/night-signal.component';
import { ChatComponent } from './chat/chat.component';
import { AppMapComponent } from './prototypes/app-map/app-map.component';
import { ImageMosaicComponent } from './prototypes/image-mosaic/image-mosaic.component';
import { HomeComponent } from './home.component';
import { GreenpowerLaunchComponent } from './greenpower-launch/greenpower-launch.component';

const appRoutes: Routes = [
  { path: '424-greenpower-dashboard', component: GreenpowerDashboardComponent },
  { path: 'prototypes/echook-connection', redirectTo: '424-greenpower-dashboard', pathMatch: 'full' },
  { path: '424-greenpower-2027', component: GreenpowerLaunchComponent, data: { editorial: true } },
  { path: '424-greenpower-telemetry', component: GreenpowerTelemetryComponent },
  { path: 'prototypes/rear-wing-pilot', component: RearWingPilotComponent },
  { path: '424-telemetry', component: TelemetryComponent },
  { path: 'prototypes/unity-live-link', redirectTo: '424-telemetry', pathMatch: 'full' },
  { path: 'prototypes/app-wiring', component: AppMapComponent, data: { mapView: 'wiring' } },
  { path: 'prototypes/home', redirectTo: 'prototypes', pathMatch: 'full' },
  { path: 'prototypes/editorial-mosaic', component: ImageMosaicComponent, data: { mosaicId: 'editorial-mosaic' } },
  { path: 'prototypes/balanced-grid', component: ImageMosaicComponent, data: { mosaicId: 'balanced-grid' } },
  { path: 'prototypes/masonry-flow', component: ImageMosaicComponent, data: { mosaicId: 'masonry-flow' } },
  { path: 'prototypes/panorama-rail', component: ImageMosaicComponent, data: { mosaicId: 'panorama-rail' } },
  { path: 'prototypes/staggered-collage', component: ImageMosaicComponent, data: { mosaicId: 'staggered-collage' } },
  { path: 'prototypes/data-model-map', component: AppMapComponent, data: { mapView: 'data' } },
  { path: 'prototypes/workflow-map', component: AppMapComponent, data: { mapView: 'flows' } },
  { path: 'prototypes/chat-bubbles/:id', redirectTo: 'chat/:id', pathMatch: 'full' },
  { path: 'prototypes/chat-bubbles', redirectTo: 'chat', pathMatch: 'full' },
  { path: 'prototypes/clear-slate', component: ClearSlateComponent, data: { paletteId: 'clear-slate' } },
  { path: 'prototypes/warm-graphite', component: WarmGraphiteComponent, data: { paletteId: 'warm-graphite' } },
  { path: 'prototypes/deep-tide', component: DeepTideComponent, data: { paletteId: 'deep-tide' } },
  { path: 'prototypes/quiet-plum', component: QuietPlumComponent, data: { paletteId: 'quiet-plum' } },
  { path: 'prototypes/clay-ember', component: ClayEmberComponent, data: { paletteId: 'clay-ember' } },
  { path: 'prototypes/night-signal-dark', component: ColorPalettePreviewComponent, data: { paletteId: 'night-signal-dark' } },
  { path: 'prototypes/night-signal', component: NightSignalComponent, data: { paletteId: 'night-signal' } },
  { path: 'prototypes/CLEAR-SLATE', redirectTo: 'prototypes/clear-slate', pathMatch: 'full' },
  { path: 'prototypes/WARM-GRAPHITE', redirectTo: 'prototypes/warm-graphite', pathMatch: 'full' },
  { path: 'prototypes/DEEP-TIDE', redirectTo: 'prototypes/deep-tide', pathMatch: 'full' },
  { path: 'prototypes/QUIET-PLUM', redirectTo: 'prototypes/quiet-plum', pathMatch: 'full' },
  { path: 'prototypes/CLAY-EMBER', redirectTo: 'prototypes/clay-ember', pathMatch: 'full' },
  { path: 'prototypes/NIGHT-SIGNAL', redirectTo: 'prototypes/night-signal', pathMatch: 'full' },
  { path: 'prototypes', component: PrototypeGalleryComponent },
  { path: 'home', component: HomeComponent },
  { path: 'chat/:id', component: ChatComponent },
  { path: 'chat', component: ChatComponent },
  { path: 'profile/all', redirectTo: 'home', pathMatch: 'full' },
  { path: 'profile/:id', component: ProfileComponent },
  { path: 'settings', component: SettingsComponent },
  { path: 'login', component: LoginComponent },
  { path: 'team', component: TeamComponent },
  { path: 'directory', redirectTo: 'team', pathMatch: 'full' },
  { path: 'apps', component: AppsComponent },
  { path: 'buyPRN/:id', component: BuyPrnComponent },
  { path: 'buyPRN', redirectTo: 'buyPRN/', pathMatch: 'full' },
  { path: '',   redirectTo: 'home', pathMatch: 'full' },
  { path: '**', redirectTo: 'home' }
];

@NgModule({
  imports: [
    RouterModule.forRoot(appRoutes)
  ],
  exports: [
    RouterModule
  ]
})
export class AppRoutingModule {}
