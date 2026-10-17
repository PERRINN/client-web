import { ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { UserInterfaceService } from '../../userInterface.service';
import { HomeFeedService, HomeMessage } from '../../homeFeed.service';

@Component({
  selector: 'app-image-mosaic',
  templateUrl: './image-mosaic.component.html',
  styleUrls: ['./image-mosaic.component.css'],
  standalone: false
})
export class ImageMosaicComponent implements OnInit, OnDestroy {
  readonly mosaicVariants = [
    { id: 'editorial-mosaic', name: 'Editorial mosaic', description: 'One broad lead image anchors a compact supporting grid.' },
    { id: 'balanced-grid', name: 'Balanced grid', description: 'A regular image grid adapts its column count to the available width.' },
    { id: 'masonry-flow', name: 'Masonry flow', description: 'Images keep varied heights in a responsive column flow.' },
    { id: 'panorama-rail', name: 'Panorama rail', description: 'A wide feature image leads into a compact six-column image field.' },
    { id: 'staggered-collage', name: 'Staggered collage', description: 'Alternating tile sizes create a denser, varied rhythm.' }
  ];
  activeMosaic = 'editorial-mosaic';
  mosaicWidth = 1080;
  @ViewChild('frame') mosaicFrame?: ElementRef<HTMLElement>;
  @ViewChild('imageGrid') mosaicGrid?: ElementRef<HTMLElement>;
  private resizeStart: { x: number; width: number } | null = null;
  images: HomeMessage[] = [];
  loadingImages = true;
  imageError = false;
  private subscriptions = new Subscription();

  constructor(
    private feed: HomeFeedService,
    private changeDetector: ChangeDetectorRef,
    private route: ActivatedRoute,
    public UI: UserInterfaceService,
    public router: Router
  ) {}

  ngOnInit() {
    this.subscriptions.add(this.route.data.subscribe(data => {
      this.activeMosaic = data['mosaicId'] || 'editorial-mosaic';
    }));
    this.subscriptions.add(this.route.queryParamMap.subscribe(params => {
      const width = Number(params.get('width'));
      this.mosaicWidth = Number.isFinite(width) && width >= 320 && width <= 1440 ? Math.round(width) : this.savedMosaicWidth();
    }));
    this.subscribeToImages();
  }

  get activeMosaicName(): string {
    return this.mosaicVariants.find(variant => variant.id === this.activeMosaic)?.name || 'Image mosaic';
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

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
  }

  private subscribeToImages() {
    this.subscriptions.add(this.feed.images().subscribe({
      next: rows => {
        this.images = rows;
        this.loadingImages = false;
        this.changeDetector.markForCheck();
      },
      error: () => { this.imageError = true; this.loadingImages = false; this.changeDetector.markForCheck(); }
    }));
  }

  get imageTiles(): HomeMessage[] {
    return this.images.slice(0, 25);
  }

  imageUrl(message: HomeMessage): string {
    return message.chatImageUrlMedium || message.chatImageUrlThumb || message.chatImageUrlOriginal || '';
  }

  openImage(message: HomeMessage) {
    this.UI.showFullScreenImage(message.chatImageUrlOriginal || this.imageUrl(message), { chain: message.chain, id: message.id, name: 'Shared image' });
  }

}
