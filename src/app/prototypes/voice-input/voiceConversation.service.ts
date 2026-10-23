import { EnvironmentInjector, Injectable, OnDestroy, runInInjectionContext } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import { firstValueFrom, Subject, Subscription, takeUntil, timeout } from 'rxjs';
import { PermissionsService } from '../../permissions.service';

export const VOICE_CONVERSATION = 'pilot';
export const VOICE_ADMIN = 'QYm5NATKa6MGD87UpNZCTl6IolX2';
export const VOICE_PARTICIPANT = 'xDfdZLLRHuObIUNEUj8SdClxZXf2';
export const VOICE_PARTICIPANTS = [VOICE_PARTICIPANT, 'sks8zpXOy7ZBzhOIx1ISjtNgegh1'];
export interface VoiceMessage {
  id: string; userId: string; requestId: string; authorName: string; text: string;
  createdAt: firebase.firestore.Timestamp;
  source?: 'voice'; audioExpiresAt?: number;
}
type MessageDocument = firebase.firestore.QueryDocumentSnapshot<Omit<VoiceMessage, 'id'>>;

@Injectable()
export class VoiceConversationService implements OnDestroy {
  readonly changed = new Subject<void>();
  readonly incoming = new Subject<VoiceMessage>();
  private openedAt = Date.now();
  allowed = false;
  ready = false;
  uid = '';
  messages: VoiceMessage[] = [];
  loading = false;
  loadingEarlier = false;
  canLoadEarlier = false;
  error = '';
  private historyError = false;
  private cancelled = new Subject<void>();
  private epoch = 0;
  private revision = 0;
  private cursor?: MessageDocument;
  private listener?: Subscription;
  private permissions: Subscription;
  private rows = new Map<string, VoiceMessage>();

  constructor(private firestore: AngularFirestore, private injector: EnvironmentInjector, permissions: PermissionsService) {
    this.permissions = permissions.state.subscribe(state => {
      const allowed = state.ready && (VOICE_PARTICIPANTS.includes(state.uid) || state.uid === VOICE_ADMIN && state.isAdmin);
      if (state.uid !== this.uid || allowed !== this.allowed) {
        this.epoch++; this.revision++; this.cancelled.next(); this.listener?.unsubscribe(); this.listener = undefined;
        this.uid = state.uid; this.allowed = allowed; this.rows.clear(); this.messages = [];
        this.openedAt = Date.now();
        this.cursor = undefined; this.canLoadEarlier = false; this.loadingEarlier = false; this.error = ''; this.historyError = false;
        this.loading = allowed;
        if (allowed) this.listen(this.epoch);
      }
      this.ready = state.ready; this.changed.next();
    });
  }

  private listen(epoch: number): void {
    try {
      this.listener = runInInjectionContext(this.injector, () => this.firestore.collection<Omit<VoiceMessage, 'id'>>(
        `VoiceConversations/${VOICE_CONVERSATION}/messages`, ref => ref.orderBy('createdAt', 'desc').limit(50)
      ).snapshotChanges().subscribe({
        next: changes => {
          if (epoch !== this.epoch) return;
          const docs = changes.map(change => change.payload.doc);
          // After a long reconnect, more than fifty new messages can replace the
          // whole window. Restart history at that window instead of hiding a gap.
          const gap = docs.length > 0 && this.rows.size > 0 && !docs.some(doc => this.rows.has(doc.id));
          if (gap) { this.rows.clear(); this.cursor = undefined; this.revision++; this.loadingEarlier = false; }
          const oldest = docs.at(-1);
          if (oldest && (!this.cursor || oldest.data().createdAt.toMillis() < this.cursor.data().createdAt.toMillis()
            || oldest.data().createdAt.toMillis() === this.cursor.data().createdAt.toMillis() && oldest.id < this.cursor.id)) {
            this.cursor = oldest; this.canLoadEarlier = docs.length === 50;
          }
          const incoming: VoiceMessage[] = [];
          for (const doc of docs) {
            const message = { id: doc.id, ...doc.data() };
            if (!this.rows.has(doc.id) && message.userId !== this.uid && message.createdAt.toMillis() >= this.openedAt) incoming.push(message);
            this.rows.set(doc.id, message);
          }
          this.loading = false; this.error = ''; this.publish();
          for (const message of incoming.reverse()) this.incoming.next(message);
        },
        error: () => { if (epoch === this.epoch) { this.loading = false; this.error = 'Could not load the conversation.'; this.changed.next(); } }
      }));
    } catch {
      if (epoch === this.epoch) { this.loading = false; this.error = 'Could not load the conversation.'; this.changed.next(); }
    }
  }

  retry(): void {
    if (!this.allowed || this.loading || this.loadingEarlier) return;
    if (this.historyError) { void this.loadEarlier(); return; }
    this.listener?.unsubscribe(); this.error = ''; this.loading = true;
    this.listen(this.epoch); this.changed.next();
  }

  async loadEarlier(): Promise<void> {
    if (!this.allowed || this.loadingEarlier || !this.canLoadEarlier || !this.cursor) return;
    const epoch = this.epoch, revision = this.revision, cursor = this.cursor;
    this.loadingEarlier = true; this.error = ''; this.historyError = false; this.changed.next();
    try {
      const snapshot = await firstValueFrom(runInInjectionContext(this.injector, () =>
        this.firestore.collection<Omit<VoiceMessage, 'id'>>(`VoiceConversations/${VOICE_CONVERSATION}/messages`,
          ref => ref.orderBy('createdAt', 'desc').startAfter(cursor).limit(50)).get({ source: 'server' })
      ).pipe(timeout({ first: 10000 }), takeUntil(this.cancelled)));
      if (epoch !== this.epoch || revision !== this.revision) return;
      for (const doc of snapshot.docs) this.rows.set(doc.id, { id: doc.id, ...doc.data() });
      this.cursor = snapshot.docs.at(-1) || cursor; this.canLoadEarlier = snapshot.size === 50;
      this.publish();
    } catch {
      if (epoch === this.epoch && revision === this.revision) { this.error = 'Could not load earlier messages.'; this.historyError = true; }
    } finally {
      if (epoch === this.epoch && revision === this.revision) { this.loadingEarlier = false; this.changed.next(); }
    }
  }

  private publish(): void {
    this.messages = [...this.rows.values()].sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis() || a.id.localeCompare(b.id));
    this.changed.next();
  }
  ngOnDestroy(): void { this.epoch++; this.cancelled.next(); this.cancelled.complete(); this.listener?.unsubscribe(); this.permissions.unsubscribe(); this.changed.complete(); }
}
