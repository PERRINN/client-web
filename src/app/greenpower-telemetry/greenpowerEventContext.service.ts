import { Injectable, OnDestroy } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { Subject, Subscription } from 'rxjs';
import { PermissionsService } from '../permissions.service';
import { DaySession, RecordedEvent, SESSION_SCOPE, validDaySession, validRecordedEvent } from './greenpowerDay';

/** The displayed event is independent of pending History choices. */
@Injectable()
export class GreenpowerEventContextService implements OnDestroy {
  readonly changed = new Subject<void>();
  event?: RecordedEvent;
  sessions: DaySession[] = [];
  loading = false;
  more = false;
  error = '';
  metadataError = '';
  private readonly deletedSessions = new Set<string>();
  private date = '';
  private live = false;
  private account = '';
  private generation = 0;
  private after?: firebase.firestore.QueryDocumentSnapshot;
  private eventOff?: () => void;
  private sessionsOff?: () => void;
  private readonly subscription: Subscription;
  private readonly db: firebase.firestore.Firestore;
  constructor(firestore: AngularFirestore, permissions: PermissionsService) {
    this.db = firestore.firestore;
    this.subscription = permissions.state.subscribe(state => {
      const uid = state.ready ? state.uid : '';
      if (uid !== this.account) { this.clear(); this.account = uid; }
    });
  }
  clear() {
    this.generation++; this.eventOff?.(); this.sessionsOff?.();
    this.eventOff = this.sessionsOff = undefined;
    this.deletedSessions.clear();
    this.date = ''; this.event = undefined; this.sessions = []; this.after = undefined;
    this.loading = this.more = false; this.error = this.metadataError = ''; this.changed.next();
  }
  select(date: string, live: boolean, seed?: RecordedEvent) {
    if (!this.account || this.date === date && this.live === live && live) return;
    this.clear(); this.date = date; this.live = live; this.event = seed;
    const generation = this.generation;
    const current = () => generation === this.generation;
    this.eventOff = this.db.doc(`${SESSION_SCOPE}/days/${date}`).onSnapshot({ includeMetadataChanges: true }, snapshot => {
      if (!current() || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const event = snapshot.data();
      if (!snapshot.exists || !validRecordedEvent(event) || event.date !== date) {
        this.event = undefined; this.metadataError = 'Event metadata is unavailable.';
      } else {
        if (this.event && this.event.revision > event.revision) return;
        this.event = event; this.metadataError = '';
      }
      this.changed.next();
    }, () => { if (current()) { this.event = undefined; this.metadataError = 'Could not load event metadata.'; this.changed.next(); } });
    if (live) {
      this.loading = true;
      // One 30-record listener for the displayed live day, never for History choices.
      this.sessionsOff = this.query().limit(30).onSnapshot({ includeMetadataChanges: true }, snapshot => {
        if (!current() || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
        try {
          const sessions = this.readSessions(snapshot.docs);
          const known = new Set(this.sessions.map(session => session.id));
          const gap = snapshot.size === 30 && !sessions.some(session => known.has(session.id));
          this.merge(sessions);
          if (!this.after || gap) { this.after = snapshot.docs.at(-1); this.more = snapshot.size === 30; }
          this.error = '';
        } catch { this.error = 'Could not load session details.'; }
        this.loading = false; this.changed.next();
      }, () => { if (current()) { this.sessionsOff?.(); this.sessionsOff = undefined; this.loading = false; this.error = 'Could not load session details.'; this.changed.next(); } });
    } else void this.loadMore();
    this.changed.next();
  }
  retry() {
    const date = this.date, live = this.live, seed = this.event;
    this.clear();
    if (date) this.select(date, live, seed);
  }
  private query() {
    return this.db.collection(`${SESSION_SCOPE}/days/${this.date}/sessions`)
      .orderBy('startAt', 'desc').orderBy(firebase.firestore.FieldPath.documentId(), 'desc');
  }
  private readSessions(docs: firebase.firestore.QueryDocumentSnapshot[]) {
    return docs.map(doc => {
      const value = doc.data();
      if (value.id !== doc.id || !validDaySession(value, this.date)) throw new Error('Invalid session');
      return value;
    });
  }
  private merge(sessions: DaySession[]) {
    const merged = new Map(this.sessions.map(session => [session.id, session]));
    for (const session of sessions) {
      if (this.deletedSessions.has(session.id)) continue;
      const previous = merged.get(session.id);
      if (!previous || previous.revision! <= session.revision!) merged.set(session.id, session);
    }
    this.sessions = [...merged.values()].sort((a, b) => a.startAt - b.startAt || a.id.localeCompare(b.id));
  }
  /** At most one 30-record request per explicit action; no automatic continuation. */
  async loadMore() {
    if (!this.account || !this.date || this.loading) return;
    if (this.live && !this.sessionsOff) { this.retry(); return; }
    const generation = this.generation;
    this.loading = true; this.error = ''; this.changed.next();
    try {
      let query = this.query().limit(30);
      if (this.after) query = query.startAfter(this.after);
      const snapshot = await query.get({ source: 'server' });
      if (generation !== this.generation) return;
      this.merge(this.readSessions(snapshot.docs));
      this.after = snapshot.docs.at(-1) || this.after; this.more = snapshot.size === 30;
    } catch { if (generation === this.generation) this.error = 'Could not load session details.'; }
    finally { if (generation === this.generation) { this.loading = false; this.changed.next(); } }
  }
  acknowledge(event: RecordedEvent, session?: DaySession, deletedSessionId?: string) {
    if (event.date !== this.date) return;
    if (!this.event || event.revision >= this.event.revision) this.event = event;
    if (deletedSessionId) {
      this.deletedSessions.add(deletedSessionId);
      this.sessions = this.sessions.filter(item => item.id !== deletedSessionId);
    }
    if (session) this.merge([session]);
    this.changed.next();
  }
  ngOnDestroy() { this.clear(); this.subscription.unsubscribe(); this.changed.complete(); }
}
