import { ENERGY, GreenpowerChannel, channelsFor, sampleTime } from './greenpowerData';
import { DaySession, RecordedEvent, effectiveDefaults } from './greenpowerDay';
import { gpsAnalysis, gpsFixes } from './greenpowerGps';
import { contains, TrackDefinition } from './greenpowerTracks';
import { motorLapSpeeds, withMotorDerivedSpeed } from './greenpowerSpeed';
import { lapMetricChannels } from './greenpowerLapMetrics';
import { sessionLapAnalysis, sessionIntervals, sessionAmpHours, savedGear, withEnergy, withDistance } from './greenpowerSessions';

// Local display state only: hidden retains graph rows; excluded removes them.
export interface OverlaySession {
  id: string; label: string; colour: string; session: DaySession;
  date: string; channels: GreenpowerChannel[]; loaded: boolean; hidden: boolean; excluded: boolean;
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
    maximum === undefined ? '' : `${maximum.toFixed(1)} Wh`].filter(Boolean).join(' · ');
}
export function overlayChannels(samples: Parameters<typeof channelsFor>[0], session: DaySession, event?: RecordedEvent, track?: TrackDefinition | null) {
  const ordered = [...samples].sort((a, b) => sampleTime(a) - sampleTime(b) || a.id.localeCompare(b.id));
  const latest = ordered.at(-1);
  const channels = withEnergy(channelsFor(ordered, latest), [session], latest && sampleTime(latest)), fixes = gpsFixes(channels);
  const line = track?.line && fixes.every(fix => contains(track.bounds, fix)) ? track.line : null;
  const analysis = gpsAnalysis(fixes, line, channels, session.endAt);
  const numbered = sessionLapAnalysis(analysis, event ? sessionIntervals(event, [session]) : [], {
    channels, fixes, end: session.endAt, configured: !!line
  });
  const projected = withMotorDerivedSpeed(savedGear(channels, event, [session], session.startAt, session.endAt,
    latest && sampleTime(latest)), event, latest && sampleTime(latest));
  const metrics = lapMetricChannels(motorLapSpeeds(numbered.laps, projected), projected);
  return [...withDistance(projected, [session], latest && sampleTime(latest)), ...metrics].map(channel => {
    const adjusted = sessionAmpHours(channel, [session], latest && sampleTime(latest));
    return { ...adjusted,
      ...(adjusted.valueAt ? { valueAt: (time: number) => adjusted.valueAt!(time + session.startAt) } : {}),
      points: adjusted.points.filter(point => point.time >= session.startAt && point.time <= session.endAt)
        .map(point => ({ ...point, time: point.time - session.startAt })) };
  });
}
