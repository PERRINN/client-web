import { chatEvent, ChatEvent, eventActionText, normalizeEvent } from './chat-event/chatEvent';
import { activeFund, chatFund, ChatFund, FundCurrency, fundCurrency, fundFromDraft, raisedFromDraft, FUND_DAY } from './chat-fund/chatFund';
import { EnvironmentInjector, Injectable, runInInjectionContext } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFireStorage } from '@angular/fire/compat/storage';
import { combineLatest, firstValueFrom, of, Subject } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { UserInterfaceService } from '../userInterface.service';
import { ChatDraft } from './chat-composer/chat-composer.component';
import { bubbleMessage, chatImageError, chatMembers, ChatRecord, ChatTimestamp, firstUnread, isAfterPosition, ReadPosition, timestampMillis } from './chatData';

@Injectable({ providedIn: 'root' })
export class ChatDataService {
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
        const records = new Map(rows.map(row => [row.payload.doc.id, row.payload.doc.data()]));
        const messages = [...rows].reverse().map(row => {
          const record = row.payload.doc.data();
          return bubbleMessage(row.payload.doc.id, record, user?.uid || null, records.get(record.transactionIn?.message || ''));
        });
        return {
          messages, event: chatEvent(latest), fund: chatFund(latest), title: latest.chatSubject || 'Conversation', members: chatMembers(latest, user?.uid || null),
          avatarSources: [latest.chatProfileImageUrlThumb, latest.chatProfileImageUrlMedium, latest.chatProfileImageUrlOriginal].filter((url): url is string => !!url),
          unreadId: firstUnread(messages, seen?.timestamp || 0, seen?.messageId), userId: user?.uid || null, seen, cursorUnavailable: !!user && seen === null, hasMore: rows.length === limit, signedIn: !!user
        };
      }));
    }))));
  }

  get viewerName(): string {
    const profile = this.UI.currentUserLastMessageObj;
    return this.UI.currentUser && profile?.user === this.UI.currentUser ? profile.name || '' : '';
  }

  timeCreditAmount(amount: number): string {
    return this.UI.convertAndFormatPRNToPRNCurrency(null, amount);
  }

  acknowledgeSubmission(chain: string, userId: string, messageId: string): void {
    this.submittedMessages.next({ chain, userId, messageId });
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

  async send(chain: string, draft: ChatDraft, onUploadProgress?: (percent: number | null) => void): Promise<void> {
    const userId = await this.requireSender();
    if (!chain || (!draft.text.trim() && !draft.image)) throw new Error('Write a message or choose an image.');
    if (draft.text.length > 500) throw new Error('Messages can contain up to 500 characters.');
    const image = draft.image ? await this.uploadImage(draft.image, onUploadProgress) : { timestamp: null, url: null };
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

  get fundCurrency(): FundCurrency {
    return fundCurrency(this.UI.currentUserLastMessageObj?.userCurrency, this.UI.PERRINNAdminLastMessageObj?.currencyList);
  }

  async saveFund(chain: string, fields: Pick<ChatFund, 'description' | 'amountGBPTarget' | 'daysLeft'> & { amountGBPRaised?: number }, editing = false, preservedClosesAt?: number | null): Promise<void> {
    const userId = await this.requireSender();
    if (!chain) throw new Error('Choose a chat.');
    const fund: Pick<ChatFund, 'description' | 'amountGBPTarget' | 'daysLeft'> & { amountGBPRaised?: number } = fundFromDraft({ description: fields.description, amount: fields.amountGBPTarget, days: fields.daysLeft }, { code: 'gbp', perGBP: 1 });
    if (Object.prototype.hasOwnProperty.call(fields, 'amountGBPRaised')) {
      await this.requireFundAdmin(userId);
      fund.amountGBPRaised = raisedFromDraft(fields.amountGBPRaised ?? null, { code: 'gbp', perGBP: 1 });
    }
    const closesAt = preservedClosesAt ?? Date.now() + fund.daysLeft * FUND_DAY;
    if (!Number.isSafeInteger(closesAt) || closesAt <= Date.now() || closesAt > 8640000000000000) throw new Error('Choose a future closing date.');
    const { daysLeft, ...values } = fund;
    await this.checkSender(userId);
    await this.createMessage(userId, { chain, text: `${editing ? 'Updated' : 'Created'} fund: ${fund.description}\nTarget: GBP ${fund.amountGBPTarget.toFixed(0)}\nDays remaining: ${daysLeft}${fund.amountGBPRaised === undefined ? '' : `\nRaised: GBP ${fund.amountGBPRaised.toFixed(2)}`}`, fund: { ...values, closesAt, cancelled: false } });
  }

  async endFund(chain: string, fund: ChatFund): Promise<void> {
    const userId = await this.requireSender();
    if (!chain) throw new Error('Choose a chat.');
    if (!activeFund(fund)) throw new Error('The fund has already ended.');
    await this.requireFundAdmin(userId);
    await this.checkSender(userId);
    await this.createMessage(userId, { chain, text: `Ended fund: ${fund.description.slice(0, 200)}`,
      fund: { closesAt: Date.now() - 1 } });
  }

  async cancelFund(chain: string, fund: ChatFund): Promise<void> {
    const userId = await this.requireSender();
    if (!chain) throw new Error('Choose a chat.');
    await this.requireFundAdmin(userId);
    await this.checkSender(userId);
    await this.createMessage(userId, { chain, text: `Cancelled fund: ${fund.description.slice(0, 200)}`,
      fund: { cancelled: true } });
  }

  private async requireFundAdmin(userId: string): Promise<void> {
    const user = await this.auth.currentUser;
    const token = await user?.getIdTokenResult();
    if (user?.uid !== userId || token?.claims['sub'] !== userId || token?.claims['perrinnAdmin'] !== true) throw new Error('Admin permission is required to manage raised totals or cancel funds.');
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

  private async uploadImage(image: File, onProgress?: (percent: number | null) => void): Promise<{ timestamp: string; url: string }> {
    const error = chatImageError(image);
    if (error) throw new Error(error);
    const timestamp = String(Date.now());
    const path = `images/${timestamp}-${image.name.replace(/[^\w.-]/g, '_')}`;
    const ref = runInInjectionContext(this.injector, () => this.storage.ref(path));
    onProgress?.(0);
    const task = runInInjectionContext(this.injector, () => ref.put(image));
    const progress = onProgress ? runInInjectionContext(this.injector, () => task.percentageChanges().subscribe({
      next: percent => { if (typeof percent === 'number' && Number.isFinite(percent)) onProgress(Math.max(0, Math.min(100, Math.round(percent)))); },
      error: () => { /* The awaited task reports upload failures to the sender. */ }
    })) : undefined;
    try {
      await task;
      progress?.unsubscribe();
      onProgress?.(null);
      const url = await firstValueFrom(runInInjectionContext(this.injector, () => ref.getDownloadURL()));
      return { timestamp, url };
    } finally { progress?.unsubscribe(); }
  }
}
