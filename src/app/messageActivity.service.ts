import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ActivitySummary {
  mention: boolean;
  recipient: boolean;
  other: boolean;
  flagged: boolean;
  unavailable?: boolean;
}

export interface ActivityConversation {
  chain?: string;
  text?: string;
  chatSubject?: string;
  chatProfileImageUrlThumb?: string;
  chatProfileImageUrlMedium?: string;
  serverTimestamp?: { seconds: number };
  recipients?: Record<string, unknown>;
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
  profile?: { name?: string; createdTimestamp?: number } | null;
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
    if (input.userId && input.ready) for (const message of input.conversations) {
      const chain = message.chain || '';
      summary.flagged ||= !!input.flags[chain];
      const timestamp = (message.serverTimestamp?.seconds || 0) * 1000;
      const seen = input.timestamps[chain] || 0;
      // Match the sidebar's account-age, name-in-text and cursor conditions.
      if (!(Number(input.profile?.createdTimestamp) / 1000 < Number(message.serverTimestamp?.seconds)) ||
          (seen > 0 && timestamp > 0 && timestamp <= seen)) continue;
      if (message.text?.includes(String(input.profile?.name))) {
        summary.mention = true;
        if (chain && status === 'ready') chats.push({
          chain,
          title: message.chatSubject || 'Conversation',
          preview: message.text,
          imageUrl: message.chatProfileImageUrlThumb || message.chatProfileImageUrlMedium || '',
          timestamp
        });
      } else if (message.recipients?.[input.userId]) summary.recipient = true;
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
