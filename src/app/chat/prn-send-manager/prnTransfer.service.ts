import { EnvironmentInjector, Injectable, runInInjectionContext } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { firstValueFrom } from 'rxjs';
import { serverTimestamp } from 'firebase/firestore';
import { UserInterfaceService } from '../../userInterface.service';
import { ChatDataService } from '../chatData.service';
import { reviewTransfer, transferMessage, TransferContext, TransferDraft, TransferMember, TransferReview } from './prnTransfer';

interface TransferFields { user?: string | null; amount?: number; code?: string | null; reference?: string; }
interface TransferRecord {
  user?: string; name?: string; imageUrlThumbUser?: string; verified?: boolean;
  wallet?: { balance?: number }; userCurrency?: string;
  recipientList?: string[]; recipients?: Record<string, { name?: string }>;
  chain?: string; transactionOut?: TransferFields; transactionPending?: TransferFields;
}

@Injectable({ providedIn: 'root' })
export class PrnTransferService {
  private submitting = new Set<string>();
  constructor(private afs: AngularFirestore, private auth: AngularFireAuth, private injector: EnvironmentInjector,
    private UI: UserInterfaceService, private data: ChatDataService) {}

  get context(): TransferContext | null {
    const profile = this.UI.currentUserLastMessageObj;
    return this.UI.currentUser && profile?.user === this.UI.currentUser ? this.contextFor(this.UI.currentUser, profile) : null;
  }

  private contextFor(userId: string, profile: TransferRecord): TransferContext {
    const currency = profile.userCurrency || '', rate = this.UI.PERRINNAdminLastMessageObj?.currencyList?.[currency]?.toCOIN;
    return { userId, name: profile.name || '', avatar: profile.imageUrlThumbUser || '',
      balance: typeof profile.wallet?.balance === 'number' ? profile.wallet.balance : NaN,
      currency, rate: typeof rate === 'number' ? rate : NaN };
  }

  private async sender(): Promise<string> {
    const user = await this.auth.currentUser;
    if (!user || user.uid !== this.UI.currentUser) throw new Error('Sign in to send PRN.');
    return user.uid;
  }

  private async freshReview(chain: string, draft: TransferDraft) {
    const userId = await this.sender();
    const [profiles, conversations] = await Promise.all([
      firstValueFrom(runInInjectionContext(this.injector, () => this.afs.collection<TransferRecord>('PERRINNMessages', ref => ref
        .where('user', '==', userId).where('verified', '==', true).orderBy('serverTimestamp', 'desc').limit(1)).get({ source: 'server' }))),
      firstValueFrom(runInInjectionContext(this.injector, () => this.afs.collection<TransferRecord>('PERRINNMessages', ref => ref
        .where('chain', '==', chain).orderBy('serverTimestamp', 'desc').limit(1)).get({ source: 'server' })))
    ]);
    if (await this.sender() !== userId) throw new Error('Your account changed. Review the transfer again.');
    const profile = profiles.docs[0]?.data(), chat = conversations.docs[0]?.data();
    if (!profile || profile.user !== userId) throw new Error('Your balance is unavailable. Try again.');
    if (!chat?.verified) throw new Error('The conversation is updating. Try again.');
    const members: TransferMember[] = (chat.recipientList || []).map(id => ({ id,
      name: id === userId ? profile.name || 'Sender' : chat.recipients?.[id]?.name || 'Contributor', avatarName: '', avatar: '' }));
    const context = this.contextFor(userId, profile);
    return { review: reviewTransfer(chain, draft, context, members), context };
  }

  async prepare(chain: string, draft: TransferDraft): Promise<TransferReview> {
    const { review } = await this.freshReview(chain, draft);
    return { ...review, messageId: this.afs.firestore.collection('PERRINNMessages').doc().id };
  }

  async submit(review: TransferReview): Promise<void> {
    if (this.submitting.has(review.messageId)) throw new Error('This transfer is already submitting.');
    this.submitting.add(review.messageId);
    try {
      if (await this.sender() !== review.userId) throw new Error('Your account changed. Review the transfer again.');
      const ref = this.afs.firestore.doc(`PERRINNMessages/${review.messageId}`);
      const message = transferMessage(review);
      // Reuse this document identity after uncertain network errors; never add a second transfer.
      const existing = await ref.get({ source: 'server' });
      if (existing.exists) {
        if (!this.matches(existing.data(), review)) throw new Error('Transfer status is unavailable.');
        this.data.acknowledgeSubmission(review.chain, review.userId, review.messageId); return;
      }
      const draft: TransferDraft = { mode: review.mode, recipient: review.recipient || '', amount: review.amount, code: review.code || '', reference: review.reference };
      const fresh = await this.freshReview(review.chain, draft);
      // Compare only reviewed values; balances may change provided they remain sufficient.
      if (Object.entries(fresh.review).some(([key, value]) => review[key as keyof TransferReview] !== value)) {
        throw new Error('Transfer details or currency rates changed. Go back and review again.');
      }
      await ref.set({ ...message, user: review.userId, name: fresh.context.name,
        imageUrlThumbUser: fresh.context.avatar, serverTimestamp: serverTimestamp() });
      this.data.acknowledgeSubmission(review.chain, review.userId, review.messageId);
    } finally { this.submitting.delete(review.messageId); }
  }

  private matches(record: TransferRecord | undefined, review: TransferReview): boolean {
    const fields = record?.[review.mode === 'direct' ? 'transactionOut' : 'transactionPending'];
    return record?.['user'] === review.userId && record?.['chain'] === review.chain && fields?.amount === review.prnAmount
      && (fields?.code || null) === review.code && fields?.reference === review.reference
      && (review.mode === 'pending' || fields?.user === review.recipient);
  }
}
