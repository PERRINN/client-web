import { EnvironmentInjector, Injectable, runInInjectionContext } from '@angular/core';
import { AngularFirestore, DocumentChangeAction } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { map, switchMap, tap } from 'rxjs/operators';
import { ActivityConversation } from './messageActivity.service';

export interface SidebarConversation extends ActivityConversation {
  name?: string;
  imageUrlThumbUser?: string;
}

@Injectable({ providedIn: 'root' })
export class SidebarConversationsService {
  private latestHumanState = new BehaviorSubject<{ status: 'loading' | 'ready' | 'error'; chain: string }>({ status: 'loading', chain: '' });
  readonly latestHuman = this.latestHumanState.asObservable();

  constructor(private afs: AngularFirestore, private injector: EnvironmentInjector) {}

  automatic(): Observable<SidebarConversation[]> {
    return runInInjectionContext(this.injector, () =>
      this.afs.collection<SidebarConversation>('PERRINNMessages', ref => ref
        .where('lastMessage', '==', true).where('verified', '==', true)
        .where('isBackendMessage', '==', true)
        .orderBy('serverTimestamp', 'desc').limit(15)
      ).valueChanges()
    );
  }

  human(limit: number): Observable<DocumentChangeAction<SidebarConversation>[]> {
    return this.humanPage(limit).pipe(tap({
      next: rows => this.latestHumanState.next({ status: 'ready', chain: rows[0]?.payload.doc.data().chain || '' }),
      error: () => this.latestHumanState.next({ status: 'error', chain: '' })
    }));
  }

  // Equality/inequality queries omit legacy records without the flag. Scan live
  // bounded pages instead, keeping those records and filling the requested count
  // even when automatic activity occupies the newest page.
  private humanPage(remaining: number, cursor?: firebase.firestore.QueryDocumentSnapshot<SidebarConversation>): Observable<DocumentChangeAction<SidebarConversation>[]> {
    const pageSize = 30;
    return runInInjectionContext(this.injector, () =>
      this.afs.collection<SidebarConversation>('PERRINNMessages', ref => {
        let query = ref.where('lastMessage', '==', true).where('verified', '==', true)
          .orderBy('serverTimestamp', 'desc').limit(pageSize);
        if (cursor) query = query.startAfter(cursor);
        return query;
      }).snapshotChanges().pipe(switchMap(rows => {
        const humanRows = rows.filter(row => row.payload.doc.data().isBackendMessage !== true);
        if (humanRows.length >= remaining || rows.length < pageSize) return of(humanRows.slice(0, remaining));
        return this.humanPage(remaining - humanRows.length, rows[rows.length - 1].payload.doc)
          .pipe(map(next => [...humanRows, ...next]));
      }))
    );
  }
}
