import { Injectable, OnDestroy } from '@angular/core';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { firstValueFrom, Subject, Subscription } from 'rxjs';
import { editable, SESSION_TYPES, EventData, EventEditRequest, EventEditResult, MetadataDraft, metadataError, SessionData, TelemetryEvent, TelemetrySession, validSegments } from './greenpowerEvents';
import { GreenpowerEventsService } from './greenpowerEvents.service';
import { GreenpowerTelemetryService } from './greenpowerTelemetry.service';

@Injectable()
export class GreenpowerEventEditService implements OnDestroy {
  readonly changed = new Subject<void>();
  mode: '' | 'event' | 'session' = '';
  draft: MetadataDraft = {};
  reviewing = false;
  saving = false;
  uncertain = false;
  error = '';
  notice = '';
  private baseEvent?: TelemetryEvent;
  private baseSession?: TelemetrySession;
  private newId = '';
  private prepared?: EventEditRequest;
  private generation = 0;
  private uid = '';
  private readonly subscription: Subscription;
  constructor(public events: GreenpowerEventsService, private telemetry: GreenpowerTelemetryService, private functions: AngularFireFunctions) {
    this.subscription = events.permissions.state.subscribe(state => {
      if (!state.isAdmin || this.uid && this.uid !== state.uid) { this.generation++; this.reset(); this.saving = false; this.notice = ''; }
      this.uid = state.ready ? state.uid : ''; this.changed.next();
    });
  }
  get locked() { return this.saving || this.uncertain; }
  get isNew() { return !this.baseSession; }
  get sourceEvent() { return this.baseEvent; }
  private reset() {
    this.mode = ''; this.draft = {}; this.prepared = undefined; this.newId = '';
    this.baseEvent = this.baseSession = undefined;
    this.reviewing = this.uncertain = false; this.error = ''; this.changed.next();
  }
  cancel() { if (!this.locked) { this.reset(); this.notice = ''; } }
  private begin(mode: 'event' | 'session') {
    if (!this.events.canEdit || this.locked || !this.events.eventReady || !this.events.selectedEvent) return false;
    if (this.events.ambiguousHistoricalEvent) { this.error = 'Review this day’s historical event metadata before editing.'; this.changed.next(); return false; }
    this.reset(); this.mode = mode; this.notice = ''; this.newId = crypto.randomUUID();
    this.baseEvent = JSON.parse(JSON.stringify(this.events.selectedEvent));
    return true;
  }
  event() {
    if (!this.begin('event')) return;
    this.draft = editable(this.baseEvent!); this.changed.next();
  }
  session(create = false, range?: { start: number; end: number }) {
    if (!create && !this.events.selectedSession || !this.begin('session')) return;
    if (!create) {
      this.baseSession = JSON.parse(JSON.stringify(this.events.selectedSession)); this.draft = { ...editable(this.baseSession!), type: this.baseSession!.type || 'other' };
    } else {
      this.draft = { name: '', type: '', eventId: this.baseEvent!.id, metadataStatus: 'unmatched', segments: [] };
      if (!this.telemetry.live && this.telemetry.day === this.baseEvent!.date) this.replaceRange(range || { start: this.telemetry.start, end: this.telemetry.end });
    }
    this.changed.next();
  }
  private capture(range: { start: number; end: number }, append: boolean) {
    if (this.mode !== 'session' || this.locked || this.reviewing) return;
    try {
      const segments = [...(append ? this.draft.segments || [] : []), ...this.telemetry.range(range.start, range.end)].sort((a, b) => a.firstAt - b.firstAt);
      if (this.telemetry.day !== this.baseEvent?.date || segments.some(segment => segment.day !== this.baseEvent?.date)) throw new Error('Sessions must stay within this event’s UK day.');
      if (!validSegments(segments)) throw new Error('Choose ordered, non-overlapping ranges, up to 20 in total.');
      this.draft = { ...this.draft, segments, firstAt: segments[0].firstAt, lastAt: segments.at(-1)!.lastAt }; this.error = '';
    } catch (error) { this.error = error instanceof Error ? error.message : 'Choose a recorded range.'; }
    this.changed.next();
  }
  addRange(range: { start: number; end: number }) { this.capture(range, true); }
  replaceRange(range: { start: number; end: number }) { this.capture(range, false); }
  removeRange(index: number) {
    if (this.locked || this.reviewing) return;
    const segments = this.draft.segments?.filter((_, at) => at !== index) || [];
    this.draft = { ...this.draft, segments, firstAt: segments[0]?.firstAt, lastAt: segments.at(-1)?.lastAt }; this.changed.next();
  }
  back() { if (!this.locked) { this.prepared = undefined; this.reviewing = false; this.error = ''; this.changed.next(); } }
  private build(): EventEditRequest {
    const event = this.baseEvent;
    if (!event || event.id !== event.date) throw new Error('Choose an event.');
    if (this.mode === 'session') {
      if (!this.draft.type) throw new Error('Choose a session type.');
      if (!this.baseSession) this.draft.name = SESSION_TYPES.find(type => type.id === this.draft.type)?.label || '';
    }
    this.draft = cleanDraft(this.draft);
    const error = metadataError(this.draft, this.mode === 'session'); if (error) throw new Error(error);
    let data: EventData | undefined;
    const sessions: EventEditRequest['sessions'] = [];
    if (this.mode === 'event') {
      if (this.draft.date !== event.date) throw new Error('An event’s recorded UK day cannot change.');
      data = editable(this.draft as EventData);
    } else {
      if (this.draft.segments!.some(segment => segment.day !== event.date)) throw new Error('Sessions must stay within this event’s UK day.');
      sessions.push({ id: this.baseSession?.id || this.newId, expectedRevision: this.baseSession?.revision || 0,
        data: { ...editable(this.draft as SessionData), eventId: event.id } });
      if (!event.revision) data = editable(event);
    }
    return { requestId: crypto.randomUUID(), action: 'edit',
      events: [{ id: event.id, expectedRevision: event.revision, ...(data ? { data } : {}) }], sessions };
  }
  review() {
    if (!this.events.canEdit || this.locked) return;
    try { this.prepared = this.build(); this.reviewing = true; this.error = ''; }
    catch (error) { this.error = error instanceof Error ? error.message : 'Check the metadata.'; }
    this.changed.next();
  }
  async save() {
    if (!this.events.canEdit || this.saving || !this.reviewing || !this.prepared) return;
    const request = this.prepared, generation = this.generation, uid = this.uid;
    this.saving = true; this.error = ''; this.changed.next();
    try {
      const result = await firstValueFrom(this.functions.httpsCallable<EventEditRequest, EventEditResult>('greenpowerEventEdit', { timeout: 35000 })(request));
      if (generation !== this.generation || !this.events.canEdit || this.uid !== uid) return;
      this.events.acknowledge(request, result, this.baseSession ? [this.baseSession] : []);
      const newSession = request.sessions.find(change => !change.expectedRevision)?.id;
      this.uncertain = false; this.saving = false; this.reset(); this.notice = 'Saved';
      // A session save does not change the event list's date/track selection.
      if (request.sessions.length) void this.events.loadSessions(true);
      else void this.events.loadEvents(true);
      if (newSession && this.events.eventReady) this.events.selectSession(newSession);
    } catch (error) {
      if (generation !== this.generation || this.uid !== uid) return;
      const code = (error as { code?: string })?.code?.replace('functions/', '');
      this.uncertain = !['invalid-argument', 'failed-precondition', 'already-exists', 'permission-denied', 'unauthenticated', 'not-found', 'resource-exhausted'].includes(code || '');
      this.error = code === 'failed-precondition' ? 'Metadata changed elsewhere. Cancel and reopen the editor.'
        : code === 'not-found' ? 'The event editor is not available on the server.'
        : this.uncertain ? 'Save status is unknown. Retry this save before making another edit.' : 'Could not save. Check the fields or cancel and reopen.';
      if (!this.uncertain) { this.reviewing = false; this.prepared = undefined; }
    } finally { if (generation === this.generation) { this.saving = false; this.changed.next(); } }
  }
  ngOnDestroy() { this.generation++; this.subscription.unsubscribe(); this.changed.complete(); }
}

function cleanDraft(data: MetadataDraft): MetadataDraft {
  const clean = JSON.parse(JSON.stringify(data));
  for (const key of ['name', 'location', 'localTime', 'description', 'notes', 'driver', 'operator', 'result']) {
    if (typeof clean[key] === 'string') { clean[key] = clean[key].trim(); if (!clean[key] && key !== 'name') delete clean[key]; }
  }
  if (clean.engineering) {
    for (const key of Object.keys(clean.engineering)) if (typeof clean.engineering[key] === 'string') {
      clean.engineering[key] = clean.engineering[key].trim(); if (!clean.engineering[key]) delete clean.engineering[key];
    }
    if (!Object.keys(clean.engineering).length) delete clean.engineering;
  }
  return clean;
}
