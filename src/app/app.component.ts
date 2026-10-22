import { GreenpowerLiveService } from './greenpower-telemetry/greenpowerLive.service';
import { RadioLifecycleService } from './prototypes/team-radio/radioLifecycle.service';
import { Component, OnInit, OnDestroy, AfterViewInit, HostListener, ViewChild, ElementRef, ChangeDetectorRef, inject } from '@angular/core';
import { MobileOrientationService } from './mobileOrientation.service';
import { activeChatChain, sidebarChatCommands } from './chatNavigation';
import { Router, NavigationEnd } from '@angular/router';
import { UserInterfaceService } from './userInterface.service';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter, interval, Subscription } from 'rxjs';
import { PresenceService } from './presence.service';
import { MessageActivityService, ActivitySummary } from './messageActivity.service';
import { Observable } from 'rxjs';
import { SidebarConversationsService, SidebarConversation } from './sidebarConversations.service';
import { catchError, map, startWith } from 'rxjs/operators';
import { of } from 'rxjs';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    standalone: false,
    host: { '[attr.data-input-modality]': 'inputModality' }
})
export class AppComponent implements OnInit, OnDestroy, AfterViewInit {
  private readonly orientation = inject(MobileOrientationService);
  @ViewChild('orientationNotice', { static: true }) orientationNotice!: ElementRef<HTMLDialogElement>;
  private orientationSubscription?: Subscription;
  private orientationReturnFocus?: HTMLElement;
  private orientationFocusFrame = 0;

  @HostListener('document:focusin', ['$event'])
  rememberOrientationFocus(event: FocusEvent): void {
    if (!this.orientationNotice?.nativeElement.open && event.target instanceof HTMLElement && event.target !== document.body) {
      this.orientationReturnFocus = event.target;
    }
  }

  ngAfterViewInit(): void {
    this.orientationSubscription = this.orientation.landscapeBlocked$.subscribe(blocked => {
      cancelAnimationFrame(this.orientationFocusFrame);
      const dialog = this.orientationNotice.nativeElement;
      if (blocked && !dialog.open) dialog.showModal();
      else if (!blocked && dialog.open) {
        const previousFocus = this.orientationReturnFocus;
        dialog.close();
        // Orientation events can precede the resize that makes mobile controls visible again.
        this.orientationFocusFrame = requestAnimationFrame(() => previousFocus?.focus({ preventScroll: true }));
      }
    });
  }

  inputModality: 'pointer' | 'keyboard' = 'pointer';

  @HostListener('document:pointerdown')
  onPointerInput(): void { this.inputModality = 'pointer'; }

  @HostListener('document:keydown', ['$event'])
  onKeyboardInput(event: KeyboardEvent): void {
    if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Enter', ' ', 'Escape'].includes(event.key)) {
      this.inputModality = 'keyboard';
    }
  }

  readonly activitySummary: Observable<ActivitySummary>;
  readonly automaticConversations: Observable<{ status: 'loading' | 'ready' | 'unavailable'; chats: SidebarConversation[] }>;
  automaticScrollbarVisible = false;
  private automaticScrollbarTimer?: ReturnType<typeof setTimeout>;
  sidebarOpen = false;
  conversationScrollbarVisible = false;
  private conversationScrollbarTimer?: ReturnType<typeof setTimeout>;
  mobileLayout = window.innerWidth < 900;
  @ViewChild('menuToggle') menuToggle?: ElementRef<HTMLButtonElement>;
  @ViewChild('sidebarNavigation') sidebarNavigation?: ElementRef<HTMLElement>;
  private navigationSubscription: Subscription;
  private presenceSubscription?: Subscription;
  private radioSubscription: Subscription;

  get activeSidebarChatId(): string | null { return activeChatChain(this.router.url); }
  get editorialPage(): boolean { return this.router.routerState.root.firstChild?.snapshot.data['editorial'] === true; }

  openSidebarChat(chain?: string): void {
    if (!chain) return;
    this.closeSidebar();
    void this.router.navigate(sidebarChatCommands(chain));
  }

  onConversationScroll(): void {
    this.conversationScrollbarVisible = true;
    clearTimeout(this.conversationScrollbarTimer);
    this.conversationScrollbarTimer = setTimeout(() => {
      this.conversationScrollbarVisible = false;
    }, 800);
  }

  onAutomaticScroll(): void {
    this.automaticScrollbarVisible = true;
    clearTimeout(this.automaticScrollbarTimer);
    this.automaticScrollbarTimer = setTimeout(() => this.automaticScrollbarVisible = false, 800);
  }

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
    this.orientationSubscription?.unsubscribe();
    cancelAnimationFrame(this.orientationFocusFrame);
    clearTimeout(this.conversationScrollbarTimer);
    clearTimeout(this.automaticScrollbarTimer);
    this.navigationSubscription.unsubscribe();
    this.presenceSubscription?.unsubscribe();
    this.radioSubscription.unsubscribe();
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
    private presence: PresenceService,
    activity: MessageActivityService,
    conversations: SidebarConversationsService,
    public radioLifecycle: RadioLifecycleService,
    public greenpowerLive: GreenpowerLiveService,
    changeDetector: ChangeDetectorRef
  ) {
    this.radioSubscription = radioLifecycle.changed.subscribe(() => changeDetector.markForCheck());
    this.activitySummary = activity.summary();
    this.automaticConversations = conversations.automatic().pipe(
      map(chats => ({ status: 'ready' as const, chats })),
      startWith({ status: 'loading' as const, chats: [] }),
      catchError(() => of({ status: 'unavailable' as const, chats: [] }))
    );
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
  }

  openDiscover() {
    window.open('https://discover.perrinn.com', '_blank');
  }

}
