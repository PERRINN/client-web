import { Component, EnvironmentInjector, OnDestroy, OnInit, runInInjectionContext } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Router } from '@angular/router';
import { Observable, Subscription, combineLatest, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { UserInterfaceService } from '../../userInterface.service';

interface HomeMessage {
  id: string;
  [key: string]: any;
}

interface HomeVisitor {
  id: string;
  name: string;
  imageUrl: string;
  updatedAt: number;
}

@Component({
  selector: 'prototype-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
  standalone: false
})
export class HomeComponent implements OnInit, OnDestroy {
  images: HomeMessage[] = [];
  events: HomeMessage[] = [];
  visitors: HomeVisitor[] = [];
  loadingImages = true;
  loadingEvents = true;
  loadingVisitors = true;
  imageError = false;
  eventError = false;
  visitorError = false;
  private subscriptions = new Subscription();

  constructor(
    private afs: AngularFirestore,
    private injector: EnvironmentInjector,
    public UI: UserInterfaceService,
    public router: Router
  ) {}

  ngOnInit() {
    this.subscribeToImages();
    this.subscribeToEvents();
    this.subscribeToVisitors();
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
  }

  private subscribeToImages() {
    const images = runInInjectionContext(this.injector, () => this.afs.collection<HomeMessage>('PERRINNMessages', ref =>
      ref.where('verified', '==', true).orderBy('chatImageTimestamp', 'desc').limit(50)
    ).snapshotChanges().pipe(map(rows => rows.map(row => ({ id: row.payload.doc.id, ...row.payload.doc.data() } as HomeMessage)))));
    this.subscriptions.add(images.subscribe({
      next: rows => {
        this.images = rows.filter(row => row.chatImageUrlMedium || row.chatImageUrlThumb || row.chatImageUrlOriginal);
        this.loadingImages = false;
      },
      error: () => { this.imageError = true; this.loadingImages = false; }
    }));
  }

  private subscribeToEvents() {
    const events = runInInjectionContext(this.injector, () => this.afs.collection<HomeMessage>('PERRINNMessages', ref =>
      ref.where('lastMessage', '==', true)
        .where('verified', '==', true)
        .orderBy('eventDateEnd')
        .where('eventDateEnd', '>', Date.now())
        .limit(10)
    ).snapshotChanges().pipe(map(rows => rows.map(row => ({ id: row.payload.doc.id, ...row.payload.doc.data() } as HomeMessage)))));
    this.subscriptions.add(events.subscribe({
      next: rows => { this.events = rows; this.loadingEvents = false; },
      error: () => { this.eventError = true; this.loadingEvents = false; }
    }));
  }

  private subscribeToVisitors() {
    const recentReads = runInInjectionContext(this.injector, () => this.afs.collectionGroup('chats', ref =>
      ref.orderBy('updatedAt', 'desc').limit(100)
    ).snapshotChanges().pipe(
      map(rows => {
        const newestByUser = new Map<string, { id: string; updatedAt: number }>();
        rows.forEach(row => {
          const userId = row.payload.doc.ref.parent.parent?.id;
          const data = row.payload.doc.data() as any;
          const updatedAt = this.toMillis(data.updatedAt) || this.toMillis(data.serverTimestamp);
          if (userId && userId !== this.UI.currentUser && updatedAt && !newestByUser.has(userId)) {
            newestByUser.set(userId, { id: userId, updatedAt });
          }
        });
        return Array.from(newestByUser.values()).slice(0, 5);
      }),
      switchMap(users => {
        if (!users.length) return of([] as HomeVisitor[]);
        const profiles: Observable<any[]>[] = users.map(user => runInInjectionContext(this.injector, () =>
          this.afs.collection('PERRINNMessages', ref => ref.where('user', '==', user.id)
            .where('verified', '==', true).orderBy('serverTimestamp', 'desc').limit(1))
            .valueChanges().pipe(catchError(() => of([])))
        ));
        return combineLatest(profiles).pipe(map(rows => rows.flatMap((profileRows, index) => {
          const profile = profileRows[0] as any;
          if (!profile) return [];
          return [{
            id: users[index].id,
            name: profile.name || 'Team member',
            imageUrl: profile.imageUrlThumbUser || profile.imageUrlUser || '',
            updatedAt: users[index].updatedAt
          }];
        })));
      })
    ));
    this.subscriptions.add(recentReads.subscribe({
      next: rows => { this.visitors = rows; this.loadingVisitors = false; },
      error: () => { this.visitorError = true; this.loadingVisitors = false; }
    }));
  }

  get imageTiles(): HomeMessage[] {
    return this.images.slice(0, 25);
  }

  get upcomingEvents(): HomeMessage[] {
    return this.events.filter(event => Number(event.eventDateEnd) > this.UI.nowSeconds * 1000).slice(0, 4);
  }

  imageUrl(message: HomeMessage): string {
    return message.chatImageUrlMedium || message.chatImageUrlThumb || message.chatImageUrlOriginal || '';
  }

  openImage(message: HomeMessage) {
    this.UI.showFullScreenImage(message.chatImageUrlOriginal || this.imageUrl(message));
  }

  openChat(chain: string) {
    if (chain) this.router.navigate(['/chat', chain]);
  }

  openProfile(userId: string) {
    this.router.navigate(['/profile', userId]);
  }

  timeAgo(timestamp: number): string {
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  private toMillis(value: any): number {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    return 0;
  }
}
