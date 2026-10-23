import { EnvironmentInjector, Injectable, OnDestroy, runInInjectionContext } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { firstValueFrom, Subject, Subscription, takeUntil, timeout } from 'rxjs';
import { UserInterfaceService } from '../../userInterface.service';
import { userPhotoSources } from '../../userAvatar';
import { VOICE_ADMIN, VOICE_PARTICIPANTS, VoiceConversationService, VoiceMessage } from './voiceConversation.service';

interface AuthorProfile {
  user: string; name?: string; imageUrlThumbUser?: string; imageUrlMedium?: string; imageUrlOriginal?: string;
}

/** At most two profile requests per visit, independent of message count. */
@Injectable()
export class VoiceAuthorService implements OnDestroy {
  private owner = '';
  private others: string[] = [];
  private profiles = new Map<string, AuthorProfile>();
  private photos = new Map<string, { key: string; sources: string[] }>();
  private epoch = 0;
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
    this.owner = owner; this.epoch++; this.cancelled.next(); this.profiles.clear(); this.photos.clear();
    this.others = owner ? [VOICE_ADMIN, ...VOICE_PARTICIPANTS].filter(uid => uid !== owner) : [];
    for (const uid of this.others) if (!this.loadedProfile(uid)) void this.load(uid, this.epoch);
  }
  private loadedProfile(uid: string): AuthorProfile | undefined {
    return [this.ui.currentUserLastMessageObj, this.ui.PERRINNAdminLastMessageObj]
      .find(profile => profile?.user === uid);
  }
  private async load(uid: string, epoch: number): Promise<void> {
    try {
      const result = await firstValueFrom(runInInjectionContext(this.injector, () =>
        this.firestore.collection<AuthorProfile>('PERRINNMessages', ref => ref.where('user', '==', uid)
          .where('verified', '==', true).orderBy('serverTimestamp', 'desc').limit(1)).get()
      ).pipe(timeout({ first: 10000 }), takeUntil(this.cancelled)));
      if (epoch !== this.epoch) return;
      const record = result.docs[0]?.data();
      // Keep only the public presentation fields, never the full legacy record.
      if (record?.user === uid) this.profiles.set(uid, { user: record.user, name: record.name,
        imageUrlThumbUser: record.imageUrlThumbUser, imageUrlMedium: record.imageUrlMedium,
        imageUrlOriginal: record.imageUrlOriginal });
      this.conversation.changed.next();
    } catch { /* Same initials fallback as production; no profile polling/retry. */ }
  }
  private profile(uid: string): AuthorProfile | undefined {
    return this.others.includes(uid) ? this.loadedProfile(uid) || this.profiles.get(uid) : undefined;
  }
  name(message: VoiceMessage): string {
    return this.profile(message.userId)?.name || message.authorName;
  }
  sources(message: VoiceMessage): string[] {
    const profile = this.profile(message.userId);
    if (!profile) return this.emptySources;
    const key = [profile.imageUrlThumbUser, profile.imageUrlMedium, profile.imageUrlOriginal].join('|');
    let cached = this.photos.get(message.userId);
    if (!cached || cached.key !== key) {
      cached = { key, sources: userPhotoSources([profile.imageUrlThumbUser, profile.imageUrlMedium, profile.imageUrlOriginal]) };
      this.photos.set(message.userId, cached);
    }
    return cached.sources;
  }
  ngOnDestroy(): void {
    this.epoch++; this.cancelled.next(); this.cancelled.complete(); this.subscription.unsubscribe(); this.profiles.clear(); this.photos.clear();
  }
}
