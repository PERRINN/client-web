import { DAY_SESSION_TYPES, DaySession, RecordedEvent, effectiveDefaults } from './greenpowerDay';
import { GpsLap } from './greenpowerGps';

export interface SessionInterval { id: string; start: number; end: number; label: string; }
export function sessionIntervals(event: RecordedEvent, sessions: DaySession[]): SessionInterval[] {
  return sessions.map(session => ({ id: session.id, start: session.startAt, end: session.endAt,
    label: [DAY_SESSION_TYPES.find(type => type.id === session.type)?.label || session.type,
      effectiveDefaults(event, session).driver].filter(Boolean).join(' · ')
  })).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}
export function visibleSessions(sessions: SessionInterval[], start: number, end: number, pixels = 0) {
  if (end <= start) return [];
  return sessions.filter(session => session.end >= start && session.start <= end).map(session => ({ ...session,
    x: (Math.max(start, session.start) - start) / (end - start) * 100,
    width: (Math.min(end, session.end) - Math.max(start, session.start)) / (end - start) * 100,
    starts: session.start >= start, ends: session.end <= end,
    showLabel: (Math.min(end, session.end) - Math.max(start, session.start)) / (end - start) * pixels >= session.label.length * 8 + 16
  }));
}
/** Only fully contained laps belong to a session; never assign a gap-spanning lap to a driver. */
export function sessionLapGroups(laps: GpsLap[], sessions: SessionInterval[]) {
  const groups: { key: number; session?: SessionInterval; laps: GpsLap[] }[] = [];
  for (const lap of laps) {
    const matches = sessions.filter(session => lap.time >= session.start && lap.end <= session.end);
    const session = matches.length === 1 ? matches[0] : undefined;
    let group = groups.at(-1);
    if (!group || group.session?.id !== session?.id) {
      group = { key: groups.length, session, laps: [] }; groups.push(group);
    }
    group.laps.push(lap);
  }
  return groups;
}
