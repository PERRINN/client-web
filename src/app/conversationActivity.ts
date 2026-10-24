import { containsMention } from './chat/chatMention';
import { isAfterPosition } from './chat/chatData';
import type { CursorState } from './readCursor.service';

export interface ActivityConversation {
  id?: string;
  user?: string;
  isBackendMessage?: boolean;
  chain?: string;
  text?: string;
  chatSubject?: string;
  chatProfileImageUrlThumb?: string;
  chatProfileImageUrlMedium?: string;
  serverTimestamp?: { seconds: number };
  recipients?: Record<string, unknown>;
}
export interface ActivityProfile { user?: string; name?: string; createdTimestamp?: number; }
type IndicatorCursors = Pick<CursorState, 'timestamps' | 'flags' | 'ready'> & Partial<CursorState>;
export type UnreadKind = 'mention' | 'recipient' | 'other';

/** Shared by conversation rows, shell summaries and Home mentions. Never writes a cursor. */
export function conversationIndicators(message: ActivityConversation, userId: string | null, profile: ActivityProfile | null, cursors: IndicatorCursors | null): { unread: UnreadKind | null; flagged: boolean } {
  const empty = { unread: null, flagged: false };
  const chain = message.chain || '';
  if (!chain || !userId || !cursors || (cursors.userId !== undefined && cursors.userId !== userId)
    || (profile?.user && profile.user !== userId)) return empty;
  const ready = cursors.readyChains ? cursors.readyChains[chain] === true : cursors.ready && !cursors.unavailable;
  if (!ready) return empty;
  const flagged = cursors.flags[chain] === true;
  const timestamp = Number(message.serverTimestamp?.seconds) * 1000;
  const created = Number(profile?.createdTimestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(created) || created >= timestamp || message.user === userId) {
    return { unread: null, flagged };
  }
  const seen = cursors.timestamps[chain] || 0;
  if (seen > 0 && !isAfterPosition({ timestamp, messageId: message.id || '' }, { timestamp: seen, messageId: cursors.messageIds?.[chain] || '' })) {
    return { unread: null, flagged };
  }
  return { flagged, unread: containsMention(message.text || '', profile?.name || '') ? 'mention'
    : message.recipients?.[userId] ? 'recipient' : 'other' };
}
