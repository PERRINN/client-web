import { DAY_SESSION_TYPES, DaySession, RecordedEvent, effectiveDefaults, gearingRatio } from './greenpowerDay';
import { displayValue, GreenpowerChannel, pointIndex } from './greenpowerData';
import { GpsFix, GpsLap, MAX_GPS_GAP, timeAverage, validSegment } from './greenpowerGps';

export interface SessionInterval { id: string; start: number; end: number; label: string; gearRatio?: number; gearChanged?: boolean; }

/** Rebase display readings only; zoom and view changes never alter the baseline. */
export function sessionAmpHours(channel: GreenpowerChannel, sessions: DaySession[], latestTime?: number): GreenpowerChannel {
  if (channel.id !== '["AH"]:Ah' || !channel.points.length) return channel;
  const windows = sessions.filter(session => ['race', 'battery_dyno', 'motor_dyno'].includes(session.type)
    && session.endAt > session.startAt && !sessions.some(other => other !== session
      && other.startAt < session.endAt && other.endAt > session.startAt));
  if (!windows.length) return channel;
  const points = channel.points.slice();
  let value = channel.value;
  for (const session of windows) {
    const first = pointIndex(channel.points, session.startAt);
    const end = pointIndex(channel.points, session.endAt, true);
    if (first === end) continue;
    const baseline = channel.points[first].value;
    for (let index = first; index < end; index++) {
      const point = channel.points[index];
      points[index] = { time: point.time, value: point.value - baseline };
    }
    if (latestTime !== undefined && latestTime >= channel.points[first].time && latestTime <= session.endAt
      && channel.value !== '—' && Number.isFinite(Number(channel.value))) {
      value = displayValue(Number(channel.value) - baseline);
    }
  }
  return { ...channel, points, value };
}
export function sessionIntervals(event: RecordedEvent, sessions: DaySession[]): SessionInterval[] {
  const intervals = sessions.map(session => ({ id: session.id, start: session.startAt, end: session.endAt,
    gearRatio: gearingRatio(event, session),
    label: [DAY_SESSION_TYPES.find(type => type.id === session.type)?.label || session.type,
      effectiveDefaults(event, session).driver].filter(Boolean).join(' · ')
  })).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  return intervals.map((session, index) => ({ ...session, gearChanged: index > 0 && session.gearRatio !== intervals[index - 1].gearRatio }));
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

export interface SessionLapSource {
  channels: GreenpowerChannel[]; fixes: GpsFix[]; end: number; configured: boolean;
}

/** A session starts Lap 1; each subsequent confirmed crossing starts the next lap. */
export function sessionLapAnalysis(analysis: { laps: GpsLap[]; channel: GreenpowerChannel }, sessions: SessionInterval[], source: SessionLapSource) {
  if (!sessions.length || !source.configured || !source.fixes.length) return analysis;
  const { fixes, channels } = source;
  // Ambiguous session windows cannot supply a reliable starting counter.
  const usable = sessions.filter(session => session.end > session.start && !sessions.some(other =>
    other !== session && other.start < session.end && other.end > session.start)).sort((a, b) => a.start - b.start);
  if (!usable.length) return analysis;
  const current = channels.find(channel => channel.id === '["A"]:A')?.points || [];
  const speed = channels.find(channel => channel.id === '["Spd"]:m/s')?.points || [];
  const lastFix = fixes.at(-1)!;
  const laps: GpsLap[] = [];
  const add = (time: number, end: number, lap: number, complete: boolean, session?: SessionInterval) => {
    if (end <= time) return;
    laps.push({ time, end, lap, alternate: !!((lap - 1) % 2), complete,
      ...(session ? { sessionLabel: session.label } : {}),
      ...(complete ? { current: timeAverage(current, time, end), speed: timeAverage(speed, time, end) } : {}) });
  };
  for (const session of usable) {
    let count = 0;
    const first = pointIndex(analysis.laps, session.start);
    const crossing = analysis.laps[first];
    // When the session begins exactly on a crossing, that crossing already starts Lap 1.
    if (crossing?.time !== session.start) {
      const end = Math.min(crossing?.time ?? Infinity, session.end, source.end, lastFix.time);
      if (fixes[0].time <= end) add(session.start, end, ++count,
        crossing?.time === end && continuousGps(fixes, session.start, end), session);
    }
    for (let i = first; i < analysis.laps.length && analysis.laps[i].time < session.end; i++) {
      const lap = analysis.laps[i];
      add(lap.time, Math.min(lap.end, session.end), ++count, lap.complete && lap.end <= session.end, session);
    }
  }
  // Preserve observations outside sessions, clipping away the portions now covered by session laps.
  for (const lap of analysis.laps) {
    let start = lap.time;
    for (const session of usable) {
      if (session.end <= start || session.start >= lap.end) continue;
      add(start, Math.min(lap.end, session.start), lap.lap, false);
      start = Math.min(lap.end, session.end);
    }
    add(start, lap.end, lap.lap, lap.complete && start === lap.time);
  }
  laps.sort((a, b) => a.time - b.time);
  const points: { time: number; value: number }[] = [];
  for (const lap of laps) {
    points.push({time: lap.time, value: lap.lap});
    for (let i = pointIndex(fixes, lap.time, true); i < fixes.length && fixes[i].time < lap.end; i++) {
      points.push({time: fixes[i].time, value: lap.lap});
    }
    if (lap.end - .001 > lap.time) points.push({time: lap.end - .001, value: lap.lap});
  }
  const latest = laps[pointIndex(laps, lastFix.time, true) - 1];
  const value = latest && lastFix.time <= latest.end && source.end - lastFix.time <= MAX_GPS_GAP ? String(latest.lap) : '—';
  return { laps, channel: {...analysis.channel, points, value} };
}

function continuousGps(fixes: GpsFix[], start: number, end: number) {
  const first = Math.max(0, pointIndex(fixes, start, true) - 1), last = pointIndex(fixes, end);
  if (fixes[first].time > start || !fixes[last]) return false;
  for (let i = first + 1; i <= last; i++) if (!validSegment(fixes[i - 1], fixes[i])) return false;
  return true;
}
