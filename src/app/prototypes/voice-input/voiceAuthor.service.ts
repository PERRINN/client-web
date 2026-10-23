import { EnvironmentInjector, Injectable, OnDestroy, runInInjectionContext } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { firstValueFrom, Subject, Subscription, takeUntil, timeout } from 'rxjs';
import { UserInterfaceService } from '../../userInterface.service';
import { userPhotoSources } from '../../userAvatar';
import { VOICE_ADMIN, VOICE_PARTICIPANT, VoiceConversationService, VoiceMessage } from './voiceConversation.service';

interface AuthorProfile {
  user: string; name?: string; imageUrlThumbUser?: string; imageUrlMedium?: string; imageUrlOriginal?: string;
}

/** One other participant, not one profile request for every message. */
@Injectable()
export class VoiceAuthorService implements OnDestroy {
  private owner = '';
  private other = '';
  private profile?: AuthorProfile;
  private epoch = 0;
  private photoKey = '';
  private photos: string[] = [];
  private readonly emptySources: string[] = [];
  private cancelled = new Subject<void>();
  private subscription: Subscription;

  constructor(private firestore: AngularFirestore, private injector: EnvironmentInjector,
    private conversation: VoiceConversationService, private ui: UserInterfaceService) {
    this.subscription = conversation.changed.subscribe(() => this.sync());
    this.sync();
  }

  private sync(): void {
    const owner = this.conversation.allowed ? this.conversation.uid : '';
    if (owner === this.owner) return;
    this.owner = owner; this.epoch++; this.cancelled.next(); this.profile = undefined; this.photoKey = ''; this.photos = [];
    this.other = owner ? owner === VOICE_ADMIN ? VOICE_PARTICIPANT : VOICE_ADMIN : '';
    if (this.other && !this.loadedProfile()) void this.load(this.epoch);
  }
  private loadedProfile(): AuthorProfile | undefined {
    return [this.ui.currentUserLastMessageObj, this.ui.PERRINNAdminLastMessageObj]
      .find(profile => profile?.user === this.other);
  }
  private async load(epoch: number): Promise<void> {
    try {
      const result = await firstValueFrom(runInInjectionContext(this.injector, () =>
        this.firestore.collection<AuthorProfile>('PERRINNMessages', ref => ref.where('user', '==', this.other)
          .where('verified', '==', true).orderBy('serverTimestamp', 'desc').limit(1)).get()
      ).pipe(timeout({ first: 10000 }), takeUntil(this.cancelled)));
      if (epoch !== this.epoch) return;
      const record = result.docs[0]?.data();
      // Keep only the public presentation fields, never the full legacy record.
      this.profile = record ? { user: record.user, name: record.name, imageUrlThumbUser: record.imageUrlThumbUser,
        imageUrlMedium: record.imageUrlMedium, imageUrlOriginal: record.imageUrlOriginal } : undefined;
      this.conversation.changed.next();
    } catch { /* Same initials fallback as production; no profile polling/retry. */ }
  }
  name(message: VoiceMessage): string {
    return message.userId === this.other ? (this.loadedProfile() || this.profile)?.name || message.authorName : message.authorName;
  }
  sources(message: VoiceMessage): string[] {
    const profile = message.userId === this.other ? this.loadedProfile() || this.profile : undefined;
    if (!profile) return this.emptySources;
    const key = [profile.imageUrlThumbUser, profile.imageUrlMedium, profile.imageUrlOriginal].join('|');
    if (key !== this.photoKey) { this.photoKey = key; this.photos = userPhotoSources([profile.imageUrlThumbUser, profile.imageUrlMedium, profile.imageUrlOriginal]); }
    return this.photos;
  }
  ngOnDestroy(): void {
    this.epoch++; this.cancelled.next(); this.cancelled.complete(); this.subscription.unsubscribe(); this.profile = undefined;
  }
}
