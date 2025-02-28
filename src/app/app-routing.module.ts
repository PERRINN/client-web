import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LoginComponent } from './login/login.component';
import { ChatComponent } from './chat/chat.component';
import { ProfileComponent } from './profile/profile.component';
import { SettingsComponent } from './settings/settings.component';
import { DirectoryComponent } from './directory/directory.component';
import { buyPRNComponent } from './buyPRN/buyPRN.component';

const appRoutes: Routes = [
  { path: 'chat/:id', component: ChatComponent },
  { path: 'profile/:id', component: ProfileComponent },
  { path: 'settings', component: SettingsComponent },
  { path: 'login', component: LoginComponent },
  { path: 'directory', component: DirectoryComponent },
  { path: 'buyPRN', component: buyPRNComponent },
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
