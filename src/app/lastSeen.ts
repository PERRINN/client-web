/** Activity buckets use the viewer's local calendar, with Monday starting the week. */
export function formatLastSeen(timestamp: number | null | undefined, now = Date.now()): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(new Date(timestamp).getTime())) {
    return 'No activity recorded';
  }

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const week = new Date(today);
  week.setDate(week.getDate() - (week.getDay() + 6) % 7);
  const month = new Date(today.getFullYear(), today.getMonth(), 1);

  // Clamp clock skew to today rather than displaying a future activity category.
  const seen = Math.min(timestamp, now);
  if (seen >= today.getTime()) return 'Seen today';
  if (seen >= week.getTime()) return 'Seen this week';
  if (seen >= month.getTime()) return 'Seen this month';
  return 'Seen longer ago';
}
