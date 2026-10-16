export function friendlyDateLabel(timestamp: number, now = Date.now(), includeFuture = false): string {
  if (!timestamp || !Number.isFinite(timestamp)) return 'Pending';
  const date = new Date(timestamp), today = new Date(now);
  // Compare local calendar days, including across 23/25-hour daylight-saving days.
  const calendarDay = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86400000;
  const days = calendarDay(today) - calendarDay(date);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (includeFuture && days === -1) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-GB', (days > 1 && days < 7) || (includeFuture && days < -1 && days > -7) ? { weekday: 'long' }
    : { day: 'numeric', month: 'short', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) }).format(date);
}
