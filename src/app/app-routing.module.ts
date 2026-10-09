import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LoginComponent } from './login.component';
import { ChatComponent } from './chat.component';
import { ProfileComponent } from './profile.component';
import { SettingsComponent } from './settings.component';
import { DirectoryComponent } from './directory.component';
import { BuyPrnComponent } from './buy-prn.component';
import { PrototypeGalleryComponent } from './prototypes/prototype-gallery.component';
import { MemberTextFieldComponent } from './prototypes/member-text-field/member-text-field.component';
import { ClassicSocialFeedComponent } from './prototypes/classic-social-feed/classic-social-feed.component';
import { CommunityDashboardComponent } from './prototypes/community-dashboard/community-dashboard.component';
import { MobileFirstSocialComponent } from './prototypes/mobile-first-social/mobile-first-social.component';
import { ClearSlateComponent } from './prototypes/clear-slate/clear-slate.component';
import { WarmGraphiteComponent } from './prototypes/warm-graphite/warm-graphite.component';
import { DeepTideComponent } from './prototypes/deep-tide/deep-tide.component';
import { QuietPlumComponent } from './prototypes/quiet-plum/quiet-plum.component';
import { ClayEmberComponent } from './prototypes/clay-ember/clay-ember.component';
import { NightSignalComponent } from './prototypes/night-signal/night-signal.component';
import { ChatInputBarComponent } from './prototypes/chat-input-bar/chat-input-bar.component';

const appRoutes: Routes = [
  { path: 'prototypes/chat-input-bar', component: ChatInputBarComponent },
  { path: 'prototypes/member-text-field', component: MemberTextFieldComponent },
  { path: 'prototypes/classic-social-feed', component: ClassicSocialFeedComponent },
  { path: 'prototypes/community-dashboard', component: CommunityDashboardComponent },
  { path: 'prototypes/mobile-first-social', component: MobileFirstSocialComponent },
  { path: 'prototypes/clear-slate', component: ClearSlateComponent, data: { paletteId: 'clear-slate' } },
  { path: 'prototypes/warm-graphite', component: WarmGraphiteComponent, data: { paletteId: 'warm-graphite' } },
  { path: 'prototypes/deep-tide', component: DeepTideComponent, data: { paletteId: 'deep-tide' } },
  { path: 'prototypes/quiet-plum', component: QuietPlumComponent, data: { paletteId: 'quiet-plum' } },
  { path: 'prototypes/clay-ember', component: ClayEmberComponent, data: { paletteId: 'clay-ember' } },
  { path: 'prototypes/night-signal', component: NightSignalComponent, data: { paletteId: 'night-signal' } },
  { path: 'prototypes/CHAT-INPUT-BAR', redirectTo: 'prototypes/chat-input-bar', pathMatch: 'full' },
  { path: 'prototypes/MEMBER-TEXT-FIELD', redirectTo: 'prototypes/member-text-field', pathMatch: 'full' },
  { path: 'prototypes/CLASSIC-SOCIAL-FEED', redirectTo: 'prototypes/classic-social-feed', pathMatch: 'full' },
  { path: 'prototypes/COMMUNITY-DASHBOARD', redirectTo: 'prototypes/community-dashboard', pathMatch: 'full' },
  { path: 'prototypes/MOBILE-FIRST-SOCIAL', redirectTo: 'prototypes/mobile-first-social', pathMatch: 'full' },
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
