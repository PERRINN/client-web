import { EventRecord } from './chat-event/chatEvent';
import { ChatFund } from './chat-fund/chatFund';
import { TransferRecord, TransferSummary, transferSummaries } from './chatTransfer';
import { TimeCreditRecord, TimeCredits, timeCredits } from './chatTimeCredits';
export type ChatTimestamp = { seconds?: number; toMillis?: () => number } | number | null;
export interface ChatRecord extends EventRecord, TransferRecord, TimeCreditRecord {
  isBackendMessage?: boolean;
  fund?: Partial<ChatFund>;
  chain?: string;
  user?: string;
  name?: string;
  text?: string;
  serverTimestamp?: ChatTimestamp;
  lastMessage?: boolean;
  verified?: boolean;
  chatSubject?: string;
  chatProfileImageUrlThumb?: string;
  chatProfileImageUrlMedium?: string;
  chatProfileImageUrlOriginal?: string;
  imageUrlThumbUser?: string;
  imageUrlMedium?: string;
  imageUrlOriginal?: string;
  chatImageTimestamp?: string;
  chatImageUrlMedium?: string;
  chatImageUrlThumb?: string;
  chatImageUrlOriginal?: string;
  recipientList?: string[];
  recipients?: Record<string, { name?: string; imageUrlThumb?: string }>;
}
export interface ChatMessage {
  id: string;
  user: string;
  author: string;
  avatarName: string;
  avatarSources: string[];
  text: string;
  timestamp: number;
  own: boolean;
  verified: boolean;
  image: string;
  originalImage: string;
  imageName: string;
  imageTimestamp?: string;
  transfers?: TransferSummary[];
  timeCredits?: TimeCredits | null;
}
export const timestampMillis = (value?: ChatTimestamp): number => {
  const timestamp = typeof value === 'number' ? value : value?.toMillis?.() || (value?.seconds || 0) * 1000;
  return Number.isFinite(timestamp) ? Math.floor(timestamp) : 0;
};

// Explicit presentation projection: raw account records stay out of the template.
export function bubbleMessage(id: string, record: ChatRecord, userId: string | null, transferSource?: ChatRecord): ChatMessage {
  const transfers = transferSummaries(id, record, userId, transferSource);
  const author = record.isBackendMessage === true && transfers.length ? 'Transfer update' : record.user === userId ? 'You' : record.name || 'Contributor';
  const image = record.chatImageUrlMedium || record.chatImageUrlThumb || record.chatImageUrlOriginal || '';
  return {
    id, user: record.user || '', author, avatarName: record.name || 'Contributor', avatarSources: [record.imageUrlThumbUser, record.imageUrlMedium, record.imageUrlOriginal].filter((url): url is string => !!url),
    text: record.text || '', transfers, timeCredits: timeCredits(record), timestamp: timestampMillis(record.serverTimestamp), own: !!userId && record.user === userId, verified: record.verified === true,
    image, originalImage: record.chatImageUrlOriginal || image, imageName: image ? `Image from ${author}` : '', imageTimestamp: record.chatImageTimestamp
  };
}

export function chatMembers(record: ChatRecord, userId: string | null) {
  return [...new Set(record.recipientList || [])].filter(Boolean).map(id => {
    const name = id === userId ? 'You' : record.recipients?.[id]?.name || 'Contributor';
    return { id, name, avatarName: record.recipients?.[id]?.name || (id === record.user ? record.name : '') || 'Contributor', avatar: record.recipients?.[id]?.imageUrlThumb || '' };
  });
}

export function firstUnread(messages: ChatMessage[], seen: number, messageId = ''): string {
  return seen > 0 ? messages.find(message => isAfterPosition({ timestamp: message.timestamp, messageId: message.id }, { timestamp: seen, messageId }))?.id || '' : '';
}

export function continuesMessageGroup(previous: ChatMessage | undefined, message: ChatMessage, unreadId: string): boolean {
  return !!previous && !!message.user && previous.user === message.user && message.id !== unreadId
    && !previous.transfers?.length && !message.transfers?.length
    && previous.timestamp > 0 && message.timestamp >= previous.timestamp && message.timestamp - previous.timestamp <= 5 * 60 * 1000
    && new Date(previous.timestamp).toDateString() === new Date(message.timestamp).toDateString();
}

export { friendlyDateLabel as messageDateLabel } from './chatDate';

export function chatImageError(image: File): string {
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(image.type)) return 'Choose a PNG, JPEG, GIF or WebP image.';
  return image.size > 15 * 1024 * 1024 ? 'Choose an image smaller than 15 MB.' : '';
}

export interface ReadPosition { timestamp: number; messageId: string; }
export function isAfterPosition(candidate: ReadPosition, previous: ReadPosition): boolean {
  return candidate.timestamp > 0 && (candidate.timestamp > previous.timestamp
    || (candidate.timestamp === previous.timestamp && !!previous.messageId && candidate.messageId > previous.messageId));
}
