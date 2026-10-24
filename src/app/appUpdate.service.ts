import { Injectable, OnDestroy } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationSkipped, NavigationStart, PRIMARY_OUTLET, Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { fromEvent, interval, Subscription } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AppUpdateService implements OnDestroy {
  private readonly subscriptions = new Subscription();
  private started = false;
  private navigating = false;
  private ready = false;
  private reloading = false;
  private checking = false;

  constructor(private updates: SwUpdate, private router: Router) {}

  start(): void {
    if (this.started || !this.updates.isEnabled) return;
    this.started = true;
    this.subscriptions.add(this.router.events.subscribe(event => {
      if (event instanceof NavigationStart) this.navigating = true;
      if (event instanceof NavigationEnd || event instanceof NavigationCancel
        || event instanceof NavigationError || event instanceof NavigationSkipped) {
        this.navigating = false;
      }
      // Wait for a successful destination, including initial navigation and redirects.
      if (event instanceof NavigationEnd) this.reloadIfSafe();
    }));
    this.subscriptions.add(this.updates.versionUpdates.subscribe(event => {
      if (event.type !== 'VERSION_READY') return;
      this.ready = true;
      this.reloadIfSafe();
    }));
    this.subscriptions.add(interval(30000).subscribe(() => void this.check()));
    this.subscriptions.add(fromEvent(document, 'visibilitychange').subscribe(() => {
      if (!document.hidden) void this.check();
    }));
  }

  private reloadIfSafe(): void {
    if (!this.ready || this.reloading || this.navigating || !this.router.navigated) return;
    const segments = this.router.parseUrl(this.router.url).root.children[PRIMARY_OUTLET]?.segments;
    if (segments?.[0]?.path === '424-greenpower-dashboard') return;
    this.reloading = true;
    // Reload switches to the ready version without activating it in the running dashboard.
    document.location.reload();
  }

  private async check(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try { await this.updates.checkForUpdate(); }
    catch { /* Offline checks can retry on the next interval or visibility change. */ }
    finally { this.checking = false; }
  }

  ngOnDestroy(): void { this.subscriptions.unsubscribe(); }
}
