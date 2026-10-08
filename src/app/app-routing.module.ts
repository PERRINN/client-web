import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LoginComponent } from './login.component';
import { ChatComponent } from './chat.component';
import { ProfileComponent } from './profile.component';
import { SettingsComponent } from './settings.component';
import { DirectoryComponent } from './directory.component';
import { buyPRNComponent } from './buyPRN.component';
import { PrototypeGalleryComponent } from './prototypes/prototype-gallery.component';
import { MemberTextFieldComponent } from './prototypes/MEMBER-TEXT-FIELD/member-text-field.component';
import { ClassicSocialFeedComponent } from './prototypes/CLASSIC-SOCIAL-FEED/classic-social-feed.component';
import { CommunityDashboardComponent } from './prototypes/COMMUNITY-DASHBOARD/community-dashboard.component';
import { MobileFirstSocialComponent } from './prototypes/MOBILE-FIRST-SOCIAL/mobile-first-social.component';
import { ClearSlateComponent } from './prototypes/CLEAR-SLATE/clear-slate.component';
import { WarmGraphiteComponent } from './prototypes/WARM-GRAPHITE/warm-graphite.component';
import { DeepTideComponent } from './prototypes/DEEP-TIDE/deep-tide.component';
import { QuietPlumComponent } from './prototypes/QUIET-PLUM/quiet-plum.component';
import { ClayEmberComponent } from './prototypes/CLAY-EMBER/clay-ember.component';
import { NightSignalComponent } from './prototypes/NIGHT-SIGNAL/night-signal.component';

const appRoutes: Routes = [
  { path: 'prototypes/MEMBER-TEXT-FIELD', component: MemberTextFieldComponent },
  { path: 'prototypes/CLASSIC-SOCIAL-FEED', component: ClassicSocialFeedComponent },
  { path: 'prototypes/COMMUNITY-DASHBOARD', component: CommunityDashboardComponent },
  { path: 'prototypes/MOBILE-FIRST-SOCIAL', component: MobileFirstSocialComponent },
  { path: 'prototypes/CLEAR-SLATE', component: ClearSlateComponent, data: { paletteId: 'CLEAR-SLATE' } },
  { path: 'prototypes/WARM-GRAPHITE', component: WarmGraphiteComponent, data: { paletteId: 'WARM-GRAPHITE' } },
  { path: 'prototypes/DEEP-TIDE', component: DeepTideComponent, data: { paletteId: 'DEEP-TIDE' } },
  { path: 'prototypes/QUIET-PLUM', component: QuietPlumComponent, data: { paletteId: 'QUIET-PLUM' } },
  { path: 'prototypes/CLAY-EMBER', component: ClayEmberComponent, data: { paletteId: 'CLAY-EMBER' } },
  { path: 'prototypes/NIGHT-SIGNAL', component: NightSignalComponent, data: { paletteId: 'NIGHT-SIGNAL' } },
  { path: 'prototypes', component: PrototypeGalleryComponent },
  { path: 'chat/:id', component: ChatComponent },
  { path: 'profile/:id', component: ProfileComponent },
  { path: 'settings', component: SettingsComponent },
  { path: 'login', component: LoginComponent },
  { path: 'directory', component: DirectoryComponent },
  { path: 'buyPRN/:id', component: buyPRNComponent },
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
