import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { ServiceWorkerModule } from '@angular/service-worker';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { ChatComponent }  from './chat.component';
import { LoginComponent }  from './login.component';
import { ProfileComponent }  from './profile.component';
import { SettingsComponent }  from './settings.component';
import { DirectoryComponent }  from './directory.component';
import { BuyPrnComponent }  from './buy-prn.component';
import { PrototypeGalleryComponent } from './prototypes/prototype-gallery.component';
import { MemberTextFieldComponent } from './prototypes/member-text-field/member-text-field.component';
import { ClassicSocialFeedComponent } from './prototypes/classic-social-feed/classic-social-feed.component';
import { CommunityDashboardComponent } from './prototypes/community-dashboard/community-dashboard.component';
import { MobileFirstSocialComponent } from './prototypes/mobile-first-social/mobile-first-social.component';
import { ColorPalettePreviewComponent } from './prototypes/color-palette-preview.component';
import { ClearSlateComponent } from './prototypes/clear-slate/clear-slate.component';
import { WarmGraphiteComponent } from './prototypes/warm-graphite/warm-graphite.component';
import { DeepTideComponent } from './prototypes/deep-tide/deep-tide.component';
import { QuietPlumComponent } from './prototypes/quiet-plum/quiet-plum.component';
import { ClayEmberComponent } from './prototypes/clay-ember/clay-ember.component';
import { NightSignalComponent } from './prototypes/night-signal/night-signal.component';
import { ChatInputBarComponent } from './prototypes/chat-input-bar/chat-input-bar.component';

import { PipeModule }    from './pipes.module';

import { UserInterfaceService } from './userInterface.service';
import { ScrollableDirective } from './scrollable.directive';

import { AngularFireModule } from '@angular/fire/compat';
import { AngularFirestoreModule } from '@angular/fire/compat/firestore';
import { AngularFireDatabaseModule } from '@angular/fire/compat/database';
import { AngularFireStorageModule } from '@angular/fire/compat/storage';
import { AngularFireAuthModule } from '@angular/fire/compat/auth';

import { environment } from '../environments/environment';

import { AgChartsAngular } from 'ag-charts-angular';

// Must export the config
export const firebaseConfig = {
  apiKey: environment.FIREBASE_API_KEY,
  authDodash: environment.FIREBASE_AUTH_DOMAIN,
  databaseURL: environment.FIREBASE_DATABASE_URL,
  storageBucket: environment.FIREBASE_STORAGE_BUCKET,
  projectId: environment.FIREBASE_PROJECT_ID,
  messagingSenderId: environment.FIREBASE_MESSAGING_SENDER_ID
};

@NgModule({ declarations: [
        AppComponent,
        ChatComponent,
        LoginComponent,
        ProfileComponent,
        SettingsComponent,
        DirectoryComponent,
        BuyPrnComponent,
        PrototypeGalleryComponent,
        MemberTextFieldComponent,
        ClassicSocialFeedComponent,
        CommunityDashboardComponent,
        MobileFirstSocialComponent,
        ColorPalettePreviewComponent,
        ClearSlateComponent,
        WarmGraphiteComponent,
        DeepTideComponent,
        QuietPlumComponent,
        ClayEmberComponent,
        NightSignalComponent,
        ChatInputBarComponent,
        ScrollableDirective,
    ],
    bootstrap: [AppComponent], imports: [BrowserModule,
        FormsModule,
        AngularFireModule.initializeApp(firebaseConfig),
        AngularFirestoreModule.enablePersistence({ synchronizeTabs: true }),
        AngularFireStorageModule,
        AngularFireDatabaseModule,
        AngularFireAuthModule,
        AppRoutingModule,
        PipeModule.forRoot(),
        AgChartsAngular,
        ServiceWorkerModule.register('ngsw-worker.js', {
            enabled: environment.production,
            registrationStrategy: 'registerImmediately'
        })], providers: [
        UserInterfaceService,
        provideHttpClient(withInterceptorsFromDi()),
    ] })
export class AppModule { }
