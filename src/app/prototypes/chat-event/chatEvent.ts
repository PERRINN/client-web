export interface ChatEvent {
  description: string;
  start: number;
  end: number;
  duration: number;
  location: string;
}
export interface EventRecord {
  eventDescription?: string;
  eventDateStart?: number;
  eventDateEnd?: number;
  eventDuration?: number;
  eventLocation?: string;
}
export interface EventDraft { description: string; date: string; time: string; duration: number; location: string; }

export function chatEvent(record: EventRecord): ChatEvent | null {
  const start = Number(record.eventDateStart), end = Number(record.eventDateEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= start) return null;
  return { description: record.eventDescription || 'Event', start, end,
    duration: Number(record.eventDuration) > 0 ? Number(record.eventDuration) : (end - start) / 3600000,
    location: record.eventLocation || '' };
}

export function eventDraft(event: ChatEvent | null, now = Date.now()): EventDraft {
  const start = event && event.end > now ? event.start : Math.ceil((now + 1800000) / 1800000) * 1800000;
  const date = new Date(start), pad = (value: number) => String(value).padStart(2, '0');
  return { description: event?.description || '', date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`, duration: event?.duration || 1, location: event?.location || '' };
}

export function eventFromDraft(draft: EventDraft, now = Date.now()): ChatEvent {
  const description = draft.description.trim(), location = draft.location.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !/^\d{2}:\d{2}$/.test(draft.time)) throw new Error('Choose a date and time.');
  const [year, month, day] = draft.date.split('-').map(Number), [hour, minute] = draft.time.split(':').map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) {
    throw new Error('That date or time does not exist in your timezone.');
  }
  return normalizeEvent({ description, location, duration: Number(draft.duration), start: date.getTime(), end: 0 }, now);
}

export function normalizeEvent(event: ChatEvent, now = Date.now()): ChatEvent {
  const description = event.description.trim(), location = event.location.trim(), duration = Number(event.duration), start = Number(event.start);
  if (!description || description.length > 200) throw new Error('Enter a description of up to 200 characters.');
  if (!location || location.length > 200) throw new Error('Enter a location or meeting link of up to 200 characters.');
  const end = Math.round(start + duration * 3600000);
  if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(end) || end <= start || !Number.isFinite(new Date(end).getTime())) throw new Error('Enter a valid date, time and duration greater than zero.');
  if (end <= now) throw new Error('Choose an event that has not already ended.');
  return { description, start, end, duration, location };
}

export function eventLocationUrl(location: string): string {
  try { const url = new URL(location); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
export function eventDurationLabel(hours: number): string {
  const minutes = Math.round(hours * 60);
  if (minutes < 1) return '<1 min';
  return minutes < 60 ? `${minutes} min` : minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes / 60}h`;
}

export function eventActionText(action: 'Scheduled' | 'Updated' | 'Cancelled', event: ChatEvent, previous?: ChatEvent | null): string {
  if (action === 'Cancelled') return `Cancelled event: ${event.description}`;
  const editing = action === 'Updated' && !!previous;
  const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(event.start);
  const schedule = `${date} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`;
  const fields = editing ? [
    ...(previous.description !== event.description ? [{ label: 'Description: ', value: event.description, shorten: true }] : []),
    ...(previous.start !== event.start ? [{ label: 'When: ', value: schedule, shorten: false }] : []),
    ...(previous.duration !== event.duration ? [{ label: 'Duration: ', value: eventDurationLabel(event.duration), shorten: false }] : []),
    ...(previous.location !== event.location ? [{ label: 'Location: ', value: event.location, shorten: true }] : [])
  ] : [
    { label: 'Scheduled event: ', value: event.description, shorten: true },
    { label: '', value: `${schedule} · ${eventDurationLabel(event.duration)}`, shorten: false },
    { label: 'Location: ', value: event.location, shorten: true }
  ];
  const heading = editing ? 'Updated event' : '';
  // Shorten only free text when needed; keep all changed fields and the complete schedule.
  let excess = Math.max(0, [heading, ...fields.map(field => field.label + field.value)].filter(Boolean).join('\n').length - 500);
  let remaining = fields.filter(field => field.shorten).length;
  const lines = fields.map(field => {
    if (!field.shorten) return field.label + field.value;
    const reduction = Math.ceil(excess / remaining--);
    excess -= reduction;
    return field.label + (reduction ? `${field.value.slice(0, field.value.length - reduction - 1)}…` : field.value);
  });
  return [heading, ...lines].filter(Boolean).join('\n');
}
