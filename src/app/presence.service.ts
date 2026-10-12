import { EnvironmentInjector, Injectable, runInInjectionContext } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Timestamp, serverTimestamp } from 'firebase/firestore';
import { Observable, Subscription, combineLatest, from, fromEvent, merge, of, timer } from 'rxjs';
import { catchError, distinctUntilChanged, exhaustMap, filter, map, shareReplay, switchMap } from 'rxjs/operators';

interface PresenceRecord {
  lastActiveAt: Timestamp;
}

interface PresenceProfile {
  name?: string;
  imageUrlThumbUser?: string;
  imageUrlMedium?: string;
  imageUrlOriginal?: string;
}

export interface RecentVisitor {
  id: string;
  name: string;
  imageUrl: string;
  updatedAt: number;
}

@Injectable({ providedIn: 'root' })
export class PresenceService {
  private readonly updateInterval = 5 * 60 * 1000;

  constructor(
    private auth: AngularFireAuth,
    private afs: AngularFirestore,
    private injector: EnvironmentInjector
  ) {}

  // The app shell owns this subscription; use actual Auth, never prototype overrides.
  trackActivity(): Subscription {
    return runInInjectionContext(this.injector, () => this.auth.authState.pipe(
      map(user => user?.uid || null),
      distinctUntilChanged(),
      switchMap(userId => {
        if (!userId) return of(null);
        let lastAttempt = 0;
        return merge(
          timer(0, this.updateInterval),
          fromEvent(document, 'visibilitychange'),
          fromEvent(window, 'online')
        ).pipe(
          filter(() => !document.hidden && navigator.onLine),
          filter(() => Date.now() - lastAttempt >= this.updateInterval),
          exhaustMap(() => {
            lastAttempt = Date.now();
            return from(runInInjectionContext(this.injector, () =>
              this.afs.doc(`userPresence/${userId}`).set({ lastActiveAt: serverTimestamp() })
            )).pipe(catchError(() => {
              // Retry on the next visible heartbeat without interrupting navigation.
              lastAttempt = 0;
              console.warn('Presence update failed; will retry when the app is visible.');
              return of(null);
            }));
          })
        );
      })
    ).subscribe());
  }

  lastActiveAt(userId: string): Observable<number> {
    return runInInjectionContext(this.injector, () =>
      this.afs.doc<PresenceRecord>(`userPresence/${userId}`).valueChanges().pipe(
        map(record => record?.lastActiveAt?.toMillis() || 0)
      )
    );
  }

  recentVisitors(): Observable<RecentVisitor[]> {
    const records = runInInjectionContext(this.injector, () =>
      this.afs.collection<PresenceRecord>('userPresence', ref =>
        ref.orderBy('lastActiveAt', 'desc').limit(11)
      ).snapshotChanges().pipe(
        map(rows => rows.map(row => ({
          id: row.payload.doc.id,
          updatedAt: row.payload.doc.data().lastActiveAt?.toMillis() || 0
        }))),
        shareReplay({ bufferSize: 1, refCount: true })
      )
    );
    const currentUser = runInInjectionContext(this.injector, () => this.auth.authState.pipe(
      map(user => user?.uid || null),
      distinctUntilChanged()
    ));
    // Fetch one extra record so excluding the viewer still leaves up to ten users.
    const presence = combineLatest([records, currentUser]).pipe(
      map(([visitors, userId]) => visitors.filter(visitor => visitor.id !== userId).slice(0, 10)),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    const profiles = presence.pipe(
      map(visitors => visitors.map(visitor => visitor.id).sort()),
      distinctUntilChanged((previous, current) => previous.join('|') === current.join('|')),
      switchMap(ids => {
          if (!ids.length) return of([] as RecentVisitor[]);
          return combineLatest(ids.map(id =>
            runInInjectionContext(this.injector, () => this.afs.collection<PresenceProfile>('PERRINNMessages', ref =>
              ref.where('user', '==', id).where('verified', '==', true)
                .orderBy('serverTimestamp', 'desc').limit(1)
            ).valueChanges()).pipe(
              map(rows => this.toVisitor({ id, updatedAt: 0 }, rows[0])),
              catchError(() => of(this.toVisitor({ id, updatedAt: 0 })))
            )
          ));
      })
    );
    return combineLatest([presence, profiles]).pipe(map(([visitors, rows]) =>
      visitors.map(visitor => ({
        ...(rows.find(row => row.id === visitor.id) || this.toVisitor(visitor)),
        ...visitor
      }))
    ));
  }

  private toVisitor(visitor: { id: string; updatedAt: number }, profile?: PresenceProfile): RecentVisitor {
    return {
      ...visitor,
      name: profile?.name || 'Team member',
      imageUrl: profile?.imageUrlThumbUser || profile?.imageUrlMedium || profile?.imageUrlOriginal || ''
    };
  }
}
