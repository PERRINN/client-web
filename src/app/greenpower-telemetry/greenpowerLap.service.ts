import { Injectable, OnDestroy } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { Subject, Subscription } from 'rxjs';
import { PermissionsService } from '../permissions.service';
import { GreenpowerChannel } from './greenpowerData';
import { FinishLine, gpsAnalysis, gpsFixes, validLine } from './greenpowerGps';
import { contains, lookupAnchor, matchesTrack, mergedCoverage, MAX_TRACK_PAGES, trackCell, TrackChoice, trackCoverage, TrackDefinition, TRACK_PAGE_SIZE, TRACKS_PATH, validTrack } from './greenpowerTracks';

@Injectable()
export class GreenpowerLapService implements OnDestroy {
  readonly changed = new Subject<void>();
  ready = false;
  saving = false;
  searching = false;
  error = '';
  candidates: TrackChoice[] = [];
  more = false;
  selectedId = '';
  creating = false;
  mismatch = false;
  private dataset = '';
  private account = '';
  private generation = 0;
  private off?: () => void;
  private saved?: TrackDefinition;
  private readonly subscription: Subscription;
  private readonly tracks: firebase.firestore.CollectionReference;
  private source?: GreenpowerChannel[];
  private analysedLine?: FinishLine | null;
  private analysedEnd = 0;
  private analysedMismatch = false;
  private lookedUp = false;
  private cell = '';
  private pages = 0;
  private cursor?: firebase.firestore.QueryDocumentSnapshot;
  private newId = '';
  fixes = gpsFixes([]);
  analysis = gpsAnalysis([], undefined, [], 0);
  constructor(public permissions: PermissionsService, firestore: AngularFirestore) {
    this.tracks = firestore.firestore.collection(TRACKS_PATH);
    this.subscription = permissions.state.subscribe(state => {
      const account = state.ready ? state.uid : '';
      if (account !== this.account) { this.account = account; this.reset(); }
      this.changed.next();
    });
  }
  get line() { return this.ready ? this.saved?.line ?? null : null; }
  get name() { return this.saved?.name ?? ''; }
  get revision() { return this.saved?.revision ?? 0; }
  get canEdit() { return this.ready && this.permissions.current.isAdmin && this.account === this.permissions.current.uid; }
  get hasMore() { return this.more && this.pages < MAX_TRACK_PAGES; }
  select(dataset: string) {
    if (this.dataset === dataset) return;
    this.dataset = dataset; this.reset();
  }
  private reset() {
    this.off?.(); this.off = undefined; this.generation++;
    this.saved = undefined; this.ready = false; this.searching = false; this.error = '';
    this.selectedId = ''; this.creating = this.mismatch = false;
    this.candidates = []; this.lookedUp = false; this.more = false; this.pages = 0; this.cursor = undefined; this.cell = ''; this.newId = '';
    this.source = undefined; this.fixes = []; this.analysis = gpsAnalysis([], undefined, [], 0);
  }
  update(channels: GreenpowerChannel[], end: number) {
    if (!this.account) { this.source = undefined; this.fixes = []; this.analysis = gpsAnalysis([], undefined, [], 0); return; }
    const changed = this.source !== channels;
    if (changed) this.fixes = gpsFixes(channels);
    if (this.account && !this.lookedUp && !this.searching && this.dataset) {
      const anchor = lookupAnchor(this.fixes);
      if (anchor) { this.cell = trackCell(anchor); this.lookedUp = true; void this.lookup(); }
    }
    this.mismatch = !!this.saved && this.fixes.some(fix => !contains(this.saved!.bounds, fix));
    if (!changed && this.analysedLine === this.line && this.analysedEnd === end && this.analysedMismatch === this.mismatch) return;
    this.source = channels; this.analysedLine = this.line; this.analysedEnd = end; this.analysedMismatch = this.mismatch;
    this.analysis = gpsAnalysis(this.fixes, this.mismatch ? null : this.line, channels, end);
  }
  private async lookup(append = false) {
    if (!this.account || this.searching || !this.cell || this.pages >= MAX_TRACK_PAGES) return;
    const generation = this.generation;
    this.searching = true; this.error = '';
    try {
      let query = this.tracks.where('cells', 'array-contains', this.cell).limit(TRACK_PAGE_SIZE);
      if (append && this.cursor) query = query.startAfter(this.cursor);
      const snapshot = await query.get({ source: 'server' });
      if (generation !== this.generation) return;
      this.pages++; this.cursor = snapshot.docs.at(-1) ?? this.cursor;
      const choices: TrackChoice[] = [];
      for (const doc of snapshot.docs) {
        const value = doc.data();
        if (!validTrack(value)) throw new Error('invalid');
        choices.push({ ...value, id: doc.id });
      }
      this.candidates = append ? [...this.candidates, ...choices] : choices;
      this.more = snapshot.size === TRACK_PAGE_SIZE;
      this.ready = true;
      // A full result page may hide another match, so it can never authorize auto-selection.
      if (!append && !this.more) {
        const matches = choices.filter(track => matchesTrack(track, this.fixes));
        if (matches.length === 1) { this.searching = false; this.choose(matches[0].id); }
      }
    } catch {
      if (generation === this.generation) { this.ready = false; this.error = 'Could not find nearby tracks. Try again.'; }
    } finally {
      if (generation === this.generation) { this.searching = false; this.changed.next(); }
    }
  }
  loadMore() { if (this.hasMore && !this.searching) void this.lookup(true); }
  retry() {
    if (this.selectedId) this.listen();
    else if (this.lookedUp) { this.pages = 0; this.cursor = undefined; void this.lookup(); }
  }
  choose(id: string) {
    if (this.saving || !this.candidates.some(track => track.id === id) || !this.account) return;
    this.selectedId = id; this.creating = false; this.newId = ''; this.listen(); this.changed.next();
  }
  newTrack() {
    if (!this.canEdit || this.saving || this.searching || !lookupAnchor(this.fixes)) return;
    this.off?.(); this.off = undefined; this.saved = undefined; this.selectedId = '';
    this.generation++; this.creating = true; this.newId = this.tracks.doc().id; this.ready = true; this.error = ''; this.changed.next();
  }
  private remember(id: string, track: TrackDefinition) {
    const choice = { ...track, id };
    this.candidates = this.candidates.some(candidate => candidate.id === id)
      ? this.candidates.map(candidate => candidate.id === id ? choice : candidate) : [...this.candidates, choice];
  }
  private listen() {
    this.off?.(); this.off = undefined; this.generation++;
    this.saved = undefined; this.ready = false; this.error = '';
    if (!this.account || !this.selectedId) return;
    const generation = this.generation;
    this.off = this.tracks.doc(this.selectedId).onSnapshot({ includeMetadataChanges: true }, snapshot => {
      if (generation !== this.generation || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const value = snapshot.data();
      if (validTrack(value) && this.saved && value.revision < this.saved.revision) return;
      if (!snapshot.exists || !validTrack(value)) { this.ready = false; this.error = 'Track settings are unavailable.'; }
      else { this.saved = value; this.remember(this.selectedId, value); this.ready = true; this.error = ''; }
      this.changed.next();
    }, () => {
      if (generation !== this.generation) return;
      this.ready = false; this.error = 'Could not load track settings.'; this.changed.next();
    });
  }
  async save(line: FinishLine | null, revision: number, name: string) {
    if (!this.canEdit || this.saving) return false;
    if ((line !== null && !validLine(line)) || !name.trim() || name.trim().length > 60) {
      this.error = 'Enter a track name and a line between 2 and 500 m long.'; this.changed.next(); return false;
    }
    const loadedCoverage = trackCoverage(this.fixes, line);
    const coverage = loadedCoverage && (this.saved ? mergedCoverage(this.saved.bounds, loadedCoverage.bounds) : loadedCoverage);
    if (!coverage || line && (!contains(coverage.bounds, line.a) || !contains(coverage.bounds, line.b))) {
      this.error = 'Track coverage must fit one venue. Keep the line within the recorded track area.'; this.changed.next(); return false;
    }
    if (!this.selectedId && !this.newId) this.newId = this.tracks.doc().id;
    const id = this.selectedId || this.newId;
    const ref = this.tracks.doc(id), generation = this.generation, uid = this.account;
    const value = line ? { a: { ...line.a }, b: { ...line.b }, direction: line.direction } : null;
    const track: TrackDefinition = { name: name.trim(), line: value, ...coverage, revision: revision + 1, updatedBy: uid };
    this.saving = true; this.error = ''; this.changed.next();
    try {
      let attempts = 0;
      await ref.firestore.runTransaction(async transaction => {
        if (++attempts > 3) throw new Error('retry-limit');
        if (generation !== this.generation || !this.canEdit) throw new Error('access');
        const snapshot = await transaction.get(ref);
        if (generation !== this.generation || !this.canEdit) throw new Error('access');
        if ((snapshot.data()?.['revision'] ?? 0) !== revision) throw new Error('conflict');
        transaction.set(ref, { ...track, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      });
      if (generation !== this.generation) return false;
      this.selectedId = id; this.creating = false; this.newId = '';
      if (!this.saved || this.saved.revision < track.revision) this.saved = track;
      this.remember(id, track);
      if (!this.off) {
        // Keep the acknowledged definition available while attaching its single listener.
        this.listen(); this.saved = track; this.ready = true;
      }
      return true;
    } catch (error) {
      if (generation === this.generation) this.error = error instanceof Error && error.message === 'conflict'
        ? 'Track changed elsewhere. Cancel and reopen Edit.' : 'Could not save track. Try again.';
      return false;
    } finally { this.saving = false; this.changed.next(); }
  }
  ngOnDestroy() { this.generation++; this.off?.(); this.subscription.unsubscribe(); this.changed.complete(); }
}
