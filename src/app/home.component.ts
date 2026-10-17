import { recordImage } from './image-viewer/imageViewer.service';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { fromEvent, merge, Subscription, timer } from 'rxjs';
import { filter } from 'rxjs/operators';
import { HomeFeedService, HomeFund, HomeMessage } from './homeFeed.service';
import { fundAmount, fundCurrency, fundProgress } from './chat/chat-fund/chatFund';
import { PresenceService, RecentVisitor } from './presence.service';
import { MessageActivityService, MentionActivity } from './messageActivity.service';
import { UserInterfaceService } from './userInterface.service';
import { formatLastSeen } from './lastSeen';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
  standalone: false
})
export class HomeComponent implements OnInit, OnDestroy {
  mentionActivity: MentionActivity = { userId: null, status: 'signed-out', chats: [] };
  imageTiles: HomeMessage[] = [];
  events: HomeMessage[] = [];
  visitors: RecentVisitor[] = [];
  funds: HomeFund[] = [];
  fundLimit = 4;
  loadingFunds = true;
  fundError = false;
  readonly fundProgress = fundProgress;
  private fundSubscription?: Subscription;
  loadingImages = true;
  loadingEvents = true;
  loadingVisitors = true;
  imageError = false;
  eventError = false;
  visitorError = false;
  failedBannerUrl = '';
  homeScreenHintDismissed = false;
  eventNow = Date.now();
  readonly formatLastSeen = formatLastSeen;
  private subscriptions = new Subscription();

  constructor(
    private feed: HomeFeedService,
    private presence: PresenceService,
    private activity: MessageActivityService,
    private changeDetector: ChangeDetectorRef,
    private router: Router,
    public UI: UserInterfaceService
  ) {}

  ngOnInit(): void {
    // Keep event boundaries current without polling Firestore; refresh on tab return.
    this.subscriptions.add(merge(
      timer(0, 1000), fromEvent(document, 'visibilitychange'), fromEvent(window, 'focus')
    ).pipe(filter(() => !document.hidden)).subscribe(() => {
      this.eventNow = Date.now();
      this.changeDetector.markForCheck();
    }));
    this.subscriptions.add(this.activity.mentions().subscribe(state => {
      this.mentionActivity = state;
      this.changeDetector.markForCheck();
    }));
    try {
      this.homeScreenHintDismissed = sessionStorage.getItem('home-screen-hint-dismissed') === 'true';
    } catch { /* The hint still works when browser storage is unavailable. */ }
    this.subscriptions.add(this.feed.images().subscribe({
      next: images => { this.imageTiles = images; this.loadingImages = false; this.changeDetector.markForCheck(); },
      error: () => { this.imageError = true; this.loadingImages = false; this.changeDetector.markForCheck(); }
    }));
    this.subscriptions.add(this.feed.events().subscribe({
      next: events => { this.events = events; this.loadingEvents = false; this.changeDetector.markForCheck(); },
      error: () => { this.eventError = true; this.loadingEvents = false; this.changeDetector.markForCheck(); }
    }));
    this.loadFunds();
    this.subscriptions.add(this.presence.recentVisitors().subscribe({
      next: visitors => { this.visitors = visitors; this.loadingVisitors = false; this.changeDetector.markForCheck(); },
      error: () => { this.visitorError = true; this.loadingVisitors = false; this.changeDetector.markForCheck(); }
    }));
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  loadFunds(more = false): void {
    if (more) this.fundLimit += 4;
    this.fundSubscription?.unsubscribe(); this.loadingFunds = true; this.fundError = false;
    this.fundSubscription = this.feed.funds(this.fundLimit + 1).subscribe({
      next: funds => { this.funds = funds; this.loadingFunds = false; this.changeDetector.markForCheck(); },
      error: () => { this.fundError = true; this.loadingFunds = false; this.changeDetector.markForCheck(); }
    });
    this.subscriptions.add(this.fundSubscription);
  }

  fundAmount(value: number): string {
    return fundAmount(value, fundCurrency(this.UI.currentUserLastMessageObj?.userCurrency, this.UI.PERRINNAdminLastMessageObj?.currencyList));
  }

  dismissHomeScreenHint(): void {
    this.homeScreenHintDismissed = true;
    try {
      sessionStorage.setItem('home-screen-hint-dismissed', 'true');
    } catch { /* Keep the dismissal for this visit when storage is unavailable. */ }
  }

  get upcomingEvents(): HomeMessage[] {
    return this.feed.upcomingEvents(this.events, this.eventNow);
  }

  get eventNotices(): HomeMessage[] {
    return this.loadingEvents || this.eventError ? [] : this.feed.eventNotices(this.events, this.eventNow);
  }

  eventNoticeStatus(event: HomeMessage): string {
    const remaining = Number(event.eventDateStart) - this.eventNow;
    if (remaining <= 0) return 'In progress';
    if (remaining < 60000) return 'Starting now';
    const minutes = Math.ceil(remaining / 60000);
    return `Starts in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  get bannerUrl(): string {
    const url = this.UI.PERRINNProfileLastMessageObj?.imageUrlOriginal || '';
    return url === this.failedBannerUrl ? '' : url;
  }

  imageUrl(message: HomeMessage): string {
    return message.chatImageUrlMedium || message.chatImageUrlThumb || message.chatImageUrlOriginal || '';
  }

  openImage(message: HomeMessage): void {
    const image = recordImage(message.id, message);
    if (image) this.UI.showFullScreenImage(image.src, image);
  }

  openChat(chain?: string): void {
    if (chain) this.router.navigate(['/chat', chain]);
  }

  openProfile(userId: string): void {
    this.router.navigate(['/profile', userId]);
  }

  eventStartsIn(event: HomeMessage): string {
    const start = Number(event.eventDateStart || 0);
    if (!start) return 'Start time unavailable';
    const remaining = start - this.eventNow;
    if (remaining <= 0) return 'In progress';
    if (remaining < 60000) return 'Starting now';
    if (remaining < 10800000) {
      const totalMinutes = Math.ceil(remaining / 60000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      const hourDisplay = hours ? `${hours} hour${hours === 1 ? '' : 's'} ` : '';
      return `In ${hourDisplay}${minutes} minute${minutes === 1 ? '' : 's'}`;
    }
    const unit = remaining >= 86400000 ? 'day' : 'hour';
    const duration = unit === 'day' ? 86400000 : 3600000;
    const amount = Math.max(1, Math.round(remaining / duration));
    return `In ${amount} ${unit}${amount === 1 ? '' : 's'}`;
  }

}
