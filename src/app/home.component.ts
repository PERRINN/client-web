import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { HomeFeedService, HomeMessage } from './homeFeed.service';
import { PresenceService, RecentVisitor } from './presence.service';
import { UserInterfaceService } from './userInterface.service';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
  standalone: false
})
export class HomeComponent implements OnInit, OnDestroy {
  imageTiles: HomeMessage[] = [];
  events: HomeMessage[] = [];
  visitors: RecentVisitor[] = [];
  loadingImages = true;
  loadingEvents = true;
  loadingVisitors = true;
  imageError = false;
  eventError = false;
  visitorError = false;
  failedBannerUrl = '';
  homeScreenHintDismissed = false;
  private subscriptions = new Subscription();

  constructor(
    private feed: HomeFeedService,
    private presence: PresenceService,
    private changeDetector: ChangeDetectorRef,
    private router: Router,
    public UI: UserInterfaceService
  ) {}

  ngOnInit(): void {
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
    this.subscriptions.add(this.presence.recentVisitors().subscribe({
      next: visitors => { this.visitors = visitors; this.loadingVisitors = false; this.changeDetector.markForCheck(); },
      error: () => { this.visitorError = true; this.loadingVisitors = false; this.changeDetector.markForCheck(); }
    }));
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  dismissHomeScreenHint(): void {
    this.homeScreenHintDismissed = true;
    try {
      sessionStorage.setItem('home-screen-hint-dismissed', 'true');
    } catch { /* Keep the dismissal for this visit when storage is unavailable. */ }
  }

  get upcomingEvents(): HomeMessage[] {
    return this.feed.upcomingEvents(this.events, this.UI.nowSeconds * 1000);
  }

  get bannerUrl(): string {
    const url = this.UI.PERRINNProfileLastMessageObj?.imageUrlOriginal || '';
    return url === this.failedBannerUrl ? '' : url;
  }

  imageUrl(message: HomeMessage): string {
    return message.chatImageUrlMedium || message.chatImageUrlThumb || message.chatImageUrlOriginal || '';
  }

  openImage(message: HomeMessage): void {
    this.UI.showFullScreenImage(message.chatImageUrlOriginal || this.imageUrl(message));
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
}
