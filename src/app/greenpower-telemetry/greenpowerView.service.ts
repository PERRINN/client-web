import { Injectable, OnDestroy } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { Subject, Subscription } from 'rxjs';
import { DatasetTrackWrite, datasetTrackPath, validTrackId } from './greenpowerDatasetTrack';
import { PermissionsService } from '../permissions.service';
import { GreenpowerChannel } from './greenpowerData';
import { copySelection, editorChannels, orderField, orderFor, ViewKind, GreenpowerView, selectedChannels, selectionFor, validSelection, validView, VIEW_PATH, ViewSelection } from './greenpowerView';

@Injectable()
export class GreenpowerViewService implements OnDestroy {
  readonly changed = new Subject<void>();
  ready = false;
  error = '';
  editing = false;
  saving = false;
  draft: ViewSelection = { scalars: {}, charts: {} };
  private saved?: GreenpowerView;
  private baseRevision = 0;
  private account = '';
  private generation = 0;
  private off?: () => void;
  private readonly subscription: Subscription;
  private readonly ref: firebase.firestore.DocumentReference;
  constructor(public permissions: PermissionsService, firestore: AngularFirestore) {
    this.ref = firestore.firestore.doc(VIEW_PATH);
    this.subscription = permissions.state.subscribe(state => {
      if (!state.isAdmin) this.cancel();
      const account = state.ready ? state.uid : '';
      if (account !== this.account) {
        this.off?.(); this.off = undefined; this.generation++; this.account = account;
        this.saved = undefined; this.ready = false; this.error = ''; this.cancel();
        if (account) this.listen();
      }
      this.changed.next();
    });
  }
  get canEdit() { return this.ready && this.permissions.current.isAdmin && this.account === this.permissions.current.uid; }
  scalars(channels: GreenpowerChannel[]) { return this.ready ? selectedChannels(channels, this.saved?.scalars, this.saved?.scalarOrder) : []; }
  charts(channels: GreenpowerChannel[]) { return this.ready ? selectedChannels(channels, this.saved?.charts, this.saved?.chartOrder).filter(c => c.points.length) : []; }
  available(channels: GreenpowerChannel[], kind: ViewKind) {
    const chosen = selectedChannels(channels, this.draft[kind], orderFor(this.draft, kind));
    const other = editorChannels(channels, this.draft).filter(c => !this.draft[kind][c.id] && (kind === 'scalars' || c.points.length));
    return [...chosen, ...other];
  }
  private listen() {
    const generation = ++this.generation;
    this.off = this.ref.onSnapshot({ includeMetadataChanges: true }, snapshot => {
      if (generation !== this.generation || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const value: unknown = snapshot.data();
      if (validView(value) && this.saved && value.revision < this.saved.revision) return;
      if (snapshot.exists && !validView(value)) { this.ready = false; this.error = 'View settings are invalid.'; }
      else { this.saved = value as GreenpowerView | undefined; this.ready = true; this.error = ''; }
      this.changed.next();
    }, () => {
      if (generation !== this.generation) return;
      this.ready = false; this.error = 'Could not load view settings.'; this.cancel(); this.changed.next();
    });
  }
  retry() { if (this.account) { this.off?.(); this.listen(); } }
  edit(channels: GreenpowerChannel[]) {
    if (!this.canEdit || this.saving) return;
    const selection = this.saved || selectionFor(channels);
    this.draft = copySelection(selection);
    this.baseRevision = this.saved?.revision || 0; this.error = ''; this.editing = true; this.changed.next();
  }
  toggle(kind: ViewKind, id: string, checked: boolean) {
    if (!this.editing || this.saving || !this.canEdit || !!this.draft[kind][id] === checked) return;
    const map = { ...this.draft[kind] };
    const order = orderFor(this.draft, kind).filter(key => key !== id);
    if (checked) Object.defineProperty(map, id, { value: true, enumerable: true, configurable: true });
    else delete map[id];
    if (checked) order.push(id);
    this.draft = { ...this.draft, [kind]: map, [orderField(kind)]: order }; this.changed.next();
  }
  move(kind: ViewKind, id: string, direction: -1 | 1) {
    this.reorder(kind, id, orderFor(this.draft, kind).indexOf(id) + direction);
  }
  reorder(kind: ViewKind, id: string, target: number) {
    if (!this.editing || this.saving || !this.canEdit) return;
    const order = orderFor(this.draft, kind), index = order.indexOf(id);
    if (index < 0 || !Number.isInteger(target) || target < 0 || target >= order.length || target === index) return;
    order.splice(index, 1); order.splice(target, 0, id);
    this.draft = { ...this.draft, [orderField(kind)]: order }; this.changed.next();
  }
  restoreOrder(kind: ViewKind, order: string[]) {
    if (!this.editing || this.saving || !this.canEdit) return;
    const selection = { ...this.draft, [orderField(kind)]: order.slice() };
    if (!validSelection(selection)) return;
    this.draft = selection; this.changed.next();
  }
  cancel() { this.editing = false; this.draft = { scalars: {}, charts: {} }; this.changed.next(); }
  async save(track?: DatasetTrackWrite) {
    if (!this.canEdit || !this.editing || this.saving) return;
    if (track && (!/^\d{4}-\d{2}-\d{2}$/.test(track.day) || !validTrackId(track.trackId) || !track.current())) return;
    if (!validSelection(this.draft)) { this.error = 'Choose up to 512 channels per view with a valid order.'; this.changed.next(); return; }
    const generation = this.generation, uid = this.account, revision = this.baseRevision;
    const selection = copySelection(this.draft);
    this.saving = true; this.error = ''; this.changed.next();
    try {
      let attempts = 0;
      await this.ref.firestore.runTransaction(async transaction => {
        if (++attempts > 3) throw new Error('retry-limit');
        if (generation !== this.generation || !this.canEdit) throw new Error('access');
        if (track && !track.current()) throw new Error('access');
        const current = await transaction.get(this.ref);
        const trackRef = track ? this.ref.firestore.doc(datasetTrackPath(track.day)) : undefined;
        const previousTrack = trackRef ? await transaction.get(trackRef) : undefined;
        if (generation !== this.generation || !this.canEdit) throw new Error('access');
        if (track && (!track.current() || (previousTrack?.data()?.['revision'] || 0) !== track.revision)) throw new Error('conflict');
        if ((current.data()?.['revision'] || 0) !== revision) throw new Error('conflict');
        transaction.set(this.ref, { ...selection, revision: revision + 1, updatedBy: uid, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        if (trackRef && track) transaction.set(trackRef, { trackId: track.trackId, revision: track.revision + 1, updatedBy: uid, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      });
      if (generation === this.generation && (!track || track.current())) {
        // The commit acknowledgement is authoritative even if our listener is still catching up.
        if (!this.saved || this.saved.revision < revision + 1) this.saved = { ...selection, revision: revision + 1, updatedBy: uid };
        track?.acknowledged();
        this.cancel();
      }
    } catch (error) {
      if (generation === this.generation) this.error = error instanceof Error && error.message === 'conflict'
        ? 'View or track selection changed elsewhere. Cancel and reopen the editor.' : 'Could not save view. Try again.';
    } finally {
      this.saving = false; this.changed.next();
    }
  }
  ngOnDestroy() { this.generation++; this.off?.(); this.subscription.unsubscribe(); this.changed.complete(); }
}
