import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class MobileOrientationService implements OnDestroy {
  private readonly touchDevice = window.matchMedia('(pointer: coarse)');
  private readonly blocked = new BehaviorSubject(false);
  readonly landscapeBlocked$ = this.blocked.asObservable();

  constructor() {
    this.update();
    this.requestLock();
    this.touchDevice.addEventListener('change', this.update);
    screen.orientation?.addEventListener('change', this.update);
    window.addEventListener('orientationchange', this.update);
    window.addEventListener('resize', this.update);
    document.addEventListener('fullscreenchange', this.requestLock);
  }

  // Use physical screen orientation: a portrait keyboard can make the viewport wider than tall.
  private readonly update = (): void => {
    const angle = (window as Window & { orientation?: number }).orientation;
    const landscape = screen.orientation?.type
      ? screen.orientation.type.startsWith('landscape')
      : typeof angle === 'number' ? Math.abs(angle) === 90 : screen.width > screen.height;
    const blocked = this.touchDevice.matches && landscape;
    if (blocked !== this.blocked.value) this.blocked.next(blocked);
  };

  private readonly requestLock = (): void => {
    if (!this.touchDevice.matches) return;
    const orientation = screen.orientation as ScreenOrientation & { lock?: (mode: string) => Promise<void> };
    // Browsers can require fullscreen or omit locking; the modal remains the fallback.
    try { void orientation?.lock?.('portrait').catch(() => {}); } catch { /* Unsupported lock. */ }
  };

  ngOnDestroy(): void {
    this.touchDevice.removeEventListener('change', this.update);
    screen.orientation?.removeEventListener('change', this.update);
    window.removeEventListener('orientationchange', this.update);
    window.removeEventListener('resize', this.update);
    document.removeEventListener('fullscreenchange', this.requestLock);
    this.blocked.complete();
  }
}
