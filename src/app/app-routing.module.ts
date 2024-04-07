import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LoginComponent } from './login.component';
import { ChatComponent } from './chat.component';
import { ProfileComponent } from './profile.component';
import { SettingsComponent } from './settings.component';
import { DirectoryComponent } from './directory.component';
import { ContributeComponent } from './contribute.component';

const appRoutes: Routes = [
  { path: 'chat/:id', component: ChatComponent },
  { path: 'profile/:id', component: ProfileComponent },
  { path: 'settings', component: SettingsComponent },
  { path: 'login', component: LoginComponent },
  { path: 'directory', component: DirectoryComponent },
  { path: 'contribute', component: ContributeComponent },
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
