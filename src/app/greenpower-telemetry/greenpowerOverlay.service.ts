import { Injectable, OnDestroy } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { Subject, Subscription } from 'rxjs';
import { PermissionsService } from '../permissions.service';
import { DaySession, RecordedEvent, SESSION_SCOPE, sessionEnd, validDaySession, validRecordedEvent } from './greenpowerDay';
import { GreenpowerChannel, GreenpowerChunk, MAX_CHUNK_WIRE_BYTES, PAGE_SIZE, ENERGY, DISTANCE } from './greenpowerData';
import { recordingBudget, RecordingReader } from './greenpowerRecording';
import { TrackDefinition, TRACKS_PATH, validTrack } from './greenpowerTracks';
import { OverlaySession, overlayChannels, overlayColour, overlayLabel, relativeSessionChannels } from './greenpowerOverlay';

export interface LiveOverlaySource {
  event: RecordedEvent; sessions: DaySession[]; channels: GreenpowerChannel[]; end: number; complete: boolean;
}

@Injectable()
export class GreenpowerOverlayService implements OnDestroy {
  readonly changed = new Subject<void>();
  active = false;
  loading = false;
  error = '';
  sessions: OverlaySession[] = [];
  more = false;
  private liveSource?: LiveOverlaySource;
  private sessionType: 'race' | 'battery_dyno' = 'race';
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
      if (account !== this.account) { this.account = account; this.liveSource = undefined; this.clear(); }
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
  get end() { return Math.max(1, ...this.sessions.filter(item => item.loaded).map(item => (item.session.endAt ?? item.observedEnd ?? item.session.startAt) - item.session.startAt)); }
  get title() { return this.sessionType === 'battery_dyno' ? '2026 battery dyno tests' : '2026 race sessions'; }
  get status() {
    return this.loading ? 'Loading sessions…' : this.sessions.filter(item => item.loaded).length + ' sessions'
      + (this.error ? ' · Load incomplete' : this.hasMore ? ' · More available' : '');
  }
  clear() {
    this.generation++; this.active = this.loading = this.more = false; this.error = '';
    this.sessions = []; this.queue = []; this.cursor = undefined; this.reader = undefined;
    this.parents.clear(); this.tracks.clear(); this.cache.clear(); this.colourIndex = 0; this.changed.next();
  }
  /** Receives the existing Live view's calculated data. This path performs no database work. */
  syncLive(source?: LiveOverlaySource) {
    this.liveSource = source;
    if (this.active && this.updateLiveSession()) { this.sortSessions(); this.changed.next(); }
  }
  private sortSessions() {
    this.sessions.sort((a, b) => Number(!!a.live) - Number(!!b.live)
      || a.session.startAt - b.session.startAt || a.id.localeCompare(b.id));
  }
  private updateLiveSession() {
    const source = this.liveSource;
    let changed = false;
    // A closed session or a departed Live context becomes a fixed comparison snapshot.
    for (const item of this.sessions.filter(item => item.live)) {
      const session = source?.event.date === item.date ? source.sessions.find(session => session.id === item.session.id) : undefined;
      if (source && session && session.type === this.sessionType) {
        if (session.endAt === null) continue;
        this.projectLive(item, source, session);
        item.live = !(source.complete && source.end >= session.endAt);
        changed = true;
      } else {
        item.live = false;
        item.label = item.label.replace(/ · Live$/, item.session.endAt === null ? ' · Open' : '');
        changed = true;
      }
    }
    if (!source || !this.account) return changed;
    const candidates = source.sessions.filter(session => session.type === this.sessionType && session.endAt === null
      && session.startAt >= Date.UTC(2026, 0, 1) && session.startAt < Date.UTC(2027, 0, 1));
    if (candidates.length !== 1) return changed;
    const session = candidates[0], id = `${SESSION_SCOPE}/days/${source.event.date}/sessions/${session.id}`;
    let item = this.sessions.find(item => item.id === id);
    if (!item) {
      item = { id, date: source.event.date, session, label: '', colour: overlayColour(this.colourIndex++),
        channels: [], loaded: true, hidden: false, excluded: false };
      this.sessions = [...this.sessions, item];
    }
    item.live = true;
    this.queue = this.queue.filter(queued => queued.id !== id);
    this.projectLive(item, source, session);
    this.parents.set(source.event.date, source.event);
    return true;
  }
  private projectLive(item: OverlaySession, source: LiveOverlaySource, session: DaySession) {
    item.session = session; item.observedEnd = Math.max(session.startAt, Math.min(session.endAt ?? source.end, source.end));
    const previous = item.channels;
    const channels = relativeSessionChannels(source.channels, session, item.observedEnd);
    const unavailable = (channel: GreenpowerChannel) => ({ ...channel, points: [], value: '—', valueAt: () => undefined });
    const complete = source.complete && !source.sessions.some(other => other.id !== session.id
      && other.startAt < sessionEnd(session) && sessionEnd(other) > session.startAt);
    item.channels = channels.map(channel => !complete && [ENERGY, DISTANCE, '["AH"]:Ah'].includes(channel.id)
      ? unavailable(channel) : channel);
    // Retain existing graph slots when a channel becomes temporarily unavailable.
    item.channels.push(...previous.filter(channel => !channels.some(next => next.id === channel.id)).map(unavailable));
    item.label = overlayLabel(source.event, session, item.channels) + (session.endAt === null ? ' · Live' : '');
    item.loaded = true;
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
  async load(reset = false, sessionType: 'race' | 'battery_dyno' = 'race') {
    if (!this.account || this.loading) return;
    if (reset) { this.clear(); this.sessionType = sessionType; this.active = true; this.more = true; this.updateLiveSession(); }
    if (!this.active || !this.more && !this.queue.length) return;
    const generation = this.generation, current = () => generation === this.generation && !!this.account;
    const budget = recordingBudget();
    this.loading = true; this.error = ''; this.changed.next();
    try {
      // One metadata page, with no automatic pagination or retries.
      if (!this.queue.length && this.more) {
        let query = this.db.collectionGroup('sessions').where('telemetryRoot', '==', SESSION_SCOPE)
          .where('schemaVersion', '==', 2).where('type', '==', this.sessionType)
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
          if (session.endAt === null || this.sessions.some(item => item.id === doc.ref.path)) continue;
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
        this.queue = page.filter(item => !this.sessions.some(existing => existing.id === item.id));
        this.sessions = [...this.sessions, ...this.queue];
        this.sortSessions();
        this.cursor = snapshot.docs.at(-1) || this.cursor; this.more = snapshot.size === 30;
        this.changed.next();
      }
      while (this.queue.length && budget.pages > 0 && budget.bytes >= MAX_CHUNK_WIRE_BYTES) {
        const item = this.queue[0];
        const reader = this.reader ||= new RecordingReader(this.db.collection(SESSION_SCOPE + '/days'), item.session.ranges, this.cache);
        await reader.load(() => current() && this.queue[0] === item && !item.live, budget);
        if (!current()) return;
        if (item.live || this.queue[0] !== item) { this.reader = undefined; continue; }
        // Keep only a small boundary cache; complete channel data stays with each loaded session.
        for (const [key, chunk] of reader.cachedChunks()) {
          this.cache.delete(key); this.cache.set(key, chunk);
          if (this.cache.size > PAGE_SIZE) this.cache.delete(this.cache.keys().next().value!);
        }
        if (reader.more) break;
        item.channels = overlayChannels(reader.entries.map(entry => entry.sample), item.session, this.parents.get(item.date), this.tracks.get(this.parents.get(item.date)?.trackId ?? ''));
        item.label = overlayLabel(this.parents.get(item.date)!, item.session, item.channels);
        item.loaded = true; this.queue.shift(); this.reader = undefined; this.sessions = [...this.sessions];
        this.changed.next();
      }
    } catch { if (current()) { this.reader = undefined; this.error = 'Could not load sessions. Try again.'; } }
    finally { if (current()) { this.loading = false; this.changed.next(); } }
  }
  get hasMore() { return this.more || !!this.queue.length; }
  ngOnDestroy() { this.liveSource = undefined; this.clear(); this.subscription.unsubscribe(); this.changed.complete(); }
}
