import { EnvironmentInjector, Injectable, OnDestroy, runInInjectionContext } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subscription } from 'rxjs';
import { UserInterfaceService } from '../../userInterface.service';
import { userPhotoSources } from '../../userAvatar';

interface RadioProfile {
  imageUrlThumbUser?: string;
  imageUrlMedium?: string;
  imageUrlOriginal?: string;
}

/** Reuse the current profile and resolve at most ten participant photos via the existing profile query. */
@Injectable()
export class RadioAvatarsService implements OnDestroy {
  readonly images: Record<string, string[]> = {};
  private subscriptions = new Map<string, Subscription>();
  private readonly empty: string[] = [];

  constructor(private firestore: AngularFirestore, private profiles: UserInterfaceService, private injector: EnvironmentInjector) {}

  sync(ids: string[], currentUser?: string) {
    const active = new Set(ids.slice(0, 10));
    for (const [uid, subscription] of this.subscriptions) {
      if (!active.has(uid)) { subscription.unsubscribe(); this.subscriptions.delete(uid); }
    }
    for (const uid of Object.keys(this.images)) if (!active.has(uid)) delete this.images[uid];
    for (const uid of active) {
      const cached = this.profiles.currentUserLastMessageObj;
      if (uid === currentUser && cached?.user === uid) {
        this.subscriptions.get(uid)?.unsubscribe(); this.subscriptions.delete(uid);
        this.set(uid, cached); continue;
      }
      if (this.subscriptions.has(uid)) continue;
      const subscription = runInInjectionContext(this.injector, () =>
        this.firestore.collection<RadioProfile>('PERRINNMessages', query =>
          query.where('user', '==', uid).where('verified', '==', true)
            .orderBy('serverTimestamp', 'desc').limit(1)
        ).valueChanges()
      ).subscribe({ next: rows => this.set(uid, rows[0]), error: () => this.set(uid) });
      this.subscriptions.set(uid, subscription);
    }
  }

  sources(uid: string) { return this.images[uid] || this.empty; }
  ngOnDestroy() { this.subscriptions.forEach(subscription => subscription.unsubscribe()); this.subscriptions.clear(); }

  private set(uid: string, profile?: RadioProfile) {
    const next = userPhotoSources([profile?.imageUrlThumbUser, profile?.imageUrlMedium, profile?.imageUrlOriginal]);
    // Keep the input stable so a broken photo is not retried on each radio heartbeat.
    if (JSON.stringify(next) !== JSON.stringify(this.images[uid])) this.images[uid] = next;
  }
}
