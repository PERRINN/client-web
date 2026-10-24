import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Subscription } from 'rxjs';
import { UserInterfaceService } from './userInterface.service';
import { PresenceService } from './presence.service';
import { formatLastSeen } from './lastSeen';
import { CursorState, ReadCursorService, ReadCursorSession } from './readCursor.service';
import { ProfileFeedService, ProfilePageSession, ProfilePageState } from './profile/profileFeed.service';
import { ProfileRecord, ProfileTab } from './profile/profileModel';
import { ProfileActionsService } from './profile/profileActions.service';
@Component({ selector: 'app-profile', templateUrl: './profile.component.html', styleUrls: ['./profile.component.css'], standalone: false })
export class ProfileComponent implements OnInit, OnDestroy {
    readonly tabs: {
        id: ProfileTab;
        label: string;
    }[] = [
        { id: 'overview', label: 'Overview' }, { id: 'inbox', label: 'Inbox' }, { id: 'history', label: 'History' },
        { id: 'chain', label: 'Chain' }, { id: 'forecast', label: 'Balance illustration' }
    ];
    profile: ProfileRecord | null = null;
    userId = '';
    tab: ProfileTab = 'overview';
    loading = true;
    error = false;
    actionBusy = false;
    actionError = '';
    lastActiveAt = 0;
    activityLoading = true;
    activityError = false;
    feed?: ProfilePageSession;
    feedState: ProfilePageState = { items: [], loading: false, error: false, hasMore: true };
    cursors: CursorState;
    private cursorSession: ReadCursorSession;
    private uid: string | null = null;
    private subscriptions = new Subscription();
    private userSubscriptions = new Subscription();
    private feedSubscription?: Subscription;
    constructor(public UI: UserInterfaceService, public router: Router, private route: ActivatedRoute, private feeds: ProfileFeedService, private presence: PresenceService, private actions: ProfileActionsService, cursors: ReadCursorService, auth: AngularFireAuth, private cd: ChangeDetectorRef) {
        this.cursorSession = cursors.createSession();
        this.subscriptions.add(this.cursorSession.changes.subscribe(state => { this.cursors = state; this.cd.markForCheck(); }));
        this.subscriptions.add(auth.authState.subscribe(user => { this.uid = user?.uid || null; this.updateCursors(); }));
    }
    get ownProfile() { return !!this.profile?.user && this.profile.user === this.UI.currentUser; }
    get rate() { return Number(this.UI.PERRINNAdminLastMessageObj?.interest?.rateYear) || 0; }
    get holdingDays() { return (this.profile?.locking?.amountCummulate || 0) / (this.profile?.wallet?.balance || 1); }
    get dailyAdjustment() { return (this.profile?.wallet?.balance || 0) * (Math.exp(this.rate / 365) - 1); }
    get canSign() { return !!this.profile && this.actions.canSign(this.profile); }
    get activityLabel() { return this.activityLoading ? 'Loading activity' : this.activityError ? 'Activity unavailable' : formatLastSeen(this.lastActiveAt); }
    ngOnInit() {
        this.subscriptions.add(this.route.params.subscribe(params => {
            this.userId = params.id || '';
            if (!this.userId || this.userId === 'all') {
                this.router.navigate(['/home'], { replaceUrl: true });
                return;
            }
            this.loadProfile();
        }));
    }
    loadProfile() {
        this.userSubscriptions.unsubscribe();
        this.userSubscriptions = new Subscription();
        this.clearFeed();
        this.profile = null;
        this.loading = true;
        this.error = false;
        this.actionError = '';
        this.actionBusy = false;
        this.tab = 'overview';
        this.lastActiveAt = 0;
        this.activityLoading = true;
        this.activityError = false;
        this.userSubscriptions.add(this.feeds.user(this.userId).subscribe({ next: profile => {
                this.profile = profile;
                this.loading = false;
                if (!profile) {
                    this.clearFeed();
                    this.tab = 'overview';
                }
            }, error: () => {
                this.clearFeed();
                this.error = true;
                this.loading = false;
            } }));
        this.userSubscriptions.add(this.presence.lastActiveAt(this.userId).subscribe({ next: value => {
                this.lastActiveAt = value;
                this.activityLoading = false;
            }, error: () => { this.activityError = true; this.activityLoading = false; } }));
    }
    selectTab(tab: ProfileTab) {
        if (tab === this.tab)
            return;
        this.clearFeed();
        this.tab = tab;
        if (tab === 'overview' || tab === 'forecast')
            return;
        this.feed = this.feeds.create(this.userId, tab);
        this.feedSubscription = this.feed.state.subscribe(state => { this.feedState = state; this.updateCursors(); });
        this.feed.loadMore();
    }
    tabKey(event: KeyboardEvent, index: number) {
        let next = index;
        if (event.key === 'ArrowRight')
            next = (index + 1) % this.tabs.length;
        else if (event.key === 'ArrowLeft')
            next = (index + this.tabs.length - 1) % this.tabs.length;
        else if (event.key === 'Home')
            next = 0;
        else if (event.key === 'End')
            next = this.tabs.length - 1;
        else
            return;
        event.preventDefault();
        this.selectTab(this.tabs[next].id);
        (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
    }
    openChat(chain: string) {
        if (chain) this.router.navigate(['/chat', chain]);
    }
    openMessage(record: ProfileRecord) {
        if (record.chain)
            this.router.navigate(['/chat', record.chain], { queryParams: { scroll: record.id } });
    }
    async message() {
        if (this.actionBusy || !this.profile)
            return;
        this.actionBusy = true;
        this.actionError = '';
        const userId = this.userId;
        try {
            const chain = await this.actions.startChat(this.profile);
            if (chain && userId === this.userId)
                this.openChat(chain);
        }
        catch {
            if (userId === this.userId)
                this.actionError = 'Couldn’t start the conversation. Try again.';
        }
        finally {
            if (userId === this.userId)
                this.actionBusy = false;
        }
    }
    async sign() {
        if (!this.canSign || this.actionBusy)
            return;
        this.actionBusy = true;
        this.actionError = '';
        const userId = this.userId;
        try {
            await this.actions.sign(this.profile);
            if (userId === this.userId)
                this.openChat(userId);
        }
        catch {
            if (userId === this.userId)
                this.actionError = 'Couldn’t sign the contract. Try again.';
        }
        finally {
            if (userId === this.userId)
                this.actionBusy = false;
        }
    }
    retryIndicators() { this.cursorSession.retry(); }
    private updateCursors() {
        this.cursorSession.update(this.uid, this.tab === 'inbox' ? this.feedState.items.map(item => item.chain) : []);
    }
    private clearFeed() {
        this.feedSubscription?.unsubscribe();
        this.feed?.destroy();
        this.feed = undefined;
        this.feedState = { items: [], loading: false, error: false, hasMore: true };
        this.cursorSession.update(this.uid, []);
    }
    ngOnDestroy() {
        this.clearFeed();
        this.userSubscriptions.unsubscribe();
        this.subscriptions.unsubscribe();
        this.cursorSession.destroy();
    }
}
