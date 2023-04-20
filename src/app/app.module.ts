import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { ChatComponent }  from './chat.component';
import { AppsComponent }  from './apps.component';
import { LoginComponent }  from './login.component';
import { ProfileComponent }  from './profile.component';
import { SettingsComponent }  from './settings.component';
import { DirectoryComponent }  from './directory.component';
import { InvestComponent }  from './invest.component';
import { LinkyModule } from 'angular-linky';

import { PipeModule }    from './pipes.module';

import { UserInterfaceService } from './userInterface.service';
import { ScrollableDirective } from './scrollable.directive';

import { AngularFireModule } from '@angular/fire/compat';
import { AngularFirestoreModule } from '@angular/fire/compat/firestore';
import { AngularFireDatabaseModule } from '@angular/fire/compat/database';
import { AngularFireStorageModule } from '@angular/fire/compat/storage';
import { AngularFireAuthModule } from '@angular/fire/compat/auth';

import { Ng2ImgMaxModule } from 'ng2-img-max';

// Must export the config
export const firebaseConfig = {
  apiKey: 'AIzaSyAoG3PvimV926EgWlGvpzXrZAkOi1uWdcs',
  authDodash: 'perrinn-d5fc1.firebaseapp.com',
  databaseURL: 'https://perrinn-d5fc1.firebaseio.com',
  storageBucket: 'perrinn-d5fc1.appspot.com',
  projectId: 'perrinn-d5fc1',
  messagingSenderId: '44958643568'
};

@NgModule({
  declarations: [
    AppComponent,
    AppsComponent,
    ChatComponent,
    LoginComponent,
    ProfileComponent,
    SettingsComponent,
    DirectoryComponent,
    InvestComponent,
    ScrollableDirective,
  ],
  imports: [
    BrowserModule,
    FormsModule,
    HttpClientModule,
    AngularFireModule.initializeApp(firebaseConfig),
    AngularFirestoreModule.enablePersistence({synchronizeTabs:true}),
    AngularFireStorageModule,
    AngularFireDatabaseModule,
    AngularFireAuthModule,
    AppRoutingModule,
    LinkyModule,
    Ng2ImgMaxModule,
    PipeModule.forRoot(),
  ],
  providers: [
    UserInterfaceService,
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
