export type ImageTimestamp = number | { seconds?: number; toMillis?: () => number } | null;

export function imagePostedMillis(value?: ImageTimestamp): number {
  const timestamp = typeof value === 'number' ? value : value?.toMillis?.() ?? (value?.seconds || 0) * 1000;
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

export function imageAge(timestamp: number, now = Date.now()): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now + 60000) return '';
  const seconds = Math.max(0, (now - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]
  ];
  const [unit, duration] = units.find(([, duration]) => seconds >= duration);
  return new Intl.RelativeTimeFormat('en-GB', { numeric: 'always' }).format(-Math.floor(seconds / duration), unit);
}
