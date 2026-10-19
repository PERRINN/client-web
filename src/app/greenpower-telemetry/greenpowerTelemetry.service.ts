import { EnvironmentInjector, Injectable, OnDestroy, runInInjectionContext } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { Subject, Subscription } from 'rxjs';
import { channelsFor, GreenpowerChannel, GreenpowerChunk, GreenpowerDay, GreenpowerSample, londonDay, MAX_CHUNK_WIRE_BYTES, MAX_LOAD_BYTES, MAX_PAGES, mergeChannels, PAGE_SIZE, updateValues } from './greenpowerData';

@Injectable()
export class GreenpowerTelemetryService implements OnDestroy {
  readonly changed = new Subject<void>();
  access: 'checking' | 'signed-out' | 'signed-in' = 'checking';
  live = true;
  day = londonDay();
  loading = false;
  loadingDates = false;
  error = '';
  datesError = '';
  more = false;
  moreDates = false;
  dates: string[] = [];
  channels: GreenpowerChannel[] = [];
  latest?: GreenpowerSample;
  connected = false;
  start = 0;
  end = 0;
  private chunks = new Map<string, GreenpowerChunk>();
  private projections = new Map<string, GreenpowerChannel[]>();
  private generation = 0;
  private account = '';
  private authSubscription: Subscription;
  private metadataOff?: () => void;
  private tailOff?: () => void;
  private datesCursor?: firebase.firestore.QueryDocumentSnapshot;
  private datesGeneration = 0;
  private tailWindows = 0;
  private tailBytes = 0;
  private destroyed = false;
  private readonly root: firebase.firestore.CollectionReference;

  constructor(auth: AngularFireAuth, firestore: AngularFirestore, injector: EnvironmentInjector) {
    this.root = firestore.firestore.collection('GreenpowerTelemetry/424/days');
    this.authSubscription = runInInjectionContext(injector, () => auth.authState.subscribe(user => {
      if (this.destroyed || this.access !== 'checking' && this.account === (user?.uid || '')) return;
      this.stop(); this.account = user?.uid || ''; this.datesGeneration++;
      this.access = user ? 'signed-in' : 'signed-out';
      this.chunks.clear(); this.projections.clear(); this.channels = []; this.latest = undefined; this.dates = [];
      this.datesCursor = undefined; this.loadingDates = false; this.datesError = ''; this.error = ''; this.moreDates = false; this.more = false;
      if (user) void this.select(londonDay(), true);
      this.changed.next();
    }));
  }
  private stop() {
    this.generation++; this.metadataOff?.(); this.tailOff?.();
    this.metadataOff = this.tailOff = undefined; this.connected = false; this.loading = false;
  }
  async select(day: string, live = false) {
    if (this.access !== 'signed-in' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    this.stop(); this.day = day; this.live = live; this.error = ''; this.more = false;
    this.chunks.clear(); this.projections.clear(); this.channels = []; this.latest = undefined;
    const generation = this.generation;
    if (live) {
      this.metadataOff = this.root.doc(day).onSnapshot({ includeMetadataChanges: true }, snapshot => {
        if (!this.valid(generation)) return;
        this.connected = !snapshot.metadata.fromCache;
        // Never render private cached records before a server-authorized read.
        if (snapshot.metadata.fromCache) { this.changed.next(); return; }
        this.latest = (snapshot.data() as GreenpowerDay | undefined)?.latest;
        updateValues(this.channels, this.latest); this.changed.next();
      }, () => this.fail(generation));
    } else {
      this.loading = true; this.changed.next();
      try {
        const snapshot = await this.root.doc(day).get({ source: 'server' });
        if (!this.valid(generation)) return;
        this.latest = (snapshot.data() as GreenpowerDay | undefined)?.latest;
      } catch { this.fail(generation); return; }
      finally { if (this.valid(generation)) { this.loading = false; this.changed.next(); } }
    }
    await this.loadMore();
  }
  async loadMore() {
    if (this.access !== 'signed-in' || this.loading) return;
    this.tailOff?.(); this.tailOff = undefined;
    const generation = this.generation;
    this.loading = true; this.error = ''; this.more = false; this.changed.next();
    this.tailWindows = 0; this.tailBytes = 0;
    let bytes = 0;
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const limit = Math.min(PAGE_SIZE, Math.floor((MAX_LOAD_BYTES - bytes) / MAX_CHUNK_WIRE_BYTES));
        if (limit < (this.lastChunk ? 2 : 1)) { this.more = true; break; }
        let query = this.root.doc(this.day).collection('chunks').orderBy(firebase.firestore.FieldPath.documentId()).limit(limit);
        const last = this.lastChunk;
        // Reread the mutable boundary chunk; reconnect/date-change races cannot
        // skip samples appended between the snapshot and live subscription.
        if (last) query = query.startAt(last);
        const snapshot = await query.get({ source: 'server' });
        if (!this.valid(generation)) return;
        snapshot.docs.forEach(doc => {
          const chunk = doc.data() as GreenpowerChunk;
          bytes += new TextEncoder().encode(JSON.stringify(chunk)).length;
          this.setChunk(doc.id, chunk);
        });
        if (snapshot.size < limit) { this.more = false; break; }
        this.more = true;
      }
      this.rebuild();
      if (this.live && !this.more) this.listenTail(generation);
    } catch { this.fail(generation); this.more = true; }
    finally { if (this.valid(generation)) { this.loading = false; this.changed.next(); } }
  }
  private listenTail(generation: number) {
    this.tailWindows++;
    let query = this.root.doc(this.day).collection('chunks').orderBy(firebase.firestore.FieldPath.documentId()).limit(PAGE_SIZE);
    if (this.lastChunk) query = query.startAt(this.lastChunk);
    this.tailOff = query.onSnapshot({ includeMetadataChanges: true }, snapshot => {
      if (!this.valid(generation) || snapshot.metadata.fromCache) return;
      for (const change of snapshot.docChanges()) {
        const chunk = change.doc.data() as GreenpowerChunk;
        // Bound new history retained by this listener before another user action.
        this.tailBytes += Math.max(0, chunk.bytes - (this.chunks.get(change.doc.id)?.bytes || 0));
        this.setChunk(change.doc.id, chunk);
      }
      this.rebuild();
      if (snapshot.size >= PAGE_SIZE || this.tailBytes >= MAX_LOAD_BYTES) {
        this.tailOff?.(); this.tailOff = undefined;
        if (this.tailWindows < MAX_PAGES && this.tailBytes < MAX_LOAD_BYTES) {
          // Keep normal all-day operation continuous. The next window overlaps
          // the mutable boundary; cap automatic rebases as well as query size.
          queueMicrotask(() => { if (this.valid(generation)) this.listenTail(generation); });
        } else { this.more = true; this.changed.next(); }
      }
    }, () => this.fail(generation));
  }
  async loadDates() {
    if (this.access !== 'signed-in' || this.loadingDates) return;
    const generation = this.datesGeneration;
    this.loadingDates = true; this.datesError = ''; this.changed.next();
    try {
      let query = this.root.orderBy(firebase.firestore.FieldPath.documentId(), 'desc').limit(30);
      if (this.datesCursor) query = query.startAfter(this.datesCursor);
      const snapshot = await query.get({ source: 'server' });
      if (generation !== this.datesGeneration || this.destroyed) return;
      this.dates.push(...snapshot.docs.map(doc => doc.id));
      this.datesCursor = snapshot.docs.at(-1) || this.datesCursor;
      this.moreDates = snapshot.size === 30;
    } catch { if (generation === this.datesGeneration) this.datesError = 'Could not load dates. Try again.'; }
    finally { if (generation === this.datesGeneration && !this.destroyed) { this.loadingDates = false; this.changed.next(); } }
  }
  tick() {
    if (this.access === 'signed-in' && this.live && this.day !== londonDay()) void this.select(londonDay(), true);
  }
  private get lastChunk() { return Array.from(this.chunks.keys()).sort().at(-1); }
  private valid(generation: number) { return !this.destroyed && generation === this.generation && this.access === 'signed-in'; }
  private fail(generation: number) { if (this.valid(generation)) { this.connected = false; this.error = 'Could not load telemetry. Check your connection and try again.'; this.changed.next(); } }
  private setChunk(id: string, chunk: GreenpowerChunk) {
    this.chunks.set(id, chunk);
    this.projections.set(id, channelsFor([...chunk.samples].sort((a, b) => a.receivedAt - b.receivedAt || a.id.localeCompare(b.id))));
  }
  private rebuild() {
    let start = Infinity, end = -Infinity;
    for (const chunk of this.chunks.values()) for (const sample of chunk.samples) { start = Math.min(start, sample.receivedAt); end = Math.max(end, sample.receivedAt); }
    this.start = Number.isFinite(start) ? start : this.latest?.receivedAt || Date.now();
    this.end = Number.isFinite(end) ? end : this.start;
    this.channels = mergeChannels(Array.from(this.projections.values()), this.latest);
    this.changed.next();
  }
  ngOnDestroy() {
    this.destroyed = true; this.stop(); this.authSubscription.unsubscribe(); this.datesGeneration++;
    this.chunks.clear(); this.projections.clear(); this.channels = []; this.latest = undefined; this.dates = []; this.changed.complete();
  }
}
