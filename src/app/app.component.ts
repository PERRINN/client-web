import { Component, OnInit, OnDestroy, HostListener, ViewChild, ElementRef } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { UserInterfaceService } from './userInterface.service';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter, interval, Subscription } from 'rxjs';
import { PresenceService } from './presence.service';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    standalone: false
})
export class AppComponent implements OnInit, OnDestroy {
  sidebarOpen = false;
  mobileLayout = window.innerWidth < 900;
  @ViewChild('menuToggle') menuToggle?: ElementRef<HTMLButtonElement>;
  @ViewChild('sidebarNavigation') sidebarNavigation?: ElementRef<HTMLElement>;
  private navigationSubscription: Subscription;
  private presenceSubscription?: Subscription;

  openSidebar(): void {
    this.sidebarOpen = true;
    setTimeout(() => this.sidebarNavigation?.nativeElement.querySelector<HTMLButtonElement>('button')?.focus());
  }

  closeSidebar(restoreFocus = true): void {
    this.sidebarOpen = false;
    if (restoreFocus) this.menuToggle?.nativeElement.focus();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.mobileLayout = window.innerWidth < 900;
    if (!this.mobileLayout) this.sidebarOpen = false;
  }

  onSidebarKeydown(event: KeyboardEvent): void {
    if (!this.mobileLayout || !this.sidebarOpen) return;
    if (event.key === 'Escape') { this.closeSidebar(); event.preventDefault(); }
    if (event.key !== 'Tab') return;
    const controls = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select, textarea, [tabindex="0"]')).filter(el => el.getClientRects().length > 0);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { last?.focus(); event.preventDefault(); }
    else if (!event.shiftKey && document.activeElement === last) { first?.focus(); event.preventDefault(); }
  }

  ngOnDestroy(): void {
    this.navigationSubscription.unsubscribe();
    this.presenceSubscription?.unsubscribe();
  }

  private cleanupLegacyLocalStorage(): void {
    const legacyKeys = [
      'processingPayment',
      'paymentStatus',
      'revolutCheckoutUrl',
      'revolutOrderId',
      'revolutOrderReference'
    ];
    legacyKeys.forEach((key) => localStorage.removeItem(key));
  }

  constructor(
    public router:Router,
    public afs:AngularFirestore,
    public UI:UserInterfaceService,
    private updates: SwUpdate,
    private presence: PresenceService
  ) {
    this.cleanupLegacyLocalStorage();
    this.navigationSubscription = this.router.events.pipe(filter(event => event instanceof NavigationEnd)).subscribe(() => {
      const wasOpen = this.sidebarOpen;
      this.closeSidebar(wasOpen);
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    });

    if (this.updates.isEnabled) {
      this.updates.versionUpdates
        .pipe(filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'))
        .subscribe(() => {
          this.updates.activateUpdate().then(() => document.location.reload());
        });

      interval(30000).subscribe(() => {
        this.updates.checkForUpdate();
      });

      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          this.updates.checkForUpdate();
        }
      });
    }
  }

  ngOnInit() {
    this.presenceSubscription = this.presence.trackActivity();
    const uploader = document.getElementById('uploader');
    if (uploader) uploader.style.visibility = 'hidden';
    const fullScreenImage = document.getElementById('fullScreenImage');
    if (fullScreenImage) fullScreenImage.style.visibility = 'hidden';
  }

  hideFullScreenImage() {
    const fullScreenImage = document.getElementById('fullScreenImage') as HTMLImageElement | null;
    if (!fullScreenImage) return;
    fullScreenImage.style.visibility = 'hidden';
    fullScreenImage.src = '';
  }

  openDiscover() {
    window.open('https://discover.perrinn.com', '_blank');
  }

}
