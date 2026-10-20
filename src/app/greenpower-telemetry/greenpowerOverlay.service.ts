import { Injectable, OnDestroy } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { Subject, Subscription } from 'rxjs';
import { PermissionsService } from '../permissions.service';
import { DaySession, RecordedEvent, SESSION_SCOPE, validDaySession, validRecordedEvent } from './greenpowerDay';
import { GreenpowerChannel, GreenpowerChunk, MAX_CHUNK_WIRE_BYTES, PAGE_SIZE } from './greenpowerData';
import { recordingBudget, RecordingReader } from './greenpowerRecording';
import { TrackDefinition, TRACKS_PATH, validTrack } from './greenpowerTracks';
import { OverlaySession, overlayChannels, overlayColour, overlayLabel } from './greenpowerOverlay';

@Injectable()
export class GreenpowerOverlayService implements OnDestroy {
  readonly changed = new Subject<void>();
  active = false;
  loading = false;
  error = '';
  sessions: OverlaySession[] = [];
  more = false;
  private cursor?: firebase.firestore.QueryDocumentSnapshot;
  private queue: OverlaySession[] = [];
  private reader?: RecordingReader;
  private parents = new Map<string, RecordedEvent>();
  private tracks = new Map<string, TrackDefinition | null>();
  private cache = new Map<string, GreenpowerChunk>();
  private colourIndex = 0;
  private account = '';
  private generation = 0;
  private subscription: Subscription;
  private readonly db: firebase.firestore.Firestore;
  constructor(firestore: AngularFirestore, permissions: PermissionsService) {
    this.db = firestore.firestore;
    this.subscription = permissions.state.subscribe(state => {
      const account = state.ready ? state.uid : '';
      if (account !== this.account) { this.account = account; this.clear(); }
    });
  }
  get channels() {
    const channels = new Map<string, GreenpowerChannel>();
    for (const session of this.sessions) for (const channel of session.channels) {
      // A later session without a completed lap must not remove an earlier session's graph.
      if (!channels.get(channel.id)?.points.length) channels.set(channel.id, channel);
    }
    return [...channels.values()];
  }
  get end() { return Math.max(1, ...this.sessions.filter(item => item.loaded).map(item => item.session.endAt - item.session.startAt)); }
  get status() {
    return this.loading ? 'Loading race sessions…' : this.sessions.filter(item => item.loaded).length + ' sessions'
      + (this.error ? ' · Load incomplete' : this.hasMore ? ' · More available' : '');
  }
  clear() {
    this.generation++; this.active = this.loading = this.more = false; this.error = '';
    this.sessions = []; this.queue = []; this.cursor = undefined; this.reader = undefined;
    this.parents.clear(); this.tracks.clear(); this.cache.clear(); this.colourIndex = 0; this.changed.next();
  }
  get visibleSessions() { return this.sessions.filter(item => item.loaded && !item.hidden && !item.excluded); }
  toggleInclusion(id: string) {
    if (!this.sessions.some(item => item.id === id && item.loaded)) return;
    this.sessions = this.sessions.map(item => item.id === id ? { ...item, excluded: !item.excluded } : item);
    this.changed.next();
  }
  toggleVisibility(id: string) {
    if (!this.sessions.some(item => item.id === id && item.loaded)) return;
    this.sessions = this.sessions.map(item => item.id === id ? { ...item, hidden: !item.hidden } : item);
    this.changed.next();
  }
  async load(reset = false) {
    if (!this.account || this.loading) return;
    if (reset) { this.clear(); this.active = true; this.more = true; }
    if (!this.active || !this.more && !this.queue.length) return;
    const generation = this.generation, current = () => generation === this.generation && !!this.account;
    const budget = recordingBudget();
    this.loading = true; this.error = ''; this.changed.next();
    try {
      // One metadata page, with no automatic pagination or retries.
      if (!this.queue.length && this.more) {
        let query = this.db.collectionGroup('sessions').where('telemetryRoot', '==', SESSION_SCOPE)
          .where('schemaVersion', '==', 2).where('type', '==', 'race')
          .where('startAt', '>=', Date.UTC(2026, 0, 1)).where('startAt', '<', Date.UTC(2027, 0, 1))
          .orderBy('startAt').orderBy(firebase.firestore.FieldPath.documentId()).limit(30);
        if (this.cursor) query = query.startAfter(this.cursor);
        const snapshot = await query.get({ source: 'server' });
        if (!current()) return;
        const page: OverlaySession[] = [];
        for (const doc of snapshot.docs) {
          const date = doc.ref.parent.parent!.id, session = doc.data() as DaySession;
          if (doc.ref.path !== `${SESSION_SCOPE}/days/${date}/sessions/${doc.id}` || session.id !== doc.id
            || !validDaySession(session, date)) throw new Error('Invalid session metadata.');
          let event = this.parents.get(date);
          if (!event) {
            const parent = await doc.ref.parent.parent!.get({ source: 'server' });
            if (!current()) return;
            const value = parent.data();
            if (!validRecordedEvent(value) || value.date !== date) throw new Error('Invalid event metadata.');
            event = value; this.parents.set(date, event);
          }
          if (event.trackId && !this.tracks.has(event.trackId)) {
            // At most one exact track read per parent on this 30-session page; no listeners or lookup scans.
            const snapshot = await this.db.collection(TRACKS_PATH).doc(event.trackId).get({ source: 'server' });
            if (!current()) return;
            const value = snapshot.data();
            this.tracks.set(event.trackId, validTrack(value) ? value : null);
          }
          page.push({ id: doc.ref.path, date, session, colour: overlayColour(this.colourIndex++),
            label: overlayLabel(event, session), channels: [], loaded: false, hidden: false, excluded: false });
        }
        this.queue = page; this.sessions = [...this.sessions, ...page];
        this.cursor = snapshot.docs.at(-1) || this.cursor; this.more = snapshot.size === 30;
        this.changed.next();
      }
      while (this.queue.length && budget.pages > 0 && budget.bytes >= MAX_CHUNK_WIRE_BYTES) {
        const item = this.queue[0];
        this.reader ||= new RecordingReader(this.db.collection(SESSION_SCOPE + '/days'), item.session.ranges, this.cache);
        await this.reader.load(current, budget);
        if (!current()) return;
        // Keep only a small boundary cache; complete channel data stays with each loaded session.
        for (const [key, chunk] of this.reader.cachedChunks()) {
          this.cache.delete(key); this.cache.set(key, chunk);
          if (this.cache.size > PAGE_SIZE) this.cache.delete(this.cache.keys().next().value!);
        }
        if (this.reader.more) break;
        item.channels = overlayChannels(this.reader.entries.map(entry => entry.sample), item.session, this.parents.get(item.date), this.tracks.get(this.parents.get(item.date)?.trackId ?? ''));
        item.loaded = true; this.queue.shift(); this.reader = undefined; this.sessions = [...this.sessions];
        this.changed.next();
      }
    } catch { if (current()) { this.reader = undefined; this.error = 'Could not load race sessions. Try again.'; } }
    finally { if (current()) { this.loading = false; this.changed.next(); } }
  }
  get hasMore() { return this.more || !!this.queue.length; }
  ngOnDestroy() { this.clear(); this.subscription.unsubscribe(); this.changed.complete(); }
}
