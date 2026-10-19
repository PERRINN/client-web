import { Injectable, OnDestroy } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { Subject, Subscription } from 'rxjs';
import { PermissionsService } from '../permissions.service';
import { GreenpowerChannel } from './greenpowerData';
import { editorChannels, GreenpowerView, selectedChannels, selectionFor, validSelection, validView, VIEW_PATH, ViewSelection } from './greenpowerView';

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
  scalars(channels: GreenpowerChannel[]) { return this.ready ? selectedChannels(channels, this.saved?.scalars) : []; }
  charts(channels: GreenpowerChannel[]) { return this.ready ? selectedChannels(channels, this.saved?.charts).filter(c => c.points.length) : []; }
  available(channels: GreenpowerChannel[]) { return editorChannels(channels, this.draft); }
  private listen() {
    const generation = ++this.generation;
    this.off = this.ref.onSnapshot({ includeMetadataChanges: true }, snapshot => {
      if (generation !== this.generation || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const value: unknown = snapshot.data();
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
    this.draft = { scalars: { ...selection.scalars }, charts: { ...selection.charts } };
    this.baseRevision = this.saved?.revision || 0; this.error = ''; this.editing = true; this.changed.next();
  }
  toggle(kind: keyof ViewSelection, id: string, checked: boolean) {
    if (!this.editing || this.saving) return;
    const map = { ...this.draft[kind] };
    if (checked) Object.defineProperty(map, id, { value: true, enumerable: true, configurable: true });
    else delete map[id];
    this.draft = { ...this.draft, [kind]: map }; this.changed.next();
  }
  cancel() { this.editing = false; this.draft = { scalars: {}, charts: {} }; this.changed.next(); }
  async save() {
    if (!this.canEdit || !this.editing || this.saving) return;
    if (!validSelection(this.draft)) { this.error = 'Choose up to 512 channels per view.'; this.changed.next(); return; }
    const generation = this.generation, uid = this.account, revision = this.baseRevision;
    const selection = { scalars: { ...this.draft.scalars }, charts: { ...this.draft.charts } };
    this.saving = true; this.error = ''; this.changed.next();
    try {
      let attempts = 0;
      await this.ref.firestore.runTransaction(async transaction => {
        if (++attempts > 3) throw new Error('retry-limit');
        if (generation !== this.generation || !this.canEdit) throw new Error('access');
        const current = await transaction.get(this.ref);
        if (generation !== this.generation || !this.canEdit) throw new Error('access');
        if ((current.data()?.['revision'] || 0) !== revision) throw new Error('conflict');
        transaction.set(this.ref, { ...selection, revision: revision + 1, updatedBy: uid, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      });
      if (generation === this.generation) this.cancel();
    } catch (error) {
      if (generation === this.generation) this.error = error instanceof Error && error.message === 'conflict'
        ? 'View changed elsewhere. Cancel and reopen the editor.' : 'Could not save view. Try again.';
    } finally {
      this.saving = false; this.changed.next();
    }
  }
  ngOnDestroy() { this.generation++; this.off?.(); this.subscription.unsubscribe(); this.changed.complete(); }
}
