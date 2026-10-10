import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LoginComponent } from './login.component';
import { ChatComponent } from './chat.component';
import { ProfileComponent } from './profile.component';
import { SettingsComponent } from './settings.component';
import { DirectoryComponent } from './directory.component';
import { BuyPrnComponent } from './buy-prn.component';
import { PrototypeGalleryComponent } from './prototypes/prototype-gallery.component';
import { ConversationSidebarComponent } from './prototypes/conversation-sidebar/conversation-sidebar.component';
import { ClearSlateComponent } from './prototypes/clear-slate/clear-slate.component';
import { WarmGraphiteComponent } from './prototypes/warm-graphite/warm-graphite.component';
import { DeepTideComponent } from './prototypes/deep-tide/deep-tide.component';
import { QuietPlumComponent } from './prototypes/quiet-plum/quiet-plum.component';
import { ClayEmberComponent } from './prototypes/clay-ember/clay-ember.component';
import { NightSignalComponent } from './prototypes/night-signal/night-signal.component';
import { ChatInputBarComponent } from './prototypes/chat-input-bar/chat-input-bar.component';
import { AppMapComponent } from './prototypes/app-map/app-map.component';
import { HomeComponent } from './prototypes/home/home.component';

const appRoutes: Routes = [
  { path: 'prototypes/app-wiring', component: AppMapComponent, data: { mapView: 'wiring' } },
  { path: 'prototypes/home', component: HomeComponent },
  { path: 'prototypes/data-model-map', component: AppMapComponent, data: { mapView: 'data' } },
  { path: 'prototypes/workflow-map', component: AppMapComponent, data: { mapView: 'flows' } },
  { path: 'prototypes/chat-input-bar', component: ChatInputBarComponent },
  { path: 'prototypes/conversation-sidebar', component: ConversationSidebarComponent },
  { path: 'prototypes/clear-slate', component: ClearSlateComponent, data: { paletteId: 'clear-slate' } },
  { path: 'prototypes/warm-graphite', component: WarmGraphiteComponent, data: { paletteId: 'warm-graphite' } },
  { path: 'prototypes/deep-tide', component: DeepTideComponent, data: { paletteId: 'deep-tide' } },
  { path: 'prototypes/quiet-plum', component: QuietPlumComponent, data: { paletteId: 'quiet-plum' } },
  { path: 'prototypes/clay-ember', component: ClayEmberComponent, data: { paletteId: 'clay-ember' } },
  { path: 'prototypes/night-signal', component: NightSignalComponent, data: { paletteId: 'night-signal' } },
  { path: 'prototypes/CHAT-INPUT-BAR', redirectTo: 'prototypes/chat-input-bar', pathMatch: 'full' },
  { path: 'prototypes/CLEAR-SLATE', redirectTo: 'prototypes/clear-slate', pathMatch: 'full' },
  { path: 'prototypes/WARM-GRAPHITE', redirectTo: 'prototypes/warm-graphite', pathMatch: 'full' },
  { path: 'prototypes/DEEP-TIDE', redirectTo: 'prototypes/deep-tide', pathMatch: 'full' },
  { path: 'prototypes/QUIET-PLUM', redirectTo: 'prototypes/quiet-plum', pathMatch: 'full' },
  { path: 'prototypes/CLAY-EMBER', redirectTo: 'prototypes/clay-ember', pathMatch: 'full' },
  { path: 'prototypes/NIGHT-SIGNAL', redirectTo: 'prototypes/night-signal', pathMatch: 'full' },
  { path: 'prototypes', component: PrototypeGalleryComponent },
  { path: 'chat/:id', component: ChatComponent },
  { path: 'profile/:id', component: ProfileComponent },
  { path: 'settings', component: SettingsComponent },
  { path: 'login', component: LoginComponent },
  { path: 'directory', component: DirectoryComponent },
  { path: 'buyPRN/:id', component: BuyPrnComponent },
  { path: 'buyPRN', redirectTo: 'buyPRN/', pathMatch: 'full' },
  { path: '',   redirectTo: 'profile/all', pathMatch: 'full' },
  { path: '**', component: ProfileComponent }
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
