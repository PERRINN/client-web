import { londonTime } from './greenpowerData';
import { recordedEventName, RecordedDayContext, TelemetryEvent, TelemetrySession } from './greenpowerEvents';

interface HeaderInput {
  signedIn: boolean; live: boolean; day: string; recordingKey: string;
  loading: boolean; partial: boolean; error: boolean; hasSamples: boolean;
  start: number; end: number; lastReceived?: number; liveStatus: string;
  event?: TelemetryEvent; session?: TelemetrySession; sessionId: string;
  metadataError: boolean;
  dayContext: RecordedDayContext;
}
export interface RecordingHeader { title: string; date: string; scope: string; range: string; state: string; }

/** Describe the authorized loaded dataset, independently of the chart zoom window. */
export function recordingHeader(input: HeaderInput): RecordingHeader {
  const header = { title: '424 Greenpower Telemetry', date: input.day, scope: '', range: '', state: '' };
  if (!input.signedIn) return { ...header, date: '' };
  if (input.live) return { ...header, scope: input.liveStatus,
    range: 'Last received ' + (input.lastReceived === undefined ? '—' : londonTime(input.lastReceived)) };

  const event = input.event, session = input.session;
  const selectedSession = !!event && !!session && session.eventId === event.id && input.recordingKey.startsWith(session.id + ':');
  if (selectedSession || event && input.recordingKey === 'event:' + event.id) {
    header.title = event!.revision === 0 ? recordedEventName(event!.date, input.dayContext.events) || event!.name : event!.name;
    header.scope = selectedSession ? 'Session · ' + session!.name : input.sessionId
      ? input.metadataError ? 'Session unavailable' : 'Loading session…' : 'No session selected';
    const firstDay = selectedSession ? session!.segments[0].day : event!.date;
    const lastDay = selectedSession ? session!.segments.at(-1)!.day : event!.date;
    header.date = firstDay === lastDay ? firstDay : firstDay + ' – ' + lastDay;
  } else if (input.recordingKey) {
    header.title = 'Telemetry event';
    header.scope = input.metadataError ? input.sessionId ? 'Session unavailable' : 'Event unavailable'
      : input.sessionId ? 'Loading session…' : 'Loading event…';
  } else {
    header.title = recordedEventName(input.day, input.dayContext.events) || 'Event';
    header.scope = 'Whole event';
    if (input.dayContext.failed) header.state = 'Event names unavailable';
    else if (!input.dayContext.complete) header.state = input.dayContext.loading ? 'Loading event names…' : 'Event names incomplete';
  }
  if (input.error) header.state = 'Load failed';
  else if (input.loading) header.state = input.hasSamples ? 'Loading more…' : 'Loading…';
  else if (input.partial) header.state = 'Partial recording';
  const loaded = (!input.recordingKey || selectedSession) && input.hasSamples && Number.isFinite(input.start) && Number.isFinite(input.end) && input.start <= input.end;
  header.range = loaded ? 'Loaded ' + londonTime(input.start) + ' – ' + londonTime(input.end)
    : input.loading ? 'Loading recording…' : input.recordingKey ? 'No recording loaded' : 'No recorded data';
  return header;
}
