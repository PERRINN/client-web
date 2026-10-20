import { londonTime } from './greenpowerData';
import { DAY_SESSION_TYPES, DaySession, RecordedEvent, eventSummary, sessionLabel } from './greenpowerDay';

interface HeaderInput {
  signedIn: boolean; live: boolean; day: string;
  loading: boolean; partial: boolean; error: boolean; hasSamples: boolean;
  start: number; end: number; lastReceived?: number; liveStatus: string;
  event?: RecordedEvent; session?: DaySession;
}
export interface RecordingHeader { title: string; date: string; scope: string; range: string; state: string; }

/** Inputs describe the loaded recording, never the uncommitted history selection. */
export function recordingHeader(input: HeaderInput): RecordingHeader {
  const header = { title: '424 Greenpower Telemetry', date: '', scope: '', range: '', state: '' };
  if (!input.signedIn) return header;
  if (input.live) return { ...header, date: input.day, scope: input.liveStatus,
    range: 'Last received ' + (input.lastReceived === undefined ? '—' : londonTime(input.lastReceived)) };
  const sessionType = input.session?.type;
  const sessionName = DAY_SESSION_TYPES.find(type => type.id === sessionType)?.label || sessionType;
  const eventName = [input.event?.eventName || 'Event', sessionName].filter(Boolean).join(' · ');
  return {
    title: input.event ? eventSummary({ ...input.event, eventName }, input.session) : 'Event', date: input.day,
    scope: input.session ? sessionLabel(input.session) : 'Whole event',
    state: input.error ? 'Load failed' : input.loading ? 'Loading' : input.partial ? 'Partial recording' : '',
    range: input.hasSamples ? 'Loaded ' + londonTime(input.start) + ' – ' + londonTime(input.end)
      : input.loading ? 'Loading recording…' : 'No recording loaded'
  };
}
