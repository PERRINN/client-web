import { GreenpowerChannel, channelsFor, sampleTime } from './greenpowerData';
import { DaySession, RecordedEvent, effectiveDefaults } from './greenpowerDay';
import { sessionAmpHours, savedGear } from './greenpowerSessions';

export interface OverlaySession {
  id: string; label: string; colour: string; session: DaySession;
  date: string; channels: GreenpowerChannel[]; loaded: boolean; hidden: boolean;
}
export interface OverlayTrace { id: string; label: string; colour: string; channel: GreenpowerChannel; dashed?: boolean; sessionId?: string; hidden?: boolean; }
export function overlayColour(index: number) { return `hsl(${(205 + index * 137.508) % 360} 60% 72%)`; }
export function overlayLabel(event: RecordedEvent, session: DaySession) {
  return [event.date, event.eventName, effectiveDefaults(event, session).driver].filter(Boolean).join(' · ');
}
export function overlayChannels(samples: Parameters<typeof channelsFor>[0], session: DaySession, event?: RecordedEvent) {
  const ordered = [...samples].sort((a, b) => sampleTime(a) - sampleTime(b) || a.id.localeCompare(b.id));
  const latest = ordered.at(-1);
  return savedGear(channelsFor(ordered, latest), event, [session], session.startAt, session.endAt, latest && sampleTime(latest)).map(channel => {
    const adjusted = sessionAmpHours(channel, [session], latest && sampleTime(latest));
    return { ...adjusted, ...(adjusted.valueAt ? { valueAt: (time: number) => adjusted.valueAt!(time + session.startAt) } : {}), points: adjusted.points.filter(point => point.time >= session.startAt && point.time <= session.endAt)
      .map(point => ({ time: point.time - session.startAt, value: point.value })) };
  });
}
