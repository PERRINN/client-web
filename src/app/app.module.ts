import { EchookConnectionComponent } from './prototypes/echook-connection/echook-connection.component';
import { ChatParticipantsComponent } from './chat/chat-participants/chat-participants.component';
import { GreenpowerChannelOptionComponent } from './greenpower-telemetry/greenpower-channel-option.component';
import { GreenpowerLaunchComponent } from './greenpower-launch/greenpower-launch.component';
import { GreenpowerPhotoComponent } from './greenpower-launch/greenpower-photo.component';
import { ImageViewerComponent } from './image-viewer/image-viewer.component';
import { GreenpowerOverlayComponent } from './greenpower-telemetry/greenpower-overlay.component';
import { GreenpowerTelemetryComponent } from './greenpower-telemetry/greenpower-telemetry.component';
import { GreenpowerMapComponent } from './greenpower-telemetry/greenpower-map.component';
import { GreenpowerLapListComponent } from './greenpower-telemetry/greenpower-lap-list.component';
import { GreenpowerChartComponent } from './greenpower-telemetry/greenpower-chart.component';
import { GreenpowerEventSelectorComponent } from './greenpower-telemetry/greenpower-event-selector.component';
import { GreenpowerEventEditorComponent } from './greenpower-telemetry/greenpower-event-editor.component';
import { GreenpowerMetadataFieldsComponent } from './greenpower-telemetry/greenpower-metadata-fields.component';
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
import { ConversationListComponent } from './conversation-list/conversation-list.component';
import { SidebarConversationsComponent } from './sidebar-conversations/sidebar-conversations.component';
import { ProfileLedgerComponent } from './profile/profile-ledger.component';
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
import { VoiceComposerComponent } from './voice/voice-composer/voice-composer.component';
import { ChatVoiceMessageComponent } from './chat/chat-voice-message/chat-voice-message.component';
import { ChatInputSettingsComponent } from './chat/chat-input-settings/chat-input-settings.component';
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
import { AngularFireStorageModule } from '@angular/fire/compat/storage';
import { AngularFireAuthModule } from '@angular/fire/compat/auth';

import { environment } from '../environments/environment';

import { AgChartsAngular } from 'ag-charts-angular';

// Must export the config
export const firebaseConfig = {
  apiKey: environment.FIREBASE_API_KEY,
  authDodash: environment.FIREBASE_AUTH_DOMAIN,
  storageBucket: environment.FIREBASE_STORAGE_BUCKET,
  projectId: environment.FIREBASE_PROJECT_ID,
  messagingSenderId: environment.FIREBASE_MESSAGING_SENDER_ID
};

@NgModule({ declarations: [
        EchookConnectionComponent,
        GreenpowerLaunchComponent,
        GreenpowerPhotoComponent,
        GreenpowerTelemetryComponent,
        GreenpowerChannelOptionComponent,
        GreenpowerOverlayComponent,
        GreenpowerChartComponent,
        GreenpowerEventSelectorComponent,
        GreenpowerEventEditorComponent,
        GreenpowerMetadataFieldsComponent,
        GreenpowerMapComponent,
        GreenpowerLapListComponent,
        RearWingPilotComponent,
        AppComponent,
        ImageViewerComponent,
        AppsComponent,
        LoginComponent,
        ProfileComponent, ConversationListComponent, SidebarConversationsComponent, ProfileLedgerComponent,
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
        VoiceComposerComponent, ChatVoiceMessageComponent, ChatInputSettingsComponent, ChatParticipantsComponent,
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
