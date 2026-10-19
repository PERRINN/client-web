import { Injectable, OnDestroy } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { Subject, Subscription } from 'rxjs';
import { PermissionsService } from '../permissions.service';
import { editable, EVENT_PAGE_SIZE, EVENT_ROOT, EventEditRequest, EventEditResult, EventFilters, locationKey, TelemetryEvent, TelemetrySession, validEvent, validId, validSession, validDate } from './greenpowerEvents';

@Injectable()
export class GreenpowerEventsService implements OnDestroy {
  readonly changed = new Subject<void>();
  readonly recordingChanged = new Subject<TelemetrySession | undefined>();
  events: TelemetryEvent[] = [];
  sessions: TelemetrySession[] = [];
  selectedEvent?: TelemetryEvent;
  selectedSession?: TelemetrySession;
  eventId = '';
  sessionId = '';
  loadingEvents = false;
  loadingSessions = false;
  moreEvents = false;
  moreSessions = false;
  loadedEvents = false;
  eventReady = false;
  sessionReady = false;
  listError = '';
  sessionError = '';
  error = '';
  filters: EventFilters = { type: '', location: '', from: '', to: '' };
  historySource: 'events' | 'days' = 'events';
  private account = '';
  private generation = 0;
  private selection = 0;
  private sessionSelection = 0;
  private listGeneration = 0;
  private sessionsGeneration = 0;
  private eventCursor?: firebase.firestore.QueryDocumentSnapshot;
  private sessionCursor?: firebase.firestore.QueryDocumentSnapshot;
  private eventOff?: () => void;
  private sessionOff?: () => void;
  private destroyed = false;
  private readonly db: firebase.firestore.Firestore;
  private readonly subscription: Subscription;
  constructor(public permissions: PermissionsService, firestore: AngularFirestore) {
    this.db = firestore.firestore;
    this.subscription = permissions.state.subscribe(state => {
      const uid = state.ready ? state.uid : '';
      if (uid !== this.account) {
        const hadSelection = !!this.eventId;
        this.account = uid; this.generation++; this.listGeneration++;
        this.clear(); this.events = []; this.loadedEvents = this.moreEvents = this.loadingEvents = false; this.eventCursor = undefined; this.listError = '';
        this.filters = { type: '', location: '', from: '', to: '' }; this.historySource = 'events';
        if (hadSelection) this.recordingChanged.next(undefined);
      }
      this.changed.next();
    });
  }
  get canEdit() { return !!this.account && this.permissions.current.isAdmin && this.permissions.current.uid === this.account; }
  private valid(generation: number) { return !this.destroyed && !!this.account && generation === this.generation; }
  async eventReference(id: string): Promise<TelemetryEvent> {
    if (!this.account || !validId(id)) throw new Error('Event link is invalid.');
    const known = this.events.find(event => event.id === id);
    if (known) return JSON.parse(JSON.stringify(known));
    const generation = this.generation;
    const snapshot = await this.db.doc(EVENT_ROOT + '/events/' + id).get({ source: 'server' });
    const event = { ...snapshot.data(), id };
    if (!this.valid(generation) || !snapshot.exists || !validEvent(event)) throw new Error('Event link is unavailable.');
    return event;
  }
  async loadEvents(reset = false, filters = this.filters) {
    if (!this.account || this.loadingEvents && !reset) return;
    if (reset) {
      this.listGeneration++; this.filters = { ...filters }; this.events = []; this.eventCursor = undefined; this.moreEvents = false;
    }
    const generation = this.generation, list = this.listGeneration;
    this.loadingEvents = true; this.listError = ''; this.changed.next();
    try {
      const { type, location, from, to } = this.filters;
      if (from && !validDate(from) || to && !validDate(to) || from && to && from > to) throw new Error('Choose a valid date range.');
      let query: firebase.firestore.Query = this.db.collection(EVENT_ROOT + '/events');
      if (type) query = query.where('type', '==', type);
      if (location.trim()) query = query.where('locationKey', '==', locationKey(location));
      if (from) query = query.where('date', '>=', from);
      if (to) query = query.where('date', '<=', to);
      query = query.orderBy('date', 'desc').orderBy(firebase.firestore.FieldPath.documentId(), 'desc').limit(EVENT_PAGE_SIZE);
      if (this.eventCursor) query = query.startAfter(this.eventCursor);
      const snapshot = await query.get({ source: 'server' });
      if (!this.valid(generation) || list !== this.listGeneration) return;
      const events = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      if (!events.every(validEvent)) throw new Error('Event metadata is invalid.');
      this.events.push(...events.filter(event => !this.events.some(loaded => loaded.id === event.id)));
      this.eventCursor = snapshot.docs.at(-1) || this.eventCursor; this.moreEvents = snapshot.size === EVENT_PAGE_SIZE; this.loadedEvents = true;
    } catch (error) {
      if (this.valid(generation) && list === this.listGeneration) this.listError = error instanceof Error && ['Choose a valid date range.', 'Event metadata is invalid.'].includes(error.message) ? error.message : 'Could not load events. Try again.';
    } finally { if (this.valid(generation) && list === this.listGeneration) { this.loadingEvents = false; this.changed.next(); } }
  }
  clear() {
    this.selection++; this.sessionSelection++; this.sessionsGeneration++; this.eventOff?.(); this.sessionOff?.(); this.eventOff = this.sessionOff = undefined;
    this.eventId = this.sessionId = ''; this.selectedEvent = this.selectedSession = undefined;
    this.sessions = []; this.sessionCursor = undefined; this.moreSessions = this.loadingSessions = this.eventReady = this.sessionReady = false;
    this.error = this.sessionError = ''; this.changed.next();
  }
  selectEvent(id: string) {
    if (!this.account || !validId(id)) return;
    this.clear(); this.eventId = id; this.recordingChanged.next(undefined); this.changed.next();
    const generation = this.generation, selection = this.selection;
    this.eventOff = this.db.doc(EVENT_ROOT + '/events/' + id).onSnapshot({ includeMetadataChanges: true }, snapshot => {
      if (!this.valid(generation) || selection !== this.selection || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const event = { ...snapshot.data(), id };
      if (validEvent(event) && this.selectedEvent?.id === id && event.revision < this.selectedEvent.revision) return;
      if (!snapshot.exists || !validEvent(event)) {
        this.eventReady = false; this.selectedEvent = undefined; this.sessions = []; this.sessionsGeneration++;
        this.loadingSessions = false; this.error = 'Event is unavailable.'; this.clearSession();
      } else {
        const first = !this.eventReady;
        this.selectedEvent = event; this.eventReady = true; this.error = '';
        this.events = this.events.map(item => item.id === id ? event : item);
        if (first) void this.loadSessions(true);
      }
      this.changed.next();
    }, () => { if (this.valid(generation) && selection === this.selection) { this.eventReady = false; this.selectedEvent = undefined; this.error = 'Could not load event. Try again.'; this.clearSession(); this.changed.next(); } });
  }
  async loadSessions(reset = false) {
    if (!this.account || !this.eventReady || this.loadingSessions && !reset) return;
    if (reset) { this.sessionsGeneration++; this.sessions = []; this.sessionCursor = undefined; this.moreSessions = false; }
    const generation = this.generation, selection = this.selection, sessionList = this.sessionsGeneration, eventId = this.eventId;
    this.loadingSessions = true; this.sessionError = ''; this.changed.next();
    try {
      let query = this.db.collection(EVENT_ROOT + '/sessions').where('eventId', '==', eventId)
        .orderBy('firstAt').orderBy(firebase.firestore.FieldPath.documentId()).limit(EVENT_PAGE_SIZE);
      if (this.sessionCursor) query = query.startAfter(this.sessionCursor);
      const snapshot = await query.get({ source: 'server' });
      if (!this.valid(generation) || selection !== this.selection || sessionList !== this.sessionsGeneration) return;
      const sessions = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      if (!sessions.every(value => validSession(value) && value.eventId === eventId)) throw new Error('Invalid session.');
      this.sessions.push(...(sessions as TelemetrySession[]).filter(session => !this.sessions.some(item => item.id === session.id)));
      this.sessionCursor = snapshot.docs.at(-1) || this.sessionCursor; this.moreSessions = snapshot.size === EVENT_PAGE_SIZE;
    } catch { if (this.valid(generation) && selection === this.selection && sessionList === this.sessionsGeneration) this.sessionError = 'Could not load sessions. Try again.'; }
    finally { if (this.valid(generation) && selection === this.selection && sessionList === this.sessionsGeneration) { this.loadingSessions = false; this.changed.next(); } }
  }
  private clearSession() {
    this.sessionSelection++; this.sessionOff?.(); this.sessionOff = undefined; this.sessionId = ''; this.selectedSession = undefined; this.sessionReady = false;
    this.recordingChanged.next(undefined);
  }
  selectSession(id: string) {
    if (!this.account || !this.eventReady || !validId(id)) return;
    this.clearSession(); this.sessionId = id; this.error = ''; this.changed.next();
    const generation = this.generation, selection = this.selection, sessionSelection = this.sessionSelection;
    let ranges = '';
    this.sessionOff = this.db.doc(EVENT_ROOT + '/sessions/' + id).onSnapshot({ includeMetadataChanges: true }, snapshot => {
      if (!this.valid(generation) || selection !== this.selection || sessionSelection !== this.sessionSelection || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const session = { ...snapshot.data(), id };
      if (validSession(session) && this.selectedSession?.id === id && session.revision < this.selectedSession.revision) return;
      if (!snapshot.exists || !validSession(session) || session.eventId !== this.eventId) {
        this.clearSession(); this.sessions = this.sessions.filter(item => item.id !== id); this.error = 'Session is unavailable or moved. Reload sessions.';
      } else {
        this.selectedSession = session; this.sessionReady = true; this.error = '';
        this.sessions = this.sessions.map(item => item.id === id ? session : item);
        const next = JSON.stringify(session.segments);
        if (next !== ranges) { ranges = next; this.recordingChanged.next(session); }
      }
      this.changed.next();
    }, () => { if (this.valid(generation) && sessionSelection === this.sessionSelection) { this.sessionReady = false; this.selectedSession = undefined; this.error = 'Could not load session. Try again.'; this.recordingChanged.next(undefined); this.changed.next(); } });
  }
  acknowledge(request: EventEditRequest, result: EventEditResult, before: TelemetrySession[]) {
    // A commit acknowledgement may arrive before the selected document listeners.
    const event = this.selectedEvent, session = this.selectedSession;
    if (event) {
      const change = request.events.find(item => item.id === event.id), revision = result.events.find(item => item.id === event.id)?.revision;
      if (change && revision && event.revision < revision) {
        let count = event.sessionCount;
        for (const item of request.sessions) {
          const old = before.find(record => record.id === item.id);
          if (old?.eventId === event.id && item.data?.eventId !== event.id) count--;
          if (old?.eventId !== event.id && item.data?.eventId === event.id) count++;
        }
        this.selectedEvent = { ...event, ...(change.data || editable(event)), revision, sessionCount: count, updatedBy: this.account };
      }
    }
    if (session) {
      const change = request.sessions.find(item => item.id === session.id), revision = result.sessions.find(item => item.id === session.id)?.revision;
      if (change?.data && revision && session.revision < revision) {
        if (change.data.eventId === this.eventId) this.selectedSession = { ...session, ...change.data, revision, updatedBy: this.account };
        else this.clearSession();
      }
    }
    this.changed.next();
  }
  ngOnDestroy() { this.destroyed = true; this.generation++; this.clear(); this.subscription.unsubscribe(); this.changed.complete(); this.recordingChanged.complete(); }
}
