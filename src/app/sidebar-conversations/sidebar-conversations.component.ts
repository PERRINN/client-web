import { ChangeDetectorRef, Component, DoCheck, EventEmitter, NgZone, OnDestroy, OnInit, Output } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Router } from '@angular/router';
import { Subscription, take } from 'rxjs';
import { SidebarConversationsService } from '../sidebarConversations.service';
import { ReadCursorService, CursorState, ReadCursorSession } from '../readCursor.service';
import { MessageActivityService } from '../messageActivity.service';
import { UserInterfaceService } from '../userInterface.service';
import { activeChatChain, sidebarChatCommands } from '../chatNavigation';
import { ProfileRecord } from '../profile/profileModel';
@Component({
    selector: 'app-sidebar-conversations', templateUrl: './sidebar-conversations.component.html',
    styleUrls: ['./sidebar-conversations.component.css'], standalone: false
})
export class SidebarConversationsComponent implements OnInit, OnDestroy, DoCheck {
    @Output()
    chatOpened = new EventEmitter<void>();
    items: ProfileRecord[] = [];
    cursors: CursorState;
    loading = true;
    error = false;
    private limit = 30;
    private ready = false;
    private uid: string | null = null;
    private session: ReadCursorSession;
    private subscriptions = new Subscription();
    private feed?: Subscription;
    private scrollAfterLoad = false;
    constructor(private feeds: SidebarConversationsService, cursors: ReadCursorService, auth: AngularFireAuth, private activity: MessageActivityService, public UI: UserInterfaceService, private router: Router, private zone: NgZone, private cd: ChangeDetectorRef) {
        this.session = cursors.createSession();
        this.subscriptions.add(this.session.changes.subscribe(state => { this.cursors = state; this.cd.markForCheck(); }));
        this.subscriptions.add(auth.authState.subscribe(user => this.zone.run(() => { this.uid = user?.uid || null; this.updateCursors(); this.cd.markForCheck(); })));
    }
    get activeChain() { return activeChatChain(this.router.url); }
    ngOnInit() { this.load(); }
    private load() {
        this.feed?.unsubscribe();
        this.loading = true;
        this.error = false;
        this.feed = this.feeds.human(this.limit).subscribe({ next: rows => this.zone.run(() => {
                this.items = rows.map(row => ({ ...row.payload.doc.data(), id: row.payload.doc.id }));
                this.ready = true;
                this.loading = false;
                this.updateCursors();
                this.cd.markForCheck();
                if (this.scrollAfterLoad) {
                    this.scrollAfterLoad = false;
                    this.subscriptions.add(this.zone.onStable.pipe(take(1)).subscribe(() => {
                        const sidebar = document.querySelector('.sideProfile');
                        if (sidebar)
                            sidebar.scrollTop = sidebar.scrollHeight;
                    }));
                }
            }), error: () => this.zone.run(() => { this.loading = false; this.error = true; this.cd.markForCheck(); }) });
    }
    private updateCursors() { this.session.update(this.uid, this.items.map(item => item.chain)); }
    ngDoCheck() {
        this.activity.updateConversations({ conversations: this.items, userId: this.uid === this.UI.currentUser ? this.uid : null,
            profile: this.UI.currentUserLastMessageObj?.user === this.UI.currentUser ? this.UI.currentUserLastMessageObj : null,
            timestamps: this.cursors?.timestamps || {}, flags: this.cursors?.flags || {},
            readyChains: this.cursors?.readyChains, messageIds: this.cursors?.messageIds,
            ready: this.ready && this.cursors?.ready && this.uid === this.UI.currentUser,
            unavailable: this.error || !!this.cursors?.unavailable });
    }
    open(chain: string) { this.chatOpened.emit(); this.router.navigate(sidebarChatCommands(chain)); }
    loadMore() {
        if (this.loading)
            return;
        if (!this.error && this.cursors?.unavailable) {
            this.session.retry();
            return;
        }
        if (!this.error)
            this.limit += 15;
        this.scrollAfterLoad = true;
        this.load();
    }
    ngOnDestroy() { this.feed?.unsubscribe(); this.subscriptions.unsubscribe(); this.session.destroy(); this.activity.clear(); }
}
