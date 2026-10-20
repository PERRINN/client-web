import { Injectable, OnDestroy } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { Subject, Subscription } from 'rxjs';
import { PermissionsService } from '../permissions.service';
import { defaultEventFilters, EVENT_ROOT, EventFilters, validDate, validId } from './greenpowerEvents';
import { DayEditRequest, DayEditResult, DaySession, emptyDay, eventListSummary, RecordedEvent, validRecordedEvent, validDaySession, SESSION_SCOPE } from './greenpowerDay';
import { TrackChoice, TRACKS_PATH, validTrack } from './greenpowerTracks';

@Injectable()
export class GreenpowerEventsService implements OnDestroy {
  readonly changed = new Subject<void>();
  events: RecordedEvent[] = [];
  selectedEvent?: RecordedEvent;
  selectedSession?: DaySession;
  sessions: DaySession[] = [];
  loadingSessions = false;
  moreSessions = false;
  sessionError = '';
  private sessionCursor?: firebase.firestore.QueryDocumentSnapshot;
  private sessionsGeneration = 0;
  private sessionSelection = 0;
  private sessionOff?: () => void;
  eventId = '';
  sessionId = '';
  loadingEvents = false;
  loadedEvents = false;
  eventReady = false;
  migrated = false;
  listError = '';
  error = '';
  filters: EventFilters = defaultEventFilters();
  tracks: TrackChoice[] = [];
  loadingTracks = false;
  moreTracks = false;
  trackError = '';
  private trackPages = 0;
  private trackCursor?: firebase.firestore.QueryDocumentSnapshot;
  private pendingTrack?: { id: string; name: string };
  private account = '';
  private generation = 0;
  private listGeneration = 0;
  private selection = 0;
  private eventOff?: () => void;
  private destroyed = false;
  private readonly db: firebase.firestore.Firestore;
  private readonly subscription: Subscription;
  constructor(public permissions: PermissionsService, firestore: AngularFirestore) {
    this.db = firestore.firestore;
    this.subscription = permissions.state.subscribe(state => {
      const uid = state.ready ? state.uid : '';
      if (uid !== this.account) {
        this.account = uid; this.generation++; this.listGeneration++; this.clear();
        this.events = []; this.loadedEvents = this.loadingEvents = false; this.listError = '';
        this.tracks = []; this.trackPages = 0; this.trackCursor = undefined; this.loadingTracks = this.moreTracks = false;
        this.pendingTrack = undefined; this.trackError = ''; this.filters = defaultEventFilters();
      }
      this.changed.next();
    });
  }
  get canEdit() { return !!this.account && this.permissions.current.isAdmin && this.permissions.current.uid === this.account; }
  get sessionReady() { return this.eventReady && !!this.selectedSession; }
  private valid(generation: number) { return !this.destroyed && !!this.account && generation === this.generation; }
  async loadEvents(reset = false, filters = this.filters) {
    if (!this.account || this.destroyed || this.loadingEvents && !reset) return;
    const typeChanged = filters.type !== this.filters.type;
    this.filters = { ...filters };
    if (typeChanged && this.eventReady) { this.selectSession(''); void this.loadSessions(true); }
    const generation = this.generation, list = ++this.listGeneration;
    const current = () => this.valid(generation) && list === this.listGeneration;
    this.loadingEvents = true; this.listError = ''; this.changed.next();
    try {
      const { from, to, location } = filters;
      if (!validDate(from) || !validDate(to) || from.slice(0, 4) !== to.slice(0, 4) || from > to) throw new Error('Choose a valid year.');
      let query = this.db.collection(EVENT_ROOT + '/days').where('date', '>=', from).where('date', '<=', to);
      if (location) query = query.where('trackId', '==', location);
      const snapshot = await query.orderBy('date', 'desc').orderBy(firebase.firestore.FieldPath.documentId(), 'desc').limit(367).get({ source: 'server' });
      if (!current()) return;
      if (snapshot.size > 366) throw new Error('Invalid recording days.');
      this.events = snapshot.docs.map(doc => {
        const value = doc.data();
        if (!validDate(doc.id) || value.date !== doc.id || doc.id < from || doc.id > to || value.schemaVersion === 2 && !validRecordedEvent(value)) throw new Error('Invalid recording metadata.');
        return value.schemaVersion === 2 ? value as RecordedEvent : emptyDay(doc.id);
      });
      this.loadedEvents = true;
    } catch (error) { if (current()) this.listError = error instanceof Error && error.message === 'Choose a valid year.' ? error.message : 'Could not load events. Try again.'; }
    finally { if (current()) { this.loadingEvents = false; this.changed.next(); } }
  }
  eventLabel(date: string) {
    const event = this.selectedEvent?.date === date ? this.selectedEvent : this.events.find(event => event.date === date);
    return [date, event ? eventListSummary(event) : ''].filter(Boolean).join(' · ');
  }
  clear() {
    this.sessionsGeneration++; this.sessionSelection++; this.sessionOff?.(); this.sessionOff = undefined;
    this.sessions = []; this.sessionCursor = undefined; this.loadingSessions = this.moreSessions = false; this.sessionError = '';
    this.selection++; this.eventOff?.(); this.eventOff = undefined;
    this.eventId = this.sessionId = ''; this.selectedEvent = this.selectedSession = undefined;
    this.eventReady = this.migrated = false; this.error = ''; this.changed.next();
  }
  selectEvent(date: string) {
    if (!this.account || !validDate(date)) return;
    this.clear(); this.eventId = date;
    const generation = this.generation, selection = this.selection;
    this.eventOff = this.db.doc(EVENT_ROOT + '/days/' + date).onSnapshot({ includeMetadataChanges: true }, snapshot => {
      if (!this.valid(generation) || selection !== this.selection || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const value = snapshot.data();
      if (!snapshot.exists || value?.date !== date || value.schemaVersion === 2 && !validRecordedEvent(value)) {
        this.eventReady = false; this.selectedEvent = this.selectedSession = undefined; this.error = 'Event is unavailable.';
      } else {
        if (this.selectedEvent && value.schemaVersion === 2 && value.revision < this.selectedEvent.revision) return;
        this.migrated = value.schemaVersion === 2;
        const first = !this.eventReady;
        this.accept(this.migrated ? value as RecordedEvent : emptyDay(date)); this.eventReady = true; this.error = '';
        if (first && this.migrated) void this.loadSessions(true);
      }
      this.changed.next();
    }, () => { if (this.valid(generation) && selection === this.selection) { this.eventReady = false; this.error = 'Could not load event. Try again.'; this.changed.next(); } });
    this.changed.next();
  }
  async loadSessions(reset = false) {
    if (!this.account || !this.eventReady || !this.migrated || this.loadingSessions && !reset) return;
    if (reset) { this.sessionsGeneration++; this.sessions = []; this.sessionCursor = undefined; this.moreSessions = false; }
    const generation = this.generation, selection = this.selection, list = this.sessionsGeneration, date = this.eventId;
    const current = () => this.valid(generation) && selection === this.selection && list === this.sessionsGeneration;
    this.loadingSessions = true; this.sessionError = ''; this.changed.next();
    try {
      let query: firebase.firestore.Query = this.db.collection(EVENT_ROOT + '/days/' + date + '/sessions');
      if (this.filters.type) query = query.where('type', '==', this.filters.type);
      query = query.orderBy('startAt').orderBy(firebase.firestore.FieldPath.documentId()).limit(30);
      if (this.sessionCursor) query = query.startAfter(this.sessionCursor);
      const snapshot = await query.get({ source: 'server' });
      if (!current()) return;
      const values = snapshot.docs.map(doc => { const value = doc.data(); if (value.id !== doc.id || !validDaySession(value, date)) throw new Error('Invalid session'); return value; });
      this.sessions.push(...values.filter(value => !this.sessions.some(item => item.id === value.id)));
      this.sessionCursor = snapshot.docs.at(-1) || this.sessionCursor; this.moreSessions = snapshot.size === 30;
    } catch { if (current()) this.sessionError = 'Could not load sessions. Try again.'; }
    finally { if (current()) { this.loadingSessions = false; this.changed.next(); } }
  }
  /** One unfiltered metadata page per action, independent of pending history filters. */
  async recordingSessionPage(date: string, after?: { start: number; id: string }) {
    if (!this.account || !validDate(date)) throw new Error('Unavailable event');
    const generation = this.generation;
    let query = this.db.collection(EVENT_ROOT + '/days/' + date + '/sessions')
      .orderBy('startAt').orderBy(firebase.firestore.FieldPath.documentId()).limit(30);
    if (after) query = query.startAfter(after.start, after.id);
    const snapshot = await query.get({ source: 'server' });
    if (!this.valid(generation)) throw new Error('Account changed');
    const sessions = snapshot.docs.map(doc => {
      const value = doc.data();
      if (value.id !== doc.id || !validDaySession(value, date)) throw new Error('Invalid session');
      return value;
    });
    return { sessions, more: snapshot.size === 30 };
  }
  selectSession(id: string) {
    if (!this.eventReady || id && !validId(id)) return;
    this.sessionSelection++; this.sessionOff?.(); this.sessionOff = undefined;
    this.sessionId = id; this.selectedSession = undefined; this.error = '';
    if (!id) { this.changed.next(); return; }
    const generation = this.generation, selection = this.selection, sessionSelection = this.sessionSelection, date = this.eventId;
    const current = () => this.valid(generation) && selection === this.selection && sessionSelection === this.sessionSelection;
    this.sessionOff = this.db.doc(EVENT_ROOT + '/days/' + date + '/sessions/' + id).onSnapshot({ includeMetadataChanges: true }, snapshot => {
      if (!current() || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const value = snapshot.data();
      if (!snapshot.exists || value?.id !== id || !validDaySession(value, date)) {
        this.selectedSession = undefined; this.error = 'Session is unavailable.';
      } else {
        if (this.selectedSession && value.revision! < this.selectedSession.revision!) return;
        this.selectedSession = value; this.error = '';
        this.sessions = this.sessions.map(item => item.id === id ? value : item);
      }
      this.changed.next();
    }, () => { if (current()) { this.selectedSession = undefined; this.error = 'Could not load session.'; this.changed.next(); } });
    this.changed.next();
  }
  private accept(event: RecordedEvent) {
    this.selectedEvent = event;
    this.events = this.events.map(item => item.date === event.date ? event : item)
      .filter(item => !this.filters.location || item.trackId === this.filters.location);
  }
  acknowledge(request: DayEditRequest, result: DayEditResult) {
    if (this.eventId !== result.date) return;
    if (request.kind === 'event' && (!this.selectedEvent || this.selectedEvent.revision < result.revision)) {
      this.accept({ ...request.data, ...(result.sessionTypeCounts === undefined ? {} : { sessionTypeCounts: result.sessionTypeCounts }), schemaVersion: 2, revision: result.revision, updatedBy: this.account });
    } else if (request.kind === 'session') {
      const saved = { ...request.session, schemaVersion: 2 as const, telemetryRoot: SESSION_SCOPE, revision: result.sessionRevision!, updatedBy: this.account };
      const previous = this.sessions.find(item => item.id === saved.id);
      if (!previous || previous.revision! < saved.revision) {
        this.sessions = this.sessions.filter(item => item.id !== saved.id);
        if (!this.filters.type || this.filters.type === saved.type) this.sessions.push(saved);
        this.sessions.sort((a, b) => a.startAt - b.startAt || a.id.localeCompare(b.id));
      }
    }
    this.changed.next();
  }
  async loadTracks() {
    if (!this.account || this.loadingTracks || this.trackPages >= 10) return;
    const generation = this.generation;
    this.loadingTracks = true; this.trackError = ''; this.changed.next();
    try {
      let query = this.db.collection(TRACKS_PATH).orderBy('name').orderBy(firebase.firestore.FieldPath.documentId()).limit(30);
      if (this.trackCursor) query = query.startAfter(this.trackCursor);
      const snapshot = await query.get({ source: 'server' });
      if (!this.valid(generation)) return;
      const tracks = snapshot.docs.map(doc => { const value = doc.data(); if (!validTrack(value)) throw new Error('Invalid track'); return { ...value, id: doc.id } as TrackChoice; });
      this.tracks = [...this.tracks, ...tracks.filter(track => !this.tracks.some(item => item.id === track.id))];
      this.trackCursor = snapshot.docs.at(-1) || this.trackCursor; this.trackPages++;
      this.moreTracks = snapshot.size === 30 && this.trackPages < 10;
    } catch { if (this.valid(generation)) this.trackError = 'Could not load tracks.'; }
    finally { if (this.valid(generation)) { this.loadingTracks = false; this.changed.next(); } }
  }
  async ensureTrack(id: string | null) {
    if (!id || this.tracks.some(track => track.id === id) || !this.account) return;
    const generation = this.generation;
    try {
      const snapshot = await this.db.doc(TRACKS_PATH + '/' + id).get({ source: 'server' });
      if (!this.valid(generation)) return;
      const value = snapshot.data();
      if (!snapshot.exists || !validTrack(value)) throw new Error('Missing track');
      if (!this.tracks.some(track => track.id === id)) this.tracks.push({ ...value, id });
    } catch { if (this.valid(generation)) this.trackError = 'Selected track is unavailable.'; }
    this.changed.next();
  }
  async addTrack(name: string) {
    name = name.trim();
    if (!this.canEdit || !name || name.length > 60 || this.loadingTracks) return '';
    // Keep the same generated ID after an unknown outcome, so retry cannot create duplicates.
    if (this.pendingTrack && this.pendingTrack.name !== name) { this.trackError = 'Retry the pending track name first.'; this.changed.next(); return ''; }
    this.pendingTrack ||= { id: this.db.collection(TRACKS_PATH).doc().id, name };
    const pending = this.pendingTrack, generation = this.generation, uid = this.account;
    const ref = this.db.doc(TRACKS_PATH + '/' + pending.id);
    this.loadingTracks = true; this.trackError = ''; this.changed.next();
    try {
      let attempts = 0;
      await this.db.runTransaction(async transaction => {
        if (++attempts > 3) throw new Error('Retry budget exceeded');
        if (!this.valid(generation) || !this.canEdit) throw new Error('Access changed');
        const snapshot = await transaction.get(ref);
        if (!this.valid(generation) || !this.canEdit) throw new Error('Access changed');
        if (snapshot.exists) { if (snapshot.data()?.name !== name || snapshot.data()?.updatedBy !== uid) throw new Error('Conflict'); return; }
        transaction.set(ref, { name, bounds: null, line: null, cells: [], revision: 1, updatedBy: uid, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      });
      if (!this.valid(generation)) return '';
      this.pendingTrack = undefined;
      this.tracks.push({ id: pending.id, name, bounds: null, line: null, cells: [], revision: 1, updatedBy: uid });
      return pending.id;
    } catch { if (this.valid(generation)) this.trackError = 'Could not save track. Retry with the same name.'; return ''; }
    finally { if (this.valid(generation)) { this.loadingTracks = false; this.changed.next(); } }
  }
  ngOnDestroy() { this.destroyed = true; this.generation++; this.listGeneration++; this.clear(); this.subscription.unsubscribe(); this.changed.complete(); }
}
