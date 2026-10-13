import { EnvironmentInjector, Injectable, runInInjectionContext } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import { Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

export interface HomeMessage {
  id: string;
  text?: string;
  chain?: string;
  chatImageUrlMedium?: string;
  chatImageUrlThumb?: string;
  chatImageUrlOriginal?: string;
  chatProfileImageUrlThumb?: string;
  chatProfileImageUrlMedium?: string;
  chatSubject?: string;
  eventDescription?: string;
  eventDateStart?: number;
  eventDateEnd?: number;
  eventDuration?: number;
}

@Injectable({ providedIn: 'root' })
export class HomeFeedService {
  constructor(private afs: AngularFirestore, private injector: EnvironmentInjector) {}

  images(): Observable<HomeMessage[]> {
    return runInInjectionContext(this.injector, () =>
      this.afs.collection<HomeMessage>('PERRINNMessages', ref =>
        ref.where('verified', '==', true).orderBy('chatImageTimestamp', 'desc').limit(50)
      ).snapshotChanges().pipe(map(rows => rows
        .map(row => ({ ...row.payload.doc.data(), id: row.payload.doc.id }))
        .filter(row => row.chatImageUrlMedium || row.chatImageUrlThumb || row.chatImageUrlOriginal)
        .slice(0, 25)))
    );
  }

  events(): Observable<HomeMessage[]> {
    return this.eventPage(Date.now());
  }

  upcomingEvents(events: HomeMessage[], now: number): HomeMessage[] {
    return events.filter(event => Number(event.eventDateEnd) > now)
      .sort((a, b) => Number(a.eventDateStart || 0) - Number(b.eventDateStart || 0))
      .slice(0, 4);
  }

  eventNotices(events: HomeMessage[], now: number): HomeMessage[] {
    const eligible = events.filter(event => {
      const start = Number(event.eventDateStart);
      const end = Number(event.eventDateEnd);
      return event.chain && Number.isFinite(start) && start > 0
        && Number.isFinite(end) && end > start && end > now;
    }).sort((a, b) => Number(a.eventDateStart) - Number(b.eventDateStart));
    // Select from the full loaded feed: ongoing events must not hide the next start.
    const active = eligible.find(event => Number(event.eventDateStart) <= now);
    const next = eligible.find(event => Number(event.eventDateStart) > now
      && Number(event.eventDateStart) - now <= 3600000);
    return [active, next].filter((event): event is HomeMessage => !!event);
  }

  // Keep the existing end-date query/index and start-date display order. Traverse
  // bounded live pages so a long event cannot hide an earlier-starting event.
  private eventPage(now: number, cursor?: firebase.firestore.QueryDocumentSnapshot<HomeMessage>): Observable<HomeMessage[]> {
    const pageSize = 50;
    return runInInjectionContext(this.injector, () =>
      this.afs.collection<HomeMessage>('PERRINNMessages', ref => {
        let query = ref.where('lastMessage', '==', true).where('verified', '==', true)
          .orderBy('eventDateEnd').where('eventDateEnd', '>', now).limit(pageSize);
        if (cursor) query = query.startAfter(cursor);
        return query;
      }).snapshotChanges().pipe(switchMap(rows => {
        const page = rows.map(row => ({ ...row.payload.doc.data(), id: row.payload.doc.id }));
        return rows.length < pageSize ? of(page) : this.eventPage(now, rows[rows.length - 1].payload.doc)
          .pipe(map(nextPage => [...page, ...nextPage]));
      }))
    );
  }
}
