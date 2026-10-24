import { EnvironmentInjector, Injectable, runInInjectionContext } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import { BehaviorSubject, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import { ProfileFeed, ProfileRecord } from './profileModel';
export interface ProfilePageState {
    items: ProfileRecord[];
    loading: boolean;
    error: boolean;
    hasMore: boolean;
}
type Cursor = firebase.firestore.QueryDocumentSnapshot<ProfileRecord>;
interface Page {
    subscription?: Subscription;
    docs: Cursor[];
    boundary: string;
    ready: boolean;
}
// Each explicit action attaches one page-size + 1 listener (30 rows, or 120 for History).
// A changed page boundary releases later pages; no automatic scan/refill occurs.
export class ProfilePageSession {
    private pages: Page[] = [];
    private closed = false;
    private failed = false;
    private subject = new BehaviorSubject<ProfilePageState>({ items: [], loading: false, error: false, hasMore: true });
    readonly state = this.subject.asObservable();
    get current() { return this.subject.value; }
    constructor(private listen: (cursor: Cursor | undefined, next: (docs: Cursor[]) => void, error: () => void) => Subscription, readonly pageSize = 30) {
        if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 120) throw new Error('Invalid profile page size');
    }
    loadMore() {
        if (this.closed || this.current.loading || (!this.current.hasMore && !this.current.error))
            return;
        const index = this.pages.length;
        const cursor = this.pages[index - 1]?.docs[this.pageSize - 1];
        const page: Page = { docs: [], boundary: '', ready: false };
        this.pages.push(page);
        this.failed = false;
        this.subject.next({ ...this.current, loading: true, error: false });
        page.subscription = this.listen(cursor, docs => {
            if (this.closed || this.pages[index] !== page)
                return;
            const boundary = docs.slice(0, this.pageSize).map(doc => `${doc.id}:${JSON.stringify(doc.data().serverTimestamp)}`).join('|') + ':' + (docs.length > this.pageSize);
            if (boundary !== page.boundary) {
                this.pages.splice(index + 1).forEach(later => later.subscription?.unsubscribe());
                this.failed = false;
            }
            page.docs = docs;
            page.ready = true;
            page.boundary = boundary;
            this.publish();
        }, () => {
            if (this.closed || this.pages[index] !== page)
                return;
            this.pages.splice(index).forEach(failed => failed.subscription?.unsubscribe());
            this.failed = true;
            this.publish();
        });
        if (this.closed || this.pages[index] !== page)
            page.subscription.unsubscribe();
    }
    private publish() {
        const unique = new Map<string, ProfileRecord>();
        this.pages.forEach(page => page.docs.slice(0, this.pageSize).forEach(doc => unique.set(doc.id, { ...doc.data(), id: doc.id })));
        const last = this.pages[this.pages.length - 1];
        this.subject.next({ items: [...unique.values()], loading: this.pages.some(page => !page.ready), error: this.failed, hasMore: !last || last.docs.length > this.pageSize });
    }
    destroy() {
        this.closed = true;
        this.pages.forEach(page => page.subscription?.unsubscribe());
        this.pages = [];
        this.subject.complete();
    }
}
@Injectable({ providedIn: 'root' })
export class ProfileFeedService {
    constructor(private afs: AngularFirestore, private injector: EnvironmentInjector) { }
    user(userId: string) {
        return runInInjectionContext(this.injector, () => this.afs.collection<ProfileRecord>('PERRINNMessages', ref => ref
            .where('user', '==', userId).where('verified', '==', true).orderBy('serverTimestamp', 'desc').limit(1)).valueChanges().pipe(map(rows => rows[0] || null)));
    }
    create(userId: string, feed: ProfileFeed) {
        const pageSize = feed === 'history' ? 120 : 30;
        return new ProfilePageSession((cursor, next, error) => runInInjectionContext(this.injector, () => this.afs.collection<ProfileRecord>('PERRINNMessages', ref => {
            let query = ref.where(feed === 'inbox' ? 'recipientList' : 'user', feed === 'inbox' ? 'array-contains-any' : '==', feed === 'inbox' ? [userId] : userId)
                .where('verified', '==', true);
            if (feed === 'inbox')
                query = query.where('lastMessage', '==', true);
            if (feed === 'history')
                query = query.where('userChain.newMonth', '==', true);
            query = query.orderBy('serverTimestamp', 'desc').limit(pageSize + 1);
            if (cursor)
                query = query.startAfter(cursor);
            return query;
        }).snapshotChanges().subscribe({ next: rows => next(rows.map(row => row.payload.doc)), error })), pageSize);
    }
}
