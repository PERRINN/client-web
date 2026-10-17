import { ImageViewerComponent } from './image-viewer/image-viewer.component';
import { TeamRadioComponent } from './prototypes/team-radio/team-radio.component';
import { RearWingPilotComponent } from './prototypes/rear-wing-pilot/rear-wing-pilot.component';
import { PrnSendManagerComponent } from './chat/prn-send-manager/prn-send-manager.component';
import { ChatFlagComponent } from './chat/chat-flag/chat-flag.component';
import { ChatMessageComponent } from './chat/chat-message/chat-message.component';
import { ChatEventSummaryComponent } from './chat/chat-event/chat-event-summary.component';
import { ChatFundSummaryComponent } from './chat/chat-fund/chat-fund-summary.component';
import { ChatFundEditorComponent } from './chat/chat-fund/chat-fund-editor.component';
import { ChatEventEditorComponent } from './chat/chat-event/chat-event-editor.component';
import { RideHeightScatterComponent } from './telemetry/ride-height-scatter.component';
import { TelemetryComponent } from './telemetry/telemetry.component';
import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { ServiceWorkerModule } from '@angular/service-worker';

import { AppsComponent } from './apps.component';
import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { LoginComponent }  from './login.component';
import { ProfileComponent }  from './profile.component';
import { SettingsComponent }  from './settings.component';
import { TeamComponent }  from './team.component';
import { BuyPrnComponent }  from './buy-prn.component';
import { PrototypeGalleryComponent } from './prototypes/prototype-gallery.component';
import { ColorPalettePreviewComponent } from './prototypes/color-palette-preview.component';
import { ClearSlateComponent } from './prototypes/clear-slate/clear-slate.component';
import { WarmGraphiteComponent } from './prototypes/warm-graphite/warm-graphite.component';
import { DeepTideComponent } from './prototypes/deep-tide/deep-tide.component';
import { QuietPlumComponent } from './prototypes/quiet-plum/quiet-plum.component';
import { ClayEmberComponent } from './prototypes/clay-ember/clay-ember.component';
import { NightSignalComponent } from './prototypes/night-signal/night-signal.component';
import { ChatComponent } from './chat/chat.component';
import { ChatComposerComponent } from './chat/chat-composer/chat-composer.component';
import { AppMapComponent } from './prototypes/app-map/app-map.component';
import { ImageMosaicComponent } from './prototypes/image-mosaic/image-mosaic.component';
import { HomeComponent } from './home.component';

import { PipeModule }    from './pipes.module';

import { UserInterfaceService } from './userInterface.service';
import { ScrollableDirective } from './scrollable.directive';
import { UserAvatarComponent } from './user-avatar.component';

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
        RearWingPilotComponent,
        TeamRadioComponent,
        AppComponent,
        ImageViewerComponent,
        AppsComponent,
        LoginComponent,
        ProfileComponent,
        SettingsComponent,
        TeamComponent,
        BuyPrnComponent,
        PrototypeGalleryComponent,
        TelemetryComponent,
        ColorPalettePreviewComponent,
        ClearSlateComponent,
        WarmGraphiteComponent,
        DeepTideComponent,
        QuietPlumComponent,
        ClayEmberComponent,
        NightSignalComponent,
        ChatComposerComponent,
        ChatComponent,
        PrnSendManagerComponent,
        ChatFlagComponent,
        ChatMessageComponent,
        ChatEventSummaryComponent,
        ChatEventEditorComponent,
        ChatFundSummaryComponent,
        ChatFundEditorComponent,
        AppMapComponent,
        ImageMosaicComponent,
        HomeComponent,
        ScrollableDirective,
        UserAvatarComponent,
    ],
    bootstrap: [AppComponent], imports: [BrowserModule, RideHeightScatterComponent,
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
