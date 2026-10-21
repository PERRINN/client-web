import { EnvironmentInjector, Injectable, runInInjectionContext } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import { BehaviorSubject, Subscription } from 'rxjs';
import { chatFund, ChatFund, FundRecord, activeFund, fundClock } from './chat/chat-fund/chatFund';

export interface FundItem { id: string; chain: string; subject: string; image: string; fund: ChatFund; }
interface FundMessage extends FundRecord { chain?: string; chatSubject?: string; chatProfileImageUrlThumb?: string; chatProfileImageUrlMedium?: string; }
export interface FundFeedState { items: FundItem[]; loading: boolean; error: boolean; hasMore: boolean; }
type Cursor = firebase.firestore.QueryDocumentSnapshot<FundMessage>;
interface Page { subscription: Subscription; rows: FundItem[]; cursor?: Cursor; hasMore: boolean; signature: string; }

@Injectable({ providedIn: 'root' })
export class FundFeedService {
  constructor(private afs: AngularFirestore, private injector: EnvironmentInjector) {}
  create(scope?: string, includeEnded = false, pageSize = 50): FundFeedSession {
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new Error('Invalid fund page size');
    return new FundFeedSession((cursor, receive, failed) => runInInjectionContext(this.injector, () =>
      this.afs.collection<FundMessage>('PERRINNMessages', ref => {
        let query = ref.where('lastMessage', '==', true).where('verified', '==', true);
        if (scope) query = query.where('recipientList', 'array-contains', scope);
        if (!includeEnded) query = query.where('fund.cancelled', '==', false);
        query = query.where('fund.closesAt', '>', includeEnded ? 0 : Date.now()).orderBy('fund.closesAt', includeEnded ? 'desc' : 'asc');
        if (cursor) query = query.startAfter(cursor);
        return query.limit(pageSize + 1);
      }).snapshotChanges().subscribe({ next: rows => receive(rows.map(row => row.payload.doc)), error: failed })
    ), includeEnded, pageSize);
  }
}

// One query per explicit load (up to 51 results). Loaded pages stay live; a changed
// earlier page discards later pages so a moved cursor cannot retain stale funds.
// Local time updates never requery. Destroy/scope changes release every listener.
export class FundFeedSession {
  private readonly subject = new BehaviorSubject<FundFeedState>({ items: [], loading: false, error: false, hasMore: true });
  readonly state = this.subject.asObservable();
  private pages: Page[] = [];
  private clock?: Subscription;
  private destroyed = false;
  private pending = false;
  private failed = false;
  constructor(private watch: (cursor: Cursor | undefined, receive: (rows: Cursor[]) => void, failed: () => void) => Subscription,
    private includeEnded: boolean, private pageSize: number) {}
  get current(): FundFeedState { return this.subject.value; }
  loadMore(): void {
    if (this.destroyed || this.pending || (!this.current.hasMore && !this.current.error)) return;
    this.pending = true; this.failed = false;
    const index = this.pages.length;
    const page: Page = { subscription: new Subscription(), rows: [], hasMore: false, signature: '' };
    this.pages.push(page);
    this.subject.next({ ...this.current, loading: true, error: false });
    page.subscription.add(this.watch(index ? this.pages[index - 1].cursor : undefined, rows => {
      if (this.destroyed || this.pages[index] !== page) return;
      const signature = JSON.stringify(rows.map(doc => {
        const record = doc.data(), fund = record.fund;
        return [doc.id, record.chain, record.chatSubject, fund?.closesAt, fund?.cancelled, fund?.description, fund?.amountGBPTarget,
          fund?.amountGBPRaised, record.chatProfileImageUrlThumb, record.chatProfileImageUrlMedium];
      }));
      if (signature !== page.signature) {
        this.pages.splice(index + 1).forEach(old => old.subscription.unsubscribe());
        page.signature = signature;
      }
      page.rows = rows.slice(0, this.pageSize).flatMap(doc => {
        const record = doc.data(), fund = chatFund(record);
        return fund && record.chain ? [{ id: doc.id, chain: record.chain, subject: typeof record.chatSubject === 'string' ? record.chatSubject.trim() : '',
          image: record.chatProfileImageUrlThumb || record.chatProfileImageUrlMedium || '', fund }] : [];
      });
      this.pending = false; this.failed = false;
      page.cursor = rows[Math.min(rows.length, this.pageSize) - 1];
      page.hasMore = rows.length > this.pageSize;
      this.restartClock();
    }, () => {
      if (this.destroyed || this.pages[index] !== page) return;
      this.pending = false; this.failed = true;
      this.pages.splice(index).forEach(old => old.subscription.unsubscribe());
      this.subject.next({ ...this.current, loading: false, error: true, hasMore: true });
    }));
  }
  private restartClock(): void {
    this.clock?.unsubscribe();
    const rows = [...new Map(this.pages.flatMap(page => page.rows).map(row => [row.chain, row])).values()];
    this.clock = fundClock(rows.map(row => row.fund)).subscribe(now => this.subject.next({
      items: rows.filter(row => this.includeEnded || activeFund(row.fund, now)), loading: this.pending, error: this.failed,
      hasMore: this.pending ? this.current.hasMore : this.pages.at(-1)?.hasMore || false
    }));
  }
  destroy(): void {
    this.destroyed = true; this.clock?.unsubscribe();
    this.pages.forEach(page => page.subscription.unsubscribe()); this.subject.complete();
  }
}
