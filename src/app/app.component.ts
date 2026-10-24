import { GreenpowerLiveService } from './greenpower-telemetry/greenpowerLive.service';
import { Component, OnInit, OnDestroy, HostListener, ViewChild, ElementRef } from '@angular/core';
import { activeChatChain, sidebarChatCommands } from './chatNavigation';
import { Router, NavigationEnd } from '@angular/router';
import { UserInterfaceService } from './userInterface.service';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { filter, Subscription } from 'rxjs';
import { AppUpdateService } from './appUpdate.service';
import { PresenceService } from './presence.service';
import { MessageActivityService, ActivitySummary } from './messageActivity.service';
import { Observable } from 'rxjs';
import { SidebarConversationsService, SidebarConversation } from './sidebarConversations.service';
import { catchError, map, startWith } from 'rxjs/operators';
import { of } from 'rxjs';
import { ScreenWakeLockService } from './screenWakeLock.service';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    standalone: false,
    host: { '[attr.data-input-modality]': 'inputModality' }
})
export class AppComponent implements OnInit, OnDestroy {
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
    clearTimeout(this.conversationScrollbarTimer);
    clearTimeout(this.automaticScrollbarTimer);
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
    private updates: AppUpdateService,
    private presence: PresenceService,
    activity: MessageActivityService,
    conversations: SidebarConversationsService,
    public greenpowerLive: GreenpowerLiveService,
    public screenWakeLock: ScreenWakeLockService
  ) {
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

    this.updates.start();
  }

  ngOnInit() {
    this.screenWakeLock.start();
    this.presenceSubscription = this.presence.trackActivity();
  }

  openDiscover() {
    window.open('https://discover.perrinn.com', '_blank');
  }

}
