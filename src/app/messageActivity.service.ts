import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { map } from 'rxjs/operators';
import { ActivityConversation, conversationIndicators } from './conversationActivity';
export type { ActivityConversation } from './conversationActivity';

export interface ActivitySummary {
  mention: boolean;
  recipient: boolean;
  other: boolean;
  flagged: boolean;
  unavailable?: boolean;
}

export interface MentionedChat {
  chain: string;
  title: string;
  preview: string;
  imageUrl: string;
  timestamp: number;
}

export interface MentionActivity {
  userId: string | null;
  status: 'signed-out' | 'loading' | 'ready' | 'unavailable';
  chats: MentionedChat[];
}

export interface ConversationActivityInput {
  conversations: ActivityConversation[];
  userId: string | null;
  profile?: { user?: string; name?: string; createdTimestamp?: number } | null;
  readyChains?: Record<string, boolean>;
  messageIds?: Record<string, string>;
  timestamps: Record<string, number>;
  flags: Record<string, boolean>;
  ready: boolean;
  unavailable: boolean;
}

const emptySummary: ActivitySummary = { mention: false, recipient: false, other: false, flagged: false };
const emptyMentions: MentionActivity = { userId: null, status: 'signed-out', chats: [] };

// The sidebar publishes its already-loaded conversations and cursor state.
@Injectable({ providedIn: 'root' })
export class MessageActivityService {
  private state = new BehaviorSubject({ summary: emptySummary, mentions: emptyMentions });
  private pending = this.state.value;
  private scheduled = false;

  constructor(private zone: NgZone) {}

  summary() { return this.state.pipe(map(state => state.summary)); }
  mentions() { return this.state.pipe(map(state => state.mentions)); }

  updateConversations(input: ConversationActivityInput): void {
    const summary = { ...emptySummary, unavailable: input.unavailable };
    const chats: MentionedChat[] = [];
    const status = !input.userId ? 'signed-out' : input.unavailable ? 'unavailable'
      : !input.ready || !input.profile ? 'loading' : 'ready';
    if (input.userId && (input.ready || input.readyChains)) for (const message of input.conversations) {
      if (message.isBackendMessage === true) continue;
      const chain = message.chain || '';
      const indicator = conversationIndicators(message, input.userId, input.profile || null, {
        timestamps: input.timestamps, flags: input.flags, messageIds: input.messageIds,
        ready: input.ready, readyChains: input.readyChains, unavailable: input.unavailable
      });
      summary.flagged ||= indicator.flagged;
      if (!indicator.unread) continue;
      const timestamp = (message.serverTimestamp?.seconds || 0) * 1000;
      if (indicator.unread === 'mention') {
        summary.mention = true;
        if (chain && status === 'ready') chats.push({
          chain,
          title: message.chatSubject || 'Conversation',
          preview: message.text,
          imageUrl: message.chatProfileImageUrlThumb || message.chatProfileImageUrlMedium || '',
          timestamp
        });
      } else if (indicator.unread === 'recipient') summary.recipient = true;
      else summary.other = true;
    }
    const unique = new Map<string, MentionedChat>();
    chats.sort((a, b) => b.timestamp - a.timestamp).forEach(chat => {
      if (!unique.has(chat.chain)) unique.set(chat.chain, chat);
    });
    this.update(summary, { userId: input.userId, status, chats: [...unique.values()].slice(0, 3) });
  }

  private update(summary: ActivitySummary, mentions: MentionActivity) {
    const next = { ...summary };
    if (next.mention) { next.recipient = false; next.other = false; }
    else if (next.recipient) next.other = false;
    const pending = { summary: next, mentions };
    if (JSON.stringify(pending) === JSON.stringify(this.pending)) return;
    this.pending = pending;
    if (this.scheduled) return;
    this.scheduled = true;
    // Publish after the current view check, with Angular rendering enabled.
    queueMicrotask(() => this.zone.run(() => {
      this.scheduled = false;
      this.state.next(this.pending);
    }));
  }

  clear() { this.update(emptySummary, emptyMentions); }
}
