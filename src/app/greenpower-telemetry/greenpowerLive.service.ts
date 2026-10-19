import { EnvironmentInjector, Injectable, runInInjectionContext } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable, combineLatest, fromEvent, merge, of, timer } from 'rxjs';
import { catchError, distinctUntilChanged, map, shareReplay, switchMap } from 'rxjs/operators';
import { GreenpowerSample, londonDay } from './greenpowerData';

export const GREENPOWER_LIVE_TIMEOUT = 2 * 60 * 1000;
export function isGreenpowerLive(sample: GreenpowerSample | undefined, now: number): boolean {
  return sample?.source === '424-phone' && Number.isFinite(sample.receivedAt)
    && sample.receivedAt <= now && now - sample.receivedAt < GREENPOWER_LIVE_TIMEOUT;
}

@Injectable({ providedIn: 'root' })
export class GreenpowerLiveService {
  readonly live$: Observable<boolean>;

  constructor(auth: AngularFireAuth, firestore: AngularFirestore, injector: EnvironmentInjector) {
    // One shared metadata listener, never the page's chart/history loader.
    this.live$ = runInInjectionContext(injector, () => auth.authState.pipe(
      map(user => user?.uid || ''), distinctUntilChanged(),
      switchMap(uid => {
        if (!uid) return of(false);
        const clock = merge(timer(0, 1000), fromEvent(document, 'visibilitychange'),
          fromEvent(window, 'online'), fromEvent(window, 'offline')).pipe(
          map(() => ({ now: Date.now(), online: navigator.onLine })),
          shareReplay({ bufferSize: 1, refCount: true })
        );
        return clock.pipe(
          map(({ now }) => londonDay(now)), distinctUntilChanged(),
          switchMap(day => {
            const latest = new Observable<GreenpowerSample | undefined>(subscriber => {
              subscriber.next(undefined);
              return firestore.firestore.doc(`GreenpowerTelemetry/424/days/${day}`).onSnapshot(
                { includeMetadataChanges: true }, snapshot => {
                  subscriber.next(snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites
                    ? undefined : snapshot.data()?.['latest']);
                }, error => subscriber.error(error));
            }).pipe(catchError(() => of(undefined)));
            return combineLatest([latest, clock]).pipe(
              // A receipt can be newer than the last timer emission. Compare at
              // evaluation time so every incoming sample does not briefly go dark.
              map(([sample, { online }]) => online && isGreenpowerLive(sample, Date.now()))
            );
          })
        );
      }),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    ));
  }
}
