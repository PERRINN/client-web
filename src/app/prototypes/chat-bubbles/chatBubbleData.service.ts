import { chatEvent, ChatEvent, eventActionText, normalizeEvent } from '../chat-event/chatEvent';
import { EnvironmentInjector, Injectable, runInInjectionContext } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFireStorage } from '@angular/fire/compat/storage';
import { combineLatest, firstValueFrom, of, Subject } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { UserInterfaceService } from '../../userInterface.service';
import { PrototypeChatDraft } from '../chat-composer/chat-composer.component';
import { bubbleMessage, chatImageError, chatMembers, ChatRecord, ChatTimestamp, firstUnread, isAfterPosition, ReadPosition, timestampMillis } from './chatBubbleData';

@Injectable({ providedIn: 'root' })
export class ChatBubbleDataService {
  private submittedMessages = new Subject<{ chain: string; userId: string; messageId: string }>();
  readonly submitted = this.submittedMessages.asObservable();
  constructor(
    private afs: AngularFirestore, private auth: AngularFireAuth, private storage: AngularFireStorage,
    private injector: EnvironmentInjector, private UI: UserInterfaceService
  ) {}

  watch(chain: string, limit: number) {
    return runInInjectionContext(this.injector, () => this.auth.authState.pipe(switchMap(user => runInInjectionContext(this.injector, () => {
      const cursor = user ? this.afs.doc<{ serverTimestamp?: ChatTimestamp; messageId?: string }>(`lastSeen/${user.uid}/chats/${chain}`)
        .get().pipe(map(snapshot => { const record = snapshot.data(); return { timestamp: timestampMillis(record?.serverTimestamp), messageId: record?.messageId || '' }; }), catchError(() => of(null))) : of(null);
      const messages = this.afs.collection<ChatRecord>('PERRINNMessages', ref => ref
        .where('chain', '==', chain).orderBy('serverTimestamp', 'desc').limit(limit)
      ).snapshotChanges();
      return combineLatest([messages, cursor]).pipe(map(([rows, seen]) => {
        const latest = rows.find(row => row.payload.doc.data().lastMessage)?.payload.doc.data() || rows[0]?.payload.doc.data() || {};
        const messages = [...rows].reverse().map(row => bubbleMessage(row.payload.doc.id, row.payload.doc.data(), user?.uid || null));
        return {
          messages, event: chatEvent(latest), title: latest.chatSubject || 'Conversation', members: chatMembers(latest, user?.uid || null),
          avatar: latest.chatProfileImageUrlThumb || latest.chatProfileImageUrlMedium || '',
          unreadId: firstUnread(messages, seen?.timestamp || 0, seen?.messageId), userId: user?.uid || null, seen, cursorUnavailable: !!user && seen === null, hasMore: rows.length === limit, signedIn: !!user
        };
      }));
    }))));
  }

  async advanceReadCursor(chain: string, userId: string, candidate: ReadPosition): Promise<ReadPosition | null> {
    if (!chain || !userId || !candidate.messageId || !Number.isFinite(candidate.timestamp) || candidate.timestamp <= 0) return null;
    candidate = { ...candidate, timestamp: Math.floor(candidate.timestamp) };
    if ((await this.auth.currentUser)?.uid !== userId) return null;
    const ref = this.afs.firestore.doc(`lastSeen/${userId}/chats/${chain}`);
    return this.afs.firestore.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const record = snapshot.data();
      const previous = { timestamp: timestampMillis(record?.['serverTimestamp']), messageId: record?.['messageId'] || '' };
      if (!isAfterPosition(candidate, previous)) return previous;
      transaction.set(ref, { messageId: candidate.messageId, serverTimestamp: new Date(candidate.timestamp), updatedAt: new Date() }, { merge: true });
      return candidate;
    });
  }

  async send(chain: string, draft: PrototypeChatDraft): Promise<void> {
    const userId = await this.requireSender();
    if (!chain || (!draft.text.trim() && !draft.image)) throw new Error('Write a message or choose an image.');
    if (draft.text.length > 500) throw new Error('Messages can contain up to 500 characters.');
    const image = draft.image ? await this.uploadImage(draft.image) : { timestamp: null, url: null };
    await this.checkSender(userId);
    await this.createMessage(userId, {
      text: draft.text.trim(), chain, chatImageTimestamp: image.timestamp,
      chatImageUrlThumb: image.url, chatImageUrlMedium: image.url, chatImageUrlOriginal: image.url
    });
  }

  async updateDetails(chain: string, changes: { subject?: string; image?: File }): Promise<void> {
    const userId = await this.requireSender();
    const subject = changes.subject?.trim();
    if (!chain || (subject === undefined && !changes.image)) throw new Error('No changes to save.');
    if (subject !== undefined && (!subject || subject.length > 60)) throw new Error('Use a subject between 1 and 60 characters.');
    const image = changes.image ? await this.uploadImage(changes.image) : null;
    await this.checkSender(userId);
    await this.createMessage(userId, {
      chain, text: subject === undefined ? 'Changing chat profile image' : `Changing subject to ${subject}${image ? ' and chat profile image' : ''}`,
      ...(subject === undefined ? {} : { chatSubject: subject }),
      ...(image ? {
        chatImageTimestamp: image.timestamp, chatImageUrlThumb: image.url, chatImageUrlMedium: image.url, chatImageUrlOriginal: image.url,
        chatProfileImageTimestamp: image.timestamp, chatProfileImageUrlThumb: image.url, chatProfileImageUrlMedium: image.url, chatProfileImageUrlOriginal: image.url
      } : {})
    });
  }

  async saveEvent(chain: string, event: ChatEvent, previous: ChatEvent | null = null): Promise<void> {
    const userId = await this.requireSender();
    if (!chain) throw new Error('Choose a chat.');
    const valid = normalizeEvent(event);
    await this.checkSender(userId);
    const text = eventActionText(previous && previous.end > Date.now() ? 'Updated' : 'Scheduled', valid, previous);
    await this.createMessage(userId, { text, chain, eventDescription: valid.description,
      eventDateStart: valid.start, eventDateEnd: valid.end, eventDuration: valid.duration, eventLocation: valid.location });
  }

  async cancelEvent(chain: string, event: ChatEvent): Promise<void> {
    const userId = await this.requireSender();
    if (!chain) throw new Error('Choose a chat.');
    const text = eventActionText('Cancelled', event), past = Date.now() - 3600000;
    await this.checkSender(userId);
    await this.createMessage(userId, { text, chain, eventDateStart: past, eventDateEnd: past });
  }

  private async createMessage(userId: string, message: { chain: string; text: string; [key: string]: unknown }): Promise<void> {
    const ref = await this.UI.createMessage(message);
    if (ref?.id) this.submittedMessages.next({ chain: message.chain, userId, messageId: ref.id });
  }

  private async requireSender(): Promise<string> {
    const user = await this.auth.currentUser;
    if (!user || user.uid !== this.UI.currentUser) throw new Error('Sign in to save changes.');
    return user.uid;
  }

  private async checkSender(userId: string): Promise<void> {
    if (await this.requireSender() !== userId) throw new Error('Your account changed. Sign in again.');
  }

  private async uploadImage(image: File): Promise<{ timestamp: string; url: string }> {
    const error = chatImageError(image);
    if (error) throw new Error(error);
    const timestamp = String(Date.now());
    const path = `images/${timestamp}-${image.name.replace(/[^\w.-]/g, '_')}`;
    const ref = runInInjectionContext(this.injector, () => this.storage.ref(path));
    await runInInjectionContext(this.injector, () => ref.put(image));
    const url = await firstValueFrom(runInInjectionContext(this.injector, () => ref.getDownloadURL()));
    return { timestamp, url };
  }
}
