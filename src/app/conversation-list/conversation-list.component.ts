import { Component, EventEmitter, Input, Output } from '@angular/core';
import { UserInterfaceService } from '../userInterface.service';
import { CursorState } from '../readCursor.service';
import { conversationIndicators } from '../conversationActivity';
import { ProfileRecord, milliseconds } from '../profile/profileModel';
import { formatConversationTime } from '../conversationTime';
@Component({
    selector: 'app-conversation-list', templateUrl: './conversation-list.component.html',
    styleUrls: ['./conversation-list.component.css'], standalone: false
})
export class ConversationListComponent {
    @Input()
    items: ProfileRecord[] = [];
    @Input()
    compact = false;
    @Input()
    activeChain: string | null = null;
    @Input()
    cursors: CursorState | null = null;
    @Output()
    openChat = new EventEmitter<string>();
    constructor(public UI: UserInterfaceService) { }
    dateLabel(item: ProfileRecord) {
        return formatConversationTime(milliseconds(item.serverTimestamp), this.UI.nowSeconds ? this.UI.nowSeconds * 1000 : Date.now());
    }
    indicators(item: ProfileRecord) {
        return conversationIndicators(item, this.UI.currentUser || null, this.UI.currentUserLastMessageObj, this.cursors);
    }
}
