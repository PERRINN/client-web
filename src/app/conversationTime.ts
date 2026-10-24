/** Messaging-style labels in the viewer's local calendar, including DST boundaries. */
export function formatConversationTime(timestamp: number, now = Date.now(), locale = 'en-GB'): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(new Date(timestamp).getTime())) return '';
  const date = new Date(timestamp), today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const week = new Date(today);
  week.setDate(week.getDate() - 6);
  if (timestamp >= today.getTime() && date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }
  if (timestamp >= yesterday.getTime() && timestamp < today.getTime()) return 'Yesterday';
  if (timestamp >= week.getTime() && timestamp < yesterday.getTime()) return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date);
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' as const } : {}) }).format(date);
}
