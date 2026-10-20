import { Injectable, OnDestroy } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { Subject, Subscription } from 'rxjs';
import { PermissionsService } from '../permissions.service';
import { GreenpowerChannel } from './greenpowerData';
import { DatasetTrack, DatasetTrackWrite, datasetTrackPath, validDatasetTrack } from './greenpowerDatasetTrack';
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
  selectionReady = false;
  eventTrack = false;
  draftTrackId: string | null = null;
  private editing = false;
  private baseSelectionRevision = 0;
  private selection?: DatasetTrack;
  private selectionOff?: () => void;
  private dayOff?: () => void;
  private datasetGeneration = 0;
  private selectionGeneration = 0;
  private automaticId = '';
  private readonly firestore: firebase.firestore.Firestore;
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
    this.firestore = firestore.firestore;
    this.tracks = this.firestore.collection(TRACKS_PATH);
    this.subscription = permissions.state.subscribe(state => {
      const account = state.ready ? state.uid : '';
      if (account !== this.account) { this.account = account; this.reset(); }
      this.changed.next();
    });
  }
  get line() { return this.ready && this.selectionReady ? this.saved?.line ?? null : null; }
  get name() { return this.saved?.name ?? ''; }
  get revision() { return this.saved?.revision ?? 0; }
  get canSelect() { return this.selectionReady && this.permissions.current.isAdmin && this.account === this.permissions.current.uid; }
  get canEdit() { return this.ready && this.canSelect; }
  get hasMore() { return this.more && this.pages < MAX_TRACK_PAGES; }
  select(dataset: string) {
    if (this.dataset === dataset) return;
    this.dataset = dataset; this.reset();
  }
  private reset() {
    this.off?.(); this.off = undefined; this.generation++;
    this.selectionOff?.(); this.selectionOff = undefined; this.dayOff?.(); this.dayOff = undefined; this.datasetGeneration++; this.eventTrack = false;
    this.selection = undefined; this.selectionReady = false; this.editing = false; this.draftTrackId = null; this.automaticId = '';
    this.saved = undefined; this.ready = false; this.searching = false; this.error = '';
    this.selectedId = ''; this.creating = this.mismatch = false;
    this.candidates = []; this.lookedUp = false; this.more = false; this.pages = 0; this.cursor = undefined; this.cell = ''; this.newId = '';
    this.source = undefined; this.fixes = []; this.analysis = gpsAnalysis([], undefined, [], 0);
    this.listenSelection();
  }
  private listenSelection() {
    this.selectionOff?.(); this.selectionOff = undefined;
    const day = this.dataset.slice(0, 10), generation = this.datasetGeneration, listener = ++this.selectionGeneration;
    if (!this.account || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    const listenLegacy = () => { this.selectionOff = this.firestore.doc(datasetTrackPath(day)).onSnapshot({ includeMetadataChanges: true }, snapshot => {
      if (generation !== this.datasetGeneration || listener !== this.selectionGeneration || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const value = snapshot.data();
      if (validDatasetTrack(value) && this.selection && value.revision < this.selection.revision) return;
      if (snapshot.exists && !validDatasetTrack(value)) { this.selectionReady = this.ready = false; this.error = 'Dataset track settings are invalid.'; }
      else {
        this.selection = value as DatasetTrack | undefined; this.selectionReady = true; this.error = '';
        if (!this.editing) this.applySelection();
      }
      this.changed.next();
    }, () => {
      if (generation !== this.datasetGeneration || listener !== this.selectionGeneration) return;
      this.selectionReady = this.ready = false; this.error = 'Could not load dataset track settings.'; this.changed.next();
    }); };
    this.dayOff?.();
    this.dayOff = this.firestore.doc('GreenpowerTelemetry/424/days/' + day).onSnapshot({ includeMetadataChanges: true }, snapshot => {
      if (generation !== this.datasetGeneration || listener !== this.selectionGeneration || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const event = snapshot.data();
      if (event?.schemaVersion === 2) {
        this.selectionOff?.(); this.selectionOff = undefined; this.eventTrack = true;
        const value = { trackId: event.trackId, revision: event.revision, updatedBy: event.updatedBy };
        if (value.trackId !== null && (typeof value.trackId !== 'string' || !value.trackId || value.trackId.includes('/'))) {
          this.selectionReady = this.ready = false; this.error = 'Event track is unavailable.';
        } else {
          this.selection = value; this.selectionReady = true; this.error = '';
          this.draftTrackId = value.trackId; this.applySelection();
        }
        this.changed.next();
      } else if (!this.selectionOff) {
        this.eventTrack = false; listenLegacy();
        // A known legacy day needs its fixed config listener, not per-sample parent updates.
        if (snapshot.exists) { this.dayOff?.(); this.dayOff = undefined; }
      }
    }, () => { if (generation === this.datasetGeneration) { this.selectionReady = this.ready = false; this.error = 'Could not load event track.'; this.changed.next(); } });
  }
  syncEditing(editing: boolean) {
    editing = editing && this.selectionReady && this.permissions.current.isAdmin;
    if (editing === this.editing) return;
    this.editing = editing;
    if (editing) { this.draftTrackId = this.selection?.trackId ?? null; this.baseSelectionRevision = this.selection?.revision ?? 0; }
    else { this.creating = false; this.newId = ''; this.applySelection(); }
  }
  selectionWrite(): DatasetTrackWrite | undefined {
    if (this.eventTrack || !this.editing || !this.canSelect || this.draftTrackId === (this.selection?.trackId ?? null)) return undefined;
    const generation = this.datasetGeneration, trackId = this.draftTrackId, revision = this.baseSelectionRevision;
    return { day: this.dataset.slice(0, 10), trackId, revision,
      current: () => generation === this.datasetGeneration && this.editing && this.canSelect,
      acknowledged: () => {
        if (generation !== this.datasetGeneration) return;
        this.selection = { trackId, revision: revision + 1, updatedBy: this.account };
        this.baseSelectionRevision = revision + 1; this.applySelection(); this.changed.next();
      } };
  }
  private applySelection() {
    if (!this.selectionReady) { this.ready = false; return; }
    const id = (this.editing ? this.draftTrackId : this.selection?.trackId) ?? this.automaticId;
    if (id) { this.activate(id); return; }
    if (this.selectedId || this.off) { this.off?.(); this.off = undefined; this.generation++; }
    this.selectedId = ''; this.saved = undefined; this.ready = this.selectionReady;
  }
  update(channels: GreenpowerChannel[], end: number) {
    if (!this.account) { this.source = undefined; this.fixes = []; this.analysis = gpsAnalysis([], undefined, [], 0); return; }
    const changed = this.source !== channels;
    if (changed) this.fixes = gpsFixes(channels);
    if (this.account && this.selectionReady && !(this.editing ? this.draftTrackId : this.selection?.trackId) && !this.lookedUp && !this.searching && this.dataset) {
      const anchor = lookupAnchor(this.fixes);
      if (anchor) { this.cell = trackCell(anchor); this.lookedUp = true; void this.lookup(); }
    }
    this.mismatch = !!this.saved?.bounds && this.fixes.some(fix => !contains(this.saved!.bounds, fix));
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
        this.automaticId = matches.length === 1 ? matches[0].id : '';
        if (!this.selection?.trackId && (!this.editing || !this.draftTrackId) && !this.creating) { this.searching = false; this.applySelection(); }
      }
    } catch {
      if (generation === this.generation) { this.ready = false; this.error = 'Could not find nearby tracks. Try again.'; }
    } finally {
      if (generation === this.generation) { this.searching = false; this.changed.next(); }
    }
  }
  loadMore() { if (this.editing && this.canEdit && this.hasMore && !this.searching) void this.lookup(true); }
  retry() {
    if (!this.selectionReady) { this.listenSelection(); return; }
    if (this.selectedId) this.listen();
    else if (this.lookedUp) { this.pages = 0; this.cursor = undefined; void this.lookup(); }
  }
  choose(id: string) {
    if (!this.editing || !this.canSelect || this.saving || id && !this.candidates.some(track => track.id === id)) return;
    this.draftTrackId = id || null; this.creating = false; this.newId = ''; this.applySelection(); this.changed.next();
  }
  private activate(id: string) {
    if (this.selectedId === id && this.off) { this.ready = !!this.saved && this.selectionReady; return; }
    if (this.searching) this.lookedUp = false;
    this.searching = false; this.selectedId = id; this.creating = false; this.newId = ''; this.listen();
  }
  newTrack() {
    if (!this.editing || !this.canEdit || this.saving || this.searching || !lookupAnchor(this.fixes)) return;
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
      if (!snapshot.exists || !validTrack(value)) { this.saved = undefined; this.ready = false; this.error = 'Track settings are unavailable.'; }
      else { this.saved = value; this.remember(this.selectedId, value); this.ready = true; this.error = ''; }
      this.changed.next();
    }, () => {
      if (generation !== this.generation) return;
      this.off = undefined; this.saved = undefined; this.ready = false; this.error = 'Could not load track settings.'; this.changed.next();
    });
  }
  async save(line: FinishLine | null, revision: number, name: string) {
    if (!this.canEdit || this.saving) return false;
    if ((line !== null && !validLine(line)) || !name.trim() || name.trim().length > 60) {
      this.error = 'Enter a track name and a line between 2 and 500 m long.'; this.changed.next(); return false;
    }
    const loadedCoverage = trackCoverage(this.fixes, line);
    const coverage = loadedCoverage && (this.saved?.bounds ? mergedCoverage(this.saved.bounds, loadedCoverage.bounds) : loadedCoverage);
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
      if (this.editing) this.draftTrackId = id;
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
  ngOnDestroy() { this.generation++; this.datasetGeneration++; this.off?.(); this.selectionOff?.(); this.dayOff?.(); this.subscription.unsubscribe(); this.changed.complete(); }
}
