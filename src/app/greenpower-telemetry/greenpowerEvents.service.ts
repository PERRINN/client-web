import { Injectable, OnDestroy } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { Subject, Subscription } from 'rxjs';
import { PermissionsService } from '../permissions.service';
import { recordedEventName, dayEvent, defaultEventFilters, editable, EVENT_PAGE_SIZE, EVENT_ROOT, EventEditRequest, EventEditResult, EventFilters, locationKey, TelemetryEvent, TelemetrySession, DayEventSummary, RecordedDayContext, validEvent, validId, validSession, validDate } from './greenpowerEvents';

interface DayNamesPage { dates: string[]; more: boolean; failed?: boolean; cursor?: firebase.firestore.QueryDocumentSnapshot; }

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
  moreSessions = false;
  loadedEvents = false;
  eventReady = false;
  sessionReady = false;
  listError = '';
  sessionError = '';
  error = '';
  filters: EventFilters = defaultEventFilters();
  dayNamesLoading = false;
  dayNamesError = '';
  private dayEvents = new Map<string, DayEventSummary[]>();
  private historicalMetadata = new Map<string, TelemetryEvent>();
  private recordedDay = '';
  private dayPages: DayNamesPage[] = [];
  private loadingDayPage?: DayNamesPage;
  private account = '';
  private generation = 0;
  private selection = 0;
  private sessionSelection = 0;
  private listGeneration = 0;
  private sessionsGeneration = 0;
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
        this.clear(); this.events = []; this.loadedEvents = this.loadingEvents = false; this.listError = '';
        this.filters = defaultEventFilters();
        this.dayEvents.clear(); this.historicalMetadata.clear(); this.dayPages = []; this.dayNamesLoading = false; this.dayNamesError = '';
        this.recordedDay = ''; this.loadingDayPage = undefined;
        if (hadSelection) this.recordingChanged.next(undefined);
      }
      this.changed.next();
    });
  }
  get canEdit() { return !!this.account && this.permissions.current.isAdmin && this.permissions.current.uid === this.account; }
  private valid(generation: number) { return !this.destroyed && !!this.account && generation === this.generation; }
  dayContext(day: string): RecordedDayContext {
    const page = this.dayPages.find(value => value.dates.includes(day));
    return { events: this.dayEvents.get(day) || [], complete: (this.dayEvents.get(day) || []).some(event => event.id === day) || !!page && !page.more,
      loading: !!page && page === this.loadingDayPage, failed: !!page?.failed };
  }
  setRecordedDay(day: string) {
    if (this.destroyed || !this.account) return;
    if (day === this.recordedDay) return;
    this.recordedDay = validDate(day) ? day : '';
    if (this.recordedDay && !this.dayEvents.has(this.recordedDay)) void this.loadDayNames([this.recordedDay]);
  }
  moreDayNames(days: string[]) {
    return days.some(day => !this.dayEvents.has(day)) || this.dayPages.some(page => page.more && page.dates.some(day => days.includes(day)));
  }
  async loadDayNames(days: string[], more = false) {
    if (this.destroyed || !this.account || this.dayNamesLoading) return;
    let page = more ? this.dayPages.find(value => value.more && value.dates.some(day => days.includes(day))) : undefined;
    if (!page) {
      const dates = [...new Set(days.filter(day => validDate(day) && !this.dayEvents.has(day)))].slice(0, 30);
      if (!dates.length) return;
      page = { dates, more: true }; this.dayPages.push(page);
      dates.forEach(day => this.dayEvents.set(day, []));
    }
    const generation = this.generation;
    this.dayNamesLoading = true; this.loadingDayPage = page; page.failed = false; this.dayNamesError = ''; this.changed.next();
    try {
      let query = this.db.collection(EVENT_ROOT + '/events').where('date', 'in', page.dates)
        .orderBy('date', 'desc').orderBy(firebase.firestore.FieldPath.documentId(), 'desc').limit(60);
      if (page.cursor) query = query.startAfter(page.cursor);
      const snapshot = await query.get({ source: 'server' });
      if (!this.valid(generation)) return;
      const events = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      if (!events.every(event => validEvent(event) && page!.dates.includes(event.date))) throw new Error('Invalid event metadata.');
      (events as TelemetryEvent[]).forEach(event => this.cacheDayEvent(event));
      page.cursor = snapshot.docs.at(-1) || page.cursor; page.more = snapshot.size === 60;
    } catch { if (this.valid(generation)) { page.failed = true; this.dayNamesError = 'Could not load event names.'; } }
    finally { if (this.valid(generation)) {
      this.dayNamesLoading = false; this.loadingDayPage = undefined;
      // Only the current directly opened day can wait behind an existing list lookup.
      // Its single query never continues a crowded page or retries an error automatically.
      if (this.recordedDay && !this.dayEvents.has(this.recordedDay)) void this.loadDayNames([this.recordedDay]);
      this.changed.next();
    } }
  }
  private eventForDay(day: string): TelemetryEvent {
    const historical = [...this.historicalMetadata.values()].filter(event => event.date === day && event.state === 'active');
    return historical.length === 1 ? { ...historical[0], id: day, revision: 0, sessionCount: 0 } : dayEvent(day);
  }
  get ambiguousHistoricalEvent() {
    return this.selectedEvent?.revision === 0 && [...this.historicalMetadata.values()].filter(event => event.date === this.eventId && event.state === 'active').length > 1;
  }
  private cacheDayEvent(event: DayEventSummary) {
    if (event.id !== event.date && validEvent(event)) {
      this.historicalMetadata.set(event.id, event);
      if (this.selectedEvent?.revision === 0 && this.eventId === event.date) this.selectedEvent = this.eventForDay(event.date);
    }
    for (const [day, events] of this.dayEvents) {
      const previous = events.find(value => value.id === event.id);
      if (previous && previous.revision > event.revision) return;
      this.dayEvents.set(day, events.filter(value => value.id !== event.id));
    }
    const events = this.dayEvents.get(event.date) || [];
    events.push(event); events.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    this.dayEvents.set(event.date, events);
  }
  async loadEvents(reset = false, filters = this.filters) {
    if (this.destroyed || !this.account || this.loadingEvents && !reset) return;
    const typeChanged = filters.type !== this.filters.type;
    this.listGeneration++;
    if (reset) {
      this.filters = { ...filters }; this.events = []; this.loadedEvents = false;
      if (typeChanged && this.eventReady) { this.clearSession(); void this.loadSessions(true); }
    }
    const generation = this.generation, list = this.listGeneration;
    const current = () => this.valid(generation) && list === this.listGeneration;
    this.loadingEvents = true; this.listError = ''; this.changed.next();
    try {
      const { location, from, to } = this.filters;
      if (!validDate(from) || !validDate(to) || from.slice(0, 4) !== to.slice(0, 4) || from > to) throw new Error('Choose a valid year.');
      // One document per UK date: 367 detects malformed results beyond a leap year.
      // At most 13 date metadata batches follow; no pagination, retries or sample reads.
      const snapshot = await this.db.collection(EVENT_ROOT + '/days')
        .where('date', '>=', from).where('date', '<=', to)
        .orderBy('date', 'desc').orderBy(firebase.firestore.FieldPath.documentId(), 'desc').limit(367).get({ source: 'server' });
      if (!current()) return;
      const dates = snapshot.docs.map(doc => doc.id);
      if (dates.length > 366 || !snapshot.docs.every(doc => validDate(doc.id) && doc.data().date === doc.id && doc.id >= from && doc.id <= to)) throw new Error('Event metadata is invalid.');
      const track = locationKey(location);
      // Keep all date choices available if a name lookup fails; track matches need metadata.
      this.events = track ? [] : dates.map(dayEvent);
      this.changed.next();
      const matches = new Set<string>();
      for (let offset = 0; offset < dates.length; offset += EVENT_PAGE_SIZE) {
        if (!current()) return;
        const batch = dates.slice(offset, offset + EVENT_PAGE_SIZE);
        const metadata = await this.db.collection(EVENT_ROOT + '/events')
          .where('date', 'in', batch).orderBy('date', 'desc').orderBy(firebase.firestore.FieldPath.documentId(), 'desc').limit(60).get({ source: 'server' });
        if (!current()) return;
        const events = metadata.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        if (!events.every(event => validEvent(event) && batch.includes(event.date))) throw new Error('Event metadata is invalid.');
        if (metadata.size === 60) throw new Error('Could not load all event names.');
        batch.forEach(date => {
          const sameDate = (events as TelemetryEvent[]).filter(event => event.date === date);
          // Replace this page's names so removed or superseded metadata cannot linger.
          for (const [id, event] of this.historicalMetadata) if (event.date === date) this.historicalMetadata.delete(id);
          sameDate.filter(event => event.id !== date).forEach(event => this.historicalMetadata.set(event.id, event));
          this.dayEvents.set(date, sameDate);
          if (this.selectedEvent?.revision === 0 && this.eventId === date) this.selectedEvent = this.eventForDay(date);
          const active = sameDate.filter(event => event.state === 'active');
          const canonical = active.find(event => event.id === date);
          if ((canonical ? [canonical] : active).some(event => event.locationKey === track)) matches.add(date);
        });
        this.dayPages = this.dayPages.map(page => ({ ...page, dates: page.dates.filter(date => !batch.includes(date)) })).filter(page => page.dates.length);
        this.dayPages.unshift({ dates: batch, more: false });
        if (!this.dayPages.some(page => page.failed)) this.dayNamesError = '';
      }
      if (track) this.events = dates.filter(date => matches.has(date)).map(dayEvent);
      this.loadedEvents = true;
    } catch (error) {
      if (current()) this.listError = error instanceof Error && ['Choose a valid year.', 'Event metadata is invalid.', 'Could not load all event names.'].includes(error.message) ? error.message : 'Could not load events. Try again.';
    } finally { if (current()) { this.loadingEvents = false; this.changed.next(); } }
  }

  clear() {
    this.selection++; this.sessionSelection++; this.sessionsGeneration++; this.eventOff?.(); this.sessionOff?.(); this.eventOff = this.sessionOff = undefined;
    this.eventId = this.sessionId = ''; this.selectedEvent = this.selectedSession = undefined;
    this.sessions = []; this.sessionCursor = undefined; this.moreSessions = this.loadingSessions = this.eventReady = this.sessionReady = false;
    this.error = this.sessionError = ''; this.changed.next();
  }
  async selectEvent(id: string) {
    if (!this.account || !validDate(id)) return;
    this.clear(); this.eventId = id; this.recordingChanged.next(undefined); this.changed.next();
    const generation = this.generation, selection = this.selection;
    const current = () => this.valid(generation) && selection === this.selection;
    try {
      const day = await this.db.doc(EVENT_ROOT + '/days/' + id).get({ source: 'server' });
      if (!current()) return;
      if (!day.exists || day.data()?.date !== id) throw new Error('Missing recording day.');
      this.eventOff = this.db.doc(EVENT_ROOT + '/events/' + id).onSnapshot({ includeMetadataChanges: true }, snapshot => {
        if (!current() || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
        const event: TelemetryEvent = snapshot.exists ? { ...snapshot.data(), id } as TelemetryEvent : this.eventForDay(id);
        if (snapshot.exists && (!validEvent(event) || event.date !== id || event.state !== 'active')) {
          this.eventReady = false; this.selectedEvent = undefined; this.error = 'Event metadata is unavailable.'; this.clearSession();
        } else {
          if (this.selectedEvent?.id === id && event.revision < this.selectedEvent.revision) return;
          const first = !this.eventReady;
          this.selectedEvent = event as TelemetryEvent; this.eventReady = true; this.error = '';
          if (snapshot.exists) this.cacheDayEvent(event as TelemetryEvent);
          if (first) { this.recordingChanged.next(undefined); void this.loadSessions(true); }
        }
        this.changed.next();
      }, () => { if (current()) { this.eventReady = false; this.selectedEvent = undefined; this.error = 'Could not load event. Try again.'; this.clearSession(); this.changed.next(); } });
    } catch { if (current()) { this.error = 'Could not load event. Try again.'; this.changed.next(); } }
  }
  eventLabel(date: string) {
    const name = recordedEventName(date, this.dayContext(date).events);
    return date + (name && name !== 'Event' ? ' · ' + name : '');
  }

  async loadSessions(reset = false) {
    if (!this.account || !this.eventReady || this.loadingSessions && !reset) return;
    if (reset) { this.sessionsGeneration++; this.sessions = []; this.sessionCursor = undefined; this.moreSessions = false; }
    const generation = this.generation, selection = this.selection, sessionList = this.sessionsGeneration, eventId = this.eventId;
    this.loadingSessions = true; this.sessionError = ''; this.changed.next();
    try {
      let query = this.db.collection(EVENT_ROOT + '/sessions').where('eventId', '==', eventId);
      if (this.filters.type) query = query.where('type', '==', this.filters.type);
      query = query.orderBy('firstAt').orderBy(firebase.firestore.FieldPath.documentId()).limit(EVENT_PAGE_SIZE);
      if (this.sessionCursor) query = query.startAfter(this.sessionCursor);
      const snapshot = await query.get({ source: 'server' });
      if (!this.valid(generation) || selection !== this.selection || sessionList !== this.sessionsGeneration) return;
      const sessions = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      if (!sessions.every(value => validSession(value) && value.eventId === eventId && value.segments.every(segment => segment.day === eventId))) throw new Error('Invalid session.');
      this.sessions.push(...(sessions as TelemetrySession[]).filter(session => !this.sessions.some(item => item.id === session.id)));
      this.sessionCursor = snapshot.docs.at(-1) || this.sessionCursor; this.moreSessions = snapshot.size === EVENT_PAGE_SIZE;
    } catch { if (this.valid(generation) && selection === this.selection && sessionList === this.sessionsGeneration) this.sessionError = 'Could not load sessions. Try again.'; }
    finally { if (this.valid(generation) && selection === this.selection && sessionList === this.sessionsGeneration) { this.loadingSessions = false; this.changed.next(); } }
  }
  private clearSession(loadWholeEvent = true) {
    this.sessionSelection++; this.sessionOff?.(); this.sessionOff = undefined; this.sessionId = ''; this.selectedSession = undefined; this.sessionReady = false;
    if (loadWholeEvent) this.recordingChanged.next(undefined);
  }
  selectSession(id: string) {
    if (!this.account || !this.eventReady || !validId(id)) return;
    this.clearSession(false); this.sessionId = id; this.error = ''; this.recordingChanged.next(undefined); this.changed.next();
    const generation = this.generation, selection = this.selection, sessionSelection = this.sessionSelection;
    let ranges = '';
    this.sessionOff = this.db.doc(EVENT_ROOT + '/sessions/' + id).onSnapshot({ includeMetadataChanges: true }, snapshot => {
      if (!this.valid(generation) || selection !== this.selection || sessionSelection !== this.sessionSelection || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const session = { ...snapshot.data(), id };
      if (validSession(session) && this.selectedSession?.id === id && session.revision < this.selectedSession.revision) return;
      if (!snapshot.exists || !validSession(session) || session.eventId !== this.eventId || session.segments.some(segment => segment.day !== this.eventId)) {
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
    for (const change of request.events) {
      const revision = result.events.find(value => value.id === change.id)?.revision;
      if (change.data && revision) this.cacheDayEvent({ ...change.data, id: change.id, revision });
    }
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
  ngOnDestroy() {
    this.destroyed = true; this.generation++; this.clear(); this.dayEvents.clear(); this.historicalMetadata.clear(); this.dayPages = []; this.recordedDay = ''; this.loadingDayPage = undefined;
    this.subscription.unsubscribe(); this.changed.complete(); this.recordingChanged.complete();
  }
}
