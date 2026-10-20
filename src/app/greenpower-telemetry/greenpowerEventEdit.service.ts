import { Injectable, OnDestroy } from '@angular/core';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { firstValueFrom, Subject, Subscription } from 'rxjs';
import { DayEditRequest, DayEditResult, DayMetadata, DaySession, dayMetadataError, sessionMetadataError, editableSession, editableDay, RecordedEvent } from './greenpowerDay';
import { GreenpowerEventsService } from './greenpowerEvents.service';
import { GreenpowerTelemetryService } from './greenpowerTelemetry.service';

@Injectable()
export class GreenpowerEventEditService implements OnDestroy {
  readonly changed = new Subject<void>();
  mode: '' | 'event' | 'session' = '';
  draft?: DayMetadata;
  sessionDraft?: DaySession;
  reviewing = false;
  saving = false;
  uncertain = false;
  error = '';
  notice = '';
  private base?: RecordedEvent;
  private prepared?: DayEditRequest;
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
  get sourceEvent() { return this.base; }
  private reset() { this.mode = ''; this.draft = undefined; this.sessionDraft = undefined; this.base = undefined; this.prepared = undefined; this.reviewing = this.uncertain = false; this.error = ''; this.changed.next(); }
  cancel() { if (!this.locked) { this.generation++; this.reset(); this.notice = ''; } }
  private begin(mode: 'event' | 'session') {
    if (!this.events.canEdit || this.locked || !this.events.eventReady || !this.events.selectedEvent) return false;
    if (!this.events.migrated) { this.error = 'This day requires metadata migration before editing.'; this.changed.next(); return false; }
    this.reset(); this.mode = mode; this.notice = '';
    this.base = JSON.parse(JSON.stringify(this.events.selectedEvent)); this.draft = editableDay(this.base!);
    return true;
  }
  event() {
    if (!this.begin('event')) return;
    if (!this.events.tracks.length) void this.events.loadTracks();
    void this.events.ensureTrack(this.draft!.trackId); this.changed.next();
  }
  session(create = false, range?: { start: number; end: number }) {
    if (!create && !this.events.selectedSession || !this.begin('session')) return;
    this.sessionDraft = create ? { id: crypto.randomUUID(), type: '', startAt: 0, endAt: 0, batteryIds: [], overrides: {}, ranges: [] }
      : JSON.parse(JSON.stringify(this.events.selectedSession));
    if (create && range) this.replaceRange(range);
    this.changed.next();
  }
  setBoundary(boundary: 'start' | 'end', time: number) {
    const session = this.sessionDraft;
    if (!session || this.locked || this.reviewing || !Number.isFinite(time)) return;
    const start = boundary === 'start' ? time : session.startAt;
    const end = boundary === 'end' ? time : session.endAt;
    if (start > end) {
      this.error = 'Start must be at or before end.'; this.changed.next(); return;
    }
    this.replaceRange({ start, end });
  }
  replaceRange(range: { start: number; end: number }) {
    if (!this.sessionDraft || !this.draft || this.locked || this.reviewing) return;
    try {
      if (this.telemetry.day !== this.base?.date) throw new Error('Load this event before choosing a recording range.');
      const ranges = this.telemetry.range(range.start, range.end);
      this.sessionDraft.ranges = ranges;
      this.sessionDraft.startAt = ranges[0].firstAt; this.sessionDraft.endAt = ranges.at(-1)!.lastAt;
      this.error = '';
    } catch (error) { this.error = error instanceof Error ? error.message : 'Choose a recorded range.'; }
    this.changed.next();
  }
  back() { if (!this.locked) { this.prepared = undefined; this.reviewing = false; this.error = ''; this.changed.next(); } }
  review() {
    if (!this.events.canEdit || this.locked || !this.draft || !this.base) return;
    try {
      this.draft.eventName = this.draft.eventName.trim(); this.draft.result = this.draft.result.trim();
      const error = this.sessionDraft ? sessionMetadataError(this.sessionDraft, this.base.date) : dayMetadataError(this.draft); if (error) throw new Error(error);
      const common = { schemaVersion: 2 as const, requestId: crypto.randomUUID(), date: this.base.date, expectedRevision: this.base.revision };
      this.prepared = this.sessionDraft
        ? { ...common, kind: 'session', expectedSessionRevision: this.sessionDraft.revision || 0, session: editableSession(this.sessionDraft) }
        : { ...common, kind: 'event', data: JSON.parse(JSON.stringify(this.draft)) };
      this.reviewing = true; this.error = '';
    } catch (error) { this.error = error instanceof Error ? error.message : 'Check the metadata.'; }
    this.changed.next();
  }
  async save() {
    if (!this.events.canEdit || this.saving || !this.reviewing || !this.prepared) return;
    const request = this.prepared, generation = this.generation, uid = this.uid;
    this.saving = true; this.error = ''; this.changed.next();
    try {
      const result = await firstValueFrom(this.functions.httpsCallable<DayEditRequest, DayEditResult>('greenpowerEventEdit', { timeout: 35000 })(request));
      if (generation !== this.generation || !this.events.canEdit || this.uid !== uid) return;
      this.events.acknowledge(request, result);
      const sessionId = this.sessionDraft?.id;
      this.saving = false; this.reset(); this.notice = 'Saved';
      if (sessionId) this.events.selectSession(sessionId);
    } catch (error) {
      if (generation !== this.generation || this.uid !== uid) return;
      const code = (error as { code?: string })?.code?.replace('functions/', '');
      this.uncertain = !['invalid-argument', 'failed-precondition', 'already-exists', 'permission-denied', 'unauthenticated', 'not-found', 'resource-exhausted'].includes(code || '');
      this.error = code === 'failed-precondition' ? 'Metadata changed elsewhere. Cancel and reopen the editor.'
        : this.uncertain ? 'Save status is unknown. Retry this save before making another edit.' : 'Could not save. Check the fields or reopen the editor.';
      if (!this.uncertain) { this.reviewing = false; this.prepared = undefined; }
    } finally { if (generation === this.generation) { this.saving = false; this.changed.next(); } }
  }
  ngOnDestroy() { this.generation++; this.subscription.unsubscribe(); this.changed.complete(); }
}
