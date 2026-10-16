import { EventRecord } from '../chat-event/chatEvent';
export type ChatTimestamp = { seconds?: number; toMillis?: () => number } | number | null;
export interface ChatRecord extends EventRecord {
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
  imageUrlThumbUser?: string;
  imageUrlMedium?: string;
  imageUrlOriginal?: string;
  chatImageUrlMedium?: string;
  chatImageUrlThumb?: string;
  chatImageUrlOriginal?: string;
  recipientList?: string[];
  recipients?: Record<string, { name?: string; imageUrlThumb?: string }>;
}
export interface BubbleMessage {
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
}
export const timestampMillis = (value?: ChatTimestamp): number => {
  const timestamp = typeof value === 'number' ? value : value?.toMillis?.() || (value?.seconds || 0) * 1000;
  return Number.isFinite(timestamp) ? Math.floor(timestamp) : 0;
};

// Explicit presentation projection: never expose ledger/payment fields to the template.
export function bubbleMessage(id: string, record: ChatRecord, userId: string | null): BubbleMessage {
  const author = record.user === userId ? 'You' : record.name || 'Contributor';
  const image = record.chatImageUrlMedium || record.chatImageUrlThumb || record.chatImageUrlOriginal || '';
  return {
    id, user: record.user || '', author, avatarName: record.name || 'Contributor', avatarSources: [record.imageUrlThumbUser, record.imageUrlMedium, record.imageUrlOriginal].filter((url): url is string => !!url),
    text: record.text || '', timestamp: timestampMillis(record.serverTimestamp), own: !!userId && record.user === userId, verified: record.verified === true,
    image, originalImage: record.chatImageUrlOriginal || image, imageName: image ? `Image from ${author}` : ''
  };
}

export function chatMembers(record: ChatRecord, userId: string | null) {
  return [...new Set(record.recipientList || [])].filter(Boolean).map(id => {
    const name = id === userId ? 'You' : record.recipients?.[id]?.name || 'Contributor';
    return { id, name, avatarName: record.recipients?.[id]?.name || (id === record.user ? record.name : '') || 'Contributor', avatar: record.recipients?.[id]?.imageUrlThumb || '' };
  });
}

export function firstUnread(messages: BubbleMessage[], seen: number, messageId = ''): string {
  return seen > 0 ? messages.find(message => isAfterPosition({ timestamp: message.timestamp, messageId: message.id }, { timestamp: seen, messageId }))?.id || '' : '';
}

export function continuesMessageGroup(previous: BubbleMessage | undefined, message: BubbleMessage, unreadId: string): boolean {
  return !!previous && !!message.user && previous.user === message.user && message.id !== unreadId
    && new Date(previous.timestamp).toDateString() === new Date(message.timestamp).toDateString();
}

export { friendlyDateLabel as messageDateLabel } from '../chatDate';

export function chatImageError(image: File): string {
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(image.type)) return 'Choose a PNG, JPEG, GIF or WebP image.';
  return image.size > 15 * 1024 * 1024 ? 'Choose an image smaller than 15 MB.' : '';
}

export interface ReadPosition { timestamp: number; messageId: string; }
export function isAfterPosition(candidate: ReadPosition, previous: ReadPosition): boolean {
  return candidate.timestamp > 0 && (candidate.timestamp > previous.timestamp
    || (candidate.timestamp === previous.timestamp && !!previous.messageId && candidate.messageId > previous.messageId));
}
