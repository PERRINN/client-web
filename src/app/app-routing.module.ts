import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LoginComponent } from './login.component';
import { AppsComponent } from './apps.component';
import { ChatComponent } from './chat.component';
import { ProfileComponent } from './profile.component';
import { SettingsComponent } from './settings.component';
import { DirectoryComponent } from './directory.component';
import { ContributeComponent } from './contribute.component';
import { ExchangeComponent } from './exchange.component';

const appRoutes: Routes = [
  { path: 'apps', component: AppsComponent },
  { path: 'chat/:id', component: ChatComponent },
  { path: 'profile/:id', component: ProfileComponent },
  { path: 'settings', component: SettingsComponent },
  { path: 'login', component: LoginComponent },
  { path: 'directory', component: DirectoryComponent },
  { path: 'contribute', component: ContributeComponent },
  { path: 'exchange', component: ExchangeComponent },
  { path: '',   redirectTo: '/login', pathMatch: 'full' },
  { path: '**', component: LoginComponent }
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
