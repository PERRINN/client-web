import { imageAge } from './imageTime';
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ImageViewerService } from './imageViewer.service';

@Component({ selector: 'app-image-viewer', standalone: false, templateUrl: './image-viewer.component.html', styleUrls: ['./image-viewer.component.css'] })
export class ImageViewerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('dialog') dialog!: ElementRef<HTMLDialogElement>;
  postedAgo = '';
  postedDate = '';
  imageLoading = true;
  imageError = false;
  private src = '';
  private opener?: HTMLElement;
  touch?: { x: number; y: number };
  private subscriptions = new Subscription();
  constructor(public viewer: ImageViewerService, private router: Router) {}
  ngAfterViewInit(): void {
    this.subscriptions.add(this.viewer.changed.subscribe(() => this.sync()));
    this.subscriptions.add(this.router.events.subscribe(event => { if (event instanceof NavigationStart) this.viewer.close(); }));
    this.sync();
  }
  private sync(): void {
    const dialog = this.dialog.nativeElement;
    if (this.viewer.opened) {
      const postedAt = this.viewer.current?.postedAt || 0;
      this.postedAgo = imageAge(postedAt);
      this.postedDate = this.postedAgo ? new Date(postedAt).toISOString() : '';
      if (this.src !== this.viewer.current?.src) { this.src = this.viewer.current?.src || ''; this.imageLoading = true; this.imageError = false; }
      if (!dialog.open) { this.opener = document.activeElement as HTMLElement; dialog.showModal(); }
    } else if (dialog.open) dialog.close();
  }
  closed(): void {
    // Ignore a queued close event if another image has already opened the dialog.
    if (this.dialog.nativeElement.open) return;
    if (this.viewer.opened) this.viewer.close();
    this.src = ''; this.touch = undefined;
    if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
  }
  keydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); void this.viewer.move(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }
  touchStart(event: TouchEvent): void {
    this.touch = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : undefined;
  }
  touchEnd(event: TouchEvent): void {
    if (this.touch && event.changedTouches.length === 1) {
      const dx = event.changedTouches[0].clientX - this.touch.x, dy = event.changedTouches[0].clientY - this.touch.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) void this.viewer.move(dx < 0 ? 1 : -1);
    }
    this.touch = undefined;
  }
  goToThread(): void {
    const chain = this.viewer.current?.chain;
    if (!chain) return;
    this.viewer.close(); void this.router.navigate(['/chat', chain]);
  }
  retryImage(): void { this.imageError = false; this.imageLoading = true; }
  ngOnDestroy(): void { this.subscriptions.unsubscribe(); this.viewer.close(); }
}
