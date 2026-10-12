import { ChangeDetectorRef, Component, ElementRef, EnvironmentInjector, OnDestroy, OnInit, ViewChild, runInInjectionContext } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import { UserInterfaceService } from '../../userInterface.service';
import { PresenceService, RecentVisitor } from '../../presence.service';

interface HomeMessage {
  id: string;
  [key: string]: any;
}

@Component({
  selector: 'prototype-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
  standalone: false
})
export class HomeComponent implements OnInit, OnDestroy {
  readonly mosaicVariants = [
    { id: 'editorial-mosaic', name: 'Editorial mosaic', description: 'One broad lead image anchors a compact supporting grid.' },
    { id: 'balanced-grid', name: 'Balanced grid', description: 'A regular image grid adapts its column count to the available width.' },
    { id: 'masonry-flow', name: 'Masonry flow', description: 'Images keep varied heights in a responsive column flow.' },
    { id: 'panorama-rail', name: 'Panorama rail', description: 'A wide feature image leads into a compact six-column image field.' },
    { id: 'staggered-collage', name: 'Staggered collage', description: 'Alternating tile sizes create a denser, varied rhythm.' }
  ];
  activeMosaic = '';
  mosaicWidth = 1080;
  @ViewChild('frame') mosaicFrame?: ElementRef<HTMLElement>;
  @ViewChild('imageGrid') mosaicGrid?: ElementRef<HTMLElement>;
  private resizeStart: { x: number; width: number } | null = null;
  images: HomeMessage[] = [];
  events: HomeMessage[] = [];
  visitors: RecentVisitor[] = [];
  loadingImages = true;
  loadingEvents = true;
  loadingVisitors = true;
  imageError = false;
  eventError = false;
  visitorError = false;
  private subscriptions = new Subscription();
  private homePanelsSubscribed = false;

  constructor(
    private afs: AngularFirestore,
    private presence: PresenceService,
    private injector: EnvironmentInjector,
    private changeDetector: ChangeDetectorRef,
    private route: ActivatedRoute,
    public UI: UserInterfaceService,
    public router: Router
  ) {}

  ngOnInit() {
    this.subscriptions.add(this.route.data.subscribe(data => {
      this.activeMosaic = data['mosaicId'] || '';
      if (!this.activeMosaic) this.subscribeToHomePanels();
    }));
    this.subscriptions.add(this.route.queryParamMap.subscribe(params => {
      const width = Number(params.get('width'));
      this.mosaicWidth = Number.isFinite(width) && width >= 320 && width <= 1440 ? Math.round(width) : this.savedMosaicWidth();
    }));
    this.subscribeToImages();
  }

  get activeMosaicName(): string {
    return this.mosaicVariants.find(variant => variant.id === this.activeMosaic)?.name || 'Team dashboard';
  }

  get activeMosaicDescription(): string {
    return this.mosaicVariants.find(variant => variant.id === this.activeMosaic)?.description || '';
  }

  setMosaicWidth(value: number | string) {
    this.mosaicWidth = this.clampWidth(Number(value));
    this.saveMosaicWidth();
  }

  startResize(event: PointerEvent, frame: HTMLElement): void {
    event.preventDefault();
    this.resizeStart = { x: event.clientX, width: frame.getBoundingClientRect().width };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  resize(event: PointerEvent): void {
    if (this.resizeStart) this.mosaicWidth = this.clampWidth(this.resizeStart.width + event.clientX - this.resizeStart.x);
  }

  endResize(): void {
    if (!this.resizeStart) return;
    this.resizeStart = null;
    this.saveMosaicWidth();
  }

  resizeBy(frame: HTMLElement, amount: number): void {
    this.mosaicWidth = this.clampWidth((this.mosaicWidth || frame.clientWidth) + amount);
    this.saveMosaicWidth();
  }

  get imageCoveragePercent(): number {
    const frame = this.mosaicFrame?.nativeElement;
    const grid = this.mosaicGrid?.nativeElement;
    if (!frame || !grid) return 0;
    const frameRect = frame.getBoundingClientRect();
    const frameArea = frameRect.width * frameRect.height;
    if (!frameArea) return 0;
    let imageArea = 0;
    grid.querySelectorAll<HTMLElement>('.image-tile').forEach(tile => {
      const rect = tile.getBoundingClientRect();
      const width = Math.max(0, Math.min(rect.right, frameRect.right) - Math.max(rect.left, frameRect.left));
      const height = Math.max(0, Math.min(rect.bottom, frameRect.bottom) - Math.max(rect.top, frameRect.top));
      imageArea += width * height;
    });
    return Math.round(imageArea / frameArea * 100);
  }

  private clampWidth(width: number): number {
    return Math.round(Math.max(320, Math.min(1440, width)));
  }

  private saveMosaicWidth(): void {
    try { localStorage.setItem('home-mosaic-width', String(this.mosaicWidth)); } catch { /* Storage may be unavailable. */ }
    this.router.navigate([], { relativeTo: this.route, queryParams: { width: this.mosaicWidth }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  private savedMosaicWidth(): number {
    try {
      const width = Number(localStorage.getItem('home-mosaic-width'));
      return Number.isFinite(width) && width >= 320 && width <= 1440 ? Math.round(width) : 1080;
    } catch { return 1080; }
  }

  private subscribeToHomePanels(): void {
    if (this.homePanelsSubscribed) return;
    this.homePanelsSubscribed = true;
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
        this.changeDetector.markForCheck();
      },
      error: () => { this.imageError = true; this.loadingImages = false; this.changeDetector.markForCheck(); }
    }));
  }

  private subscribeToEvents() {
    const events = runInInjectionContext(this.injector, () => this.afs.collection<HomeMessage>('PERRINNMessages', ref =>
      ref.where('lastMessage', '==', true)
        .where('verified', '==', true)
        .orderBy('eventDateEnd')
        .where('eventDateEnd', '>', Date.now())
    ).snapshotChanges().pipe(map(rows => rows.map(row => ({ id: row.payload.doc.id, ...row.payload.doc.data() } as HomeMessage)))));
    this.subscriptions.add(events.subscribe({
      next: rows => { this.events = rows; this.loadingEvents = false; this.changeDetector.markForCheck(); },
      error: () => { this.eventError = true; this.loadingEvents = false; this.changeDetector.markForCheck(); }
    }));
  }

  private subscribeToVisitors() {
    this.subscriptions.add(this.presence.recentVisitors().subscribe({
      next: visitors => {
        this.visitors = visitors;
        this.visitorError = false;
        this.loadingVisitors = false;
        this.changeDetector.markForCheck();
      },
      error: error => {
        console.error('Home recent activity query failed', error);
        this.visitorError = true;
        this.loadingVisitors = false;
        this.changeDetector.markForCheck();
      }
    }));
  }

  get imageTiles(): HomeMessage[] {
    return this.images.slice(0, 25);
  }

  get upcomingEvents(): HomeMessage[] {
    return this.events
      .filter(event => Number(event.eventDateEnd) > this.UI.nowSeconds * 1000)
      .sort((a, b) => this.toMillis(a.eventDateStart) - this.toMillis(b.eventDateStart))
      .slice(0, 4);
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

  eventStartsIn(event: HomeMessage): string {
    const start = this.toMillis(event.eventDateStart);
    if (!start) return 'Start time unavailable';
    const remaining = start - this.UI.nowSeconds * 1000;
    if (remaining <= 0) return 'In progress';
    if (remaining < 60000) return 'In less than 1m';
    const minutes = Math.ceil(remaining / 60000);
    if (minutes < 60) return `In ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `In ${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
    const days = Math.floor(hours / 24);
    return `In ${days}d${hours % 24 ? ` ${hours % 24}h` : ''}`;
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
