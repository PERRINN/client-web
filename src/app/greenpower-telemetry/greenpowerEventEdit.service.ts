import { Injectable, OnDestroy } from '@angular/core';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { firstValueFrom, Subject, Subscription } from 'rxjs';
import { editable, EventData, EventEditRequest, EventEditResult, MetadataDraft, metadataError, SessionData, TelemetryEvent, TelemetrySession, validSegments } from './greenpowerEvents';
import { GreenpowerEventsService } from './greenpowerEvents.service';
import { GreenpowerTelemetryService } from './greenpowerTelemetry.service';

@Injectable()
export class GreenpowerEventEditService implements OnDestroy {
  readonly changed = new Subject<void>();
  mode: '' | 'event' | 'session' | 'merge' = '';
  draft: MetadataDraft = {};
  splitDraft?: EventData;
  targetEventId = '';
  selected = new Map<string, TelemetrySession>();
  reviewing = false;
  saving = false;
  uncertain = false;
  error = '';
  notice = '';
  loadingReferences = false;
  private references: TelemetryEvent[] = [];
  private baseEvent?: TelemetryEvent;
  private baseSession?: TelemetrySession;
  private newId = '';
  private prepared?: EventEditRequest;
  private beforeSessions: TelemetrySession[] = [];
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
  get isNew() { return this.mode === 'event' ? !this.baseEvent : !this.baseSession; }
  get target() { return this.events.events.find(event => event.id === this.targetEventId) || (this.events.selectedEvent?.id === this.targetEventId ? this.events.selectedEvent : undefined) || (this.baseEvent?.id === this.targetEventId ? this.baseEvent : undefined); }
  get sourceEvent() { return this.baseEvent; }
  get sourceName() { return this.baseEvent?.name || ''; }
  get remaining() { return Math.max(0, (this.baseEvent?.sessionCount || 0) - this.selected.size); }
  private reset() {
    this.mode = ''; this.draft = {}; this.splitDraft = undefined; this.prepared = undefined;
    this.newId = ''; this.references = []; this.loadingReferences = false;
    this.baseEvent = this.baseSession = undefined; this.selected.clear(); this.targetEventId = '';
    this.reviewing = this.uncertain = false; this.error = ''; this.changed.next();
  }
  cancel() { if (!this.locked) { this.reset(); this.notice = ''; } }
  private begin(mode: 'event' | 'session' | 'merge') {
    if (!this.events.canEdit || this.locked) return false;
    this.reset(); this.mode = mode; this.notice = ''; this.newId = crypto.randomUUID();
    this.baseEvent = this.events.selectedEvent ? JSON.parse(JSON.stringify(this.events.selectedEvent)) : undefined;
    return true;
  }
  async event(create = false) {
    if (!this.begin('event')) return;
    if (create) this.baseEvent = undefined;
    this.draft = this.baseEvent ? editable(this.baseEvent) : this.emptyEvent(); this.changed.next();
    if (this.baseEvent?.state === 'superseded') {
      const ids = this.baseEvent.supersededBy || [], context = this.newId;
      if (!ids.length || ids.length > 3) { this.error = 'Event links are invalid. Reopen the event before saving.'; return; }
      this.loadingReferences = true; this.changed.next();
      try {
        const references = await Promise.all(ids.map(id => this.events.eventReference(id)));
        if (context === this.newId) this.references = references;
      } catch { if (context === this.newId) this.error = 'Could not load event links. Cancel and reopen the editor.'; }
      finally { if (context === this.newId) { this.loadingReferences = false; this.changed.next(); } }
    }
  }
  private emptyEvent(): EventData {
    return { name: '', type: '', date: this.telemetry.day, timeZone: 'Europe/London', state: 'active', metadataStatus: 'review_needed' };
  }
  session(create = false, range?: { start: number; end: number }) {
    if (!create && (!this.events.selectedSession || this.events.selectedEvent?.state !== 'active') || !this.begin('session')) return;
    if (!create && this.events.selectedSession) {
      this.baseSession = JSON.parse(JSON.stringify(this.events.selectedSession)); this.draft = editable(this.baseSession!);
    } else {
      this.draft = { name: '', eventId: this.baseEvent?.state === 'active' ? this.baseEvent.id : '', metadataStatus: 'review_needed', segments: [] };
      try {
        const segments = this.telemetry.range(range?.start ?? this.telemetry.start, range?.end ?? this.telemetry.end);
        Object.assign(this.draft, { firstAt: segments[0].firstAt, lastAt: segments.at(-1)!.lastAt, segments });
      } catch (error) {
        // An empty draft can wait for a recording; an invalid loaded range needs feedback.
        if (!this.telemetry.live && !this.telemetry.loading && !this.telemetry.more && this.telemetry.channels?.length) this.error = error instanceof Error ? error.message : 'Choose a recorded range.';
      }
      if (!this.telemetry.dates.length && !this.telemetry.loadingDates) void this.telemetry.loadDates();
    }
    this.targetEventId = this.draft.eventId || ''; this.changed.next();
  }
  addRange(range: { start: number; end: number }) {
    if (this.mode !== 'session' || this.locked || this.reviewing) return;
    try {
      const segments = [...(this.draft.segments || []), ...this.telemetry.range(range.start, range.end)].sort((a, b) => a.firstAt - b.firstAt);
      const next = { ...this.draft, segments, firstAt: segments[0].firstAt, lastAt: segments.at(-1)!.lastAt };
      if (!validSegments(segments)) throw new Error('Choose ordered, non-overlapping ranges, up to 20 in total.');
      this.draft = next; this.error = '';
    } catch (error) { this.error = error instanceof Error ? error.message : 'Could not add range.'; }
    this.changed.next();
  }
  replaceRange(range: { start: number; end: number }) {
    if (this.mode !== 'session' || this.locked || this.reviewing) return;
    try {
      const segments = this.telemetry.range(range.start, range.end);
      this.draft = { ...this.draft, segments, firstAt: segments[0].firstAt, lastAt: segments.at(-1)!.lastAt }; this.error = '';
    } catch (error) { this.error = error instanceof Error ? error.message : 'Choose a recorded range.'; }
    this.changed.next();
  }
  removeRange(index: number) {
    if (this.locked || this.reviewing) return;
    const segments = this.draft.segments?.filter((_, at) => at !== index) || [];
    this.draft = { ...this.draft, segments, firstAt: segments[0]?.firstAt, lastAt: segments.at(-1)?.lastAt }; this.changed.next();
  }
  split() {
    if (this.mode !== 'session' || !this.baseSession || this.locked) return;
    this.splitDraft = this.splitDraft ? undefined : this.emptyEvent(); this.changed.next();
  }
  merge() {
    if (!this.events.selectedEvent?.sessionCount || !this.begin('merge')) return;
    this.changed.next();
  }
  toggle(session: TelemetrySession, checked: boolean) {
    if (this.locked || this.reviewing || this.mode !== 'merge') return;
    if (checked && this.selected.size < 20) this.selected.set(session.id, JSON.parse(JSON.stringify(session)));
    else if (!checked) this.selected.delete(session.id);
    this.changed.next();
  }
  back() { if (!this.locked) { this.prepared = undefined; this.reviewing = false; this.error = ''; this.changed.next(); } }
  private build(): EventEditRequest {
    this.draft = cleanDraft(this.draft);
    if (this.splitDraft) this.splitDraft = cleanDraft(this.splitDraft) as EventData;
    const events: EventEditRequest['events'] = [], sessions: EventEditRequest['sessions'] = [];
    const addEvent = (event: TelemetryEvent, data?: EventData) => {
      if (!events.some(change => change.id === event.id)) events.push({ id: event.id, expectedRevision: event.revision, ...(data ? { data } : {}) });
    };
    let action: EventEditRequest['action'] = 'edit'; this.beforeSessions = [];
    if (this.mode === 'event') {
      const error = metadataError(this.draft); if (error) throw new Error(error);
      events.push({ id: this.baseEvent?.id || this.newId, expectedRevision: this.baseEvent?.revision || 0, data: editable(this.draft as EventData) });
      if (this.draft.state === 'superseded') for (const id of this.draft.supersededBy || []) {
        const reference = this.references.find(event => event.id === id);
        if (!reference) throw new Error('Could not load event links. Cancel and reopen the editor.');
        addEvent(reference);
      }
    } else {
      if (this.mode === 'session' && !this.baseSession && this.target) this.baseEvent = JSON.parse(JSON.stringify(this.target));
      if (!this.baseEvent) throw new Error('Choose an event.');
      addEvent(this.baseEvent);
      let targetId = this.targetEventId;
      if (this.splitDraft) {
        const error = metadataError(this.splitDraft); if (error) throw new Error(error);
        targetId = this.newId; events.push({ id: targetId, expectedRevision: 0, data: editable(this.splitDraft) }); action = 'split';
      } else {
        const target = this.target;
        if (!target || target.state !== 'active') throw new Error('Choose an active target event.');
        addEvent(target); if (target.id !== this.baseEvent.id) action = 'reassign';
      }
      if (this.mode === 'session') {
        const data = { ...editable(this.draft as SessionData), eventId: targetId };
        const error = metadataError(data, true); if (error) throw new Error(error);
        if (this.baseSession) this.beforeSessions = [this.baseSession];
        sessions.push({ id: this.baseSession?.id || (this.splitDraft ? crypto.randomUUID() : this.newId), expectedRevision: this.baseSession?.revision || 0, data });
        if (!this.baseSession && action !== 'edit') action = 'edit';
      } else {
        if (targetId === this.baseEvent.id || !this.selected.size) throw new Error('Choose a different event and up to 20 sessions.');
        action = 'merge'; this.beforeSessions = Array.from(this.selected.values());
        for (const session of this.beforeSessions) sessions.push({ id: session.id, expectedRevision: session.revision, data: { ...editable(session), eventId: targetId } });
        if (this.remaining === 0) events[0].data = { ...editable(this.baseEvent), state: 'superseded', supersededBy: [targetId] };
      }
    }
    if (sessions.reduce((count, change) => count + change.data!.segments.length, 0) > 20) throw new Error('Choose sessions with at most 20 recording ranges in total.');
    const payload: EventEditRequest = { requestId: crypto.randomUUID(), action, events, sessions };
    if (new TextEncoder().encode(JSON.stringify(payload)).length > 128 * 1024) throw new Error('Choose fewer sessions or shorten the metadata.');
    return payload;
  }
  review() {
    if (!this.events.canEdit || this.locked || this.loadingReferences) return;
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
      this.events.acknowledge(request, result, this.beforeSessions);
      const newEvent = this.mode === 'event' && !this.baseEvent ? request.events[0].id : undefined;
      const newSession = request.sessions.find(change => change.expectedRevision === 0 && change.data?.eventId === this.events.eventId)?.id;
      this.uncertain = false; this.saving = false; this.reset(); this.notice = 'Saved';
      void this.events.loadEvents(true);
      if (newEvent) this.events.selectEvent(newEvent);
      else if (this.events.eventReady) void this.events.loadSessions(true);
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
