import { ENERGY, formatChannelNumber, GreenpowerChannel, channelsFor, sampleTime, pointIndex } from './greenpowerData';
import { DaySession, RecordedEvent, effectiveDefaults } from './greenpowerDay';
import { gpsAnalysis, gpsFixes } from './greenpowerGps';
import { contains, TrackDefinition } from './greenpowerTracks';
import { motorLapSpeeds, withMotorDerivedSpeed } from './greenpowerSpeed';
import { lapMetricChannels } from './greenpowerLapMetrics';
import { sessionLapAnalysis, sessionIntervals, sessionAmpHours, savedGear, withEnergy, withDistance, withRaceTime } from './greenpowerSessions';

// Local display state only: hidden retains graph rows; excluded removes them.
export interface OverlaySession {
  id: string; label: string; colour: string; session: DaySession;
  date: string; channels: GreenpowerChannel[]; loaded: boolean; hidden: boolean; excluded: boolean;
  live?: boolean; observedEnd?: number;
}
export interface OverlayTrace { id: string; label: string; colour: string; channel: GreenpowerChannel; dashed?: boolean; detail?: string; sessionId?: string; hidden?: boolean; excluded?: boolean; }
export function overlayColour(index: number) { return `hsl(${(205 + index * 137.508) % 360} 60% 72%)`; }
export function overlayLabel(event: RecordedEvent, session: DaySession, channels: GreenpowerChannel[] = []) {
  let maximum: number | undefined;
  if (session.type === 'battery_dyno') {
    for (const point of channels.find(channel => channel.id === ENERGY)?.points ?? []) {
      if (Number.isFinite(point.value) && (maximum === undefined || point.value > maximum)) maximum = point.value;
    }
  }
  return [event.date, event.eventName, effectiveDefaults(event, session).driver,
    session.type === 'battery_dyno' ? session.batteryIds.join(', ') : '',
    maximum === undefined ? '' : `${formatChannelNumber({ id: ENERGY, unit: 'Wh' }, maximum)} Wh`].filter(Boolean).join(' · ');
}
export function overlayChannels(samples: Parameters<typeof channelsFor>[0], session: DaySession, event?: RecordedEvent, track?: TrackDefinition | null) {
  if (session.endAt === null) return [];
  const endAt = session.endAt;
  const ordered = [...samples].sort((a, b) => sampleTime(a) - sampleTime(b) || a.id.localeCompare(b.id));
  const latest = ordered.at(-1);
  const timed = withRaceTime(channelsFor(ordered, latest), [session],
    ordered.length ? sampleTime(ordered[0]) : session.startAt, latest ? sampleTime(latest) : endAt, latest && sampleTime(latest));
  const channels = withEnergy(timed, [session], latest && sampleTime(latest)), fixes = gpsFixes(channels);
  const line = track?.line && fixes.every(fix => contains(track.bounds, fix)) ? track.line : null;
  const analysis = gpsAnalysis(fixes, line, channels, endAt);
  const numbered = sessionLapAnalysis(analysis, event ? sessionIntervals(event, [session]) : [], {
    channels, fixes, end: endAt, configured: !!line
  });
  const projected = withMotorDerivedSpeed(savedGear(channels, event, [session], session.startAt, endAt,
    latest && sampleTime(latest)), event, latest && sampleTime(latest));
  const metrics = lapMetricChannels(motorLapSpeeds(numbered.laps, projected), projected);
  const adjusted = [...withDistance(projected, [session], latest && sampleTime(latest)), ...metrics]
    .map(channel => sessionAmpHours(channel, [session], latest && sampleTime(latest)));
  return relativeSessionChannels(adjusted, session, endAt);
}

/** Reuse calculated channels; copy only the session's received points, with elapsed-time coordinates. */
export function relativeSessionChannels(channels: GreenpowerChannel[], session: DaySession, end: number): GreenpowerChannel[] {
  return channels.map(channel => ({ ...channel,
    ...(channel.valueAt ? { valueAt: (time: number) => time >= 0 && time <= end - session.startAt ? channel.valueAt!(time + session.startAt) : undefined } : {}),
    points: channel.points.slice(pointIndex(channel.points, session.startAt), pointIndex(channel.points, end, true))
      .map(point => ({ ...point, time: point.time - session.startAt }))
  }));
}
