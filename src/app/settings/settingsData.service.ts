import { EnvironmentInjector, Injectable, NgZone, OnDestroy, runInInjectionContext } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { BehaviorSubject, Subscription, catchError, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { UserInterfaceService } from '../userInterface.service';
import { ImageUploadService, imageUploadState } from '../imageUpload.service';
import { userPhotoSources } from '../userAvatar';
import { ProfileDraft, ProfileField, SettingsProfile, profileChanges, profileDraft, profileErrors, profileFields } from './settingsModel';

/** One routed Settings session; existing message contracts and one latest-profile listener. */
@Injectable()
export class SettingsDataService implements OnDestroy {
  uid = '';
  profile: SettingsProfile = {};
  draft: ProfileDraft = profileDraft({});
  errors: Partial<Record<ProfileField, string>> = {};
  contractLevel = '';
  loading = true;
  unavailable = false;
  saving = false;
  saveError = '';
  saved = false;
  currencySaving = false;
  currencyError = '';
  contractSaving = false;
  contractError = '';
  contractSaved = false;
  photo = imageUploadState();
  private baseline = profileDraft({});
  private pendingCurrency: string | null = null;
  private generation = 0;
  private destroyed = false;
  private subscription?: Subscription;
  private changes = new BehaviorSubject<void>(undefined);
  readonly state = this.changes.asObservable();

  constructor(private auth: AngularFireAuth, private afs: AngularFirestore, private uploads: ImageUploadService,
    private UI: UserInterfaceService, private injector: EnvironmentInjector, private zone: NgZone) {}

  get hasPhoto() { return userPhotoSources([this.profile.imageUrlMedium, this.profile.imageUrlThumbUser, this.profile.imageUrlOriginal]).length > 0; }
  get busy() { return this.saving || this.currencySaving || this.contractSaving || this.photo.busy; }
  get canEdit() { return !!this.uid && this.UI.currentUser === this.uid && !this.loading && !this.unavailable; }
  get dirty() { return Object.keys(profileChanges(this.draft, this.baseline)).length > 0; }
  get currency() { return this.pendingCurrency || this.profile.userCurrency || 'usd'; }
  get currencies(): { code: string; label: string }[] {
    return Object.entries(this.UI.PERRINNAdminLastMessageObj?.currencyList || {}).map(([code, value]: [string, { designation?: string }]) => ({ code, label: value.designation || code.toUpperCase() }));
  }
  get contractChanged() { return this.contractLevel !== String(this.profile.contract?.level || ''); }
  get validContract() { return /^\d{1,2}$/.test(this.contractLevel) && Number(this.contractLevel) >= 1 && Number(this.contractLevel) <= 10; }

  start() {
    if (this.subscription || this.destroyed) return;
    this.subscription = this.auth.authState.pipe(map(user => user?.uid || ''), distinctUntilChanged(), switchMap(uid => {
      if (uid !== this.uid) this.reset(uid);
      this.loading = !!uid;
      this.unavailable = false;
      this.publish();
      return uid ? runInInjectionContext(this.injector, () => this.afs.collection<SettingsProfile>('PERRINNMessages', ref => ref
        .where('user', '==', uid).where('verified', '==', true).orderBy('serverTimestamp', 'desc').limit(1)
          ).valueChanges().pipe(catchError(() => {
        this.loading = false; this.unavailable = true; this.publish();
        return of(null);
      }))) : of([]);
    })).subscribe({ next: rows => { if (rows) this.receive(rows[0] || {}); }, error: () => {
      this.reset('');
      this.loading = false; this.unavailable = true; this.publish();
    } });
  }
  retry() { this.subscription?.unsubscribe(); this.subscription = undefined; this.start(); }
  edit(field: ProfileField, value: string) { this.draft[field] = value; delete this.errors[field]; this.saved = false; this.saveError = ''; }
  cancel() {
    if (this.saving) return;
    this.draft = { ...this.baseline }; this.errors = {}; this.saveError = ''; this.saved = false;
  }
  async saveProfile() {
    if (!this.canEdit || this.busy || !this.dirty) return;
    this.errors = profileErrors(this.draft, this.baseline);
    if (Object.keys(this.errors).length) { this.publish(); return; }
    const fields = profileChanges(this.draft, this.baseline), generation = this.generation;
    this.saving = true; this.saveError = ''; this.saved = false; this.publish();
    try {
      await this.write({ text: 'Updating my profile.', ...fields });
      if (!this.active(generation)) return;
      this.profile = { ...this.profile, ...fields };
      this.baseline = profileDraft(this.profile); this.draft = { ...this.baseline };
      this.updateLocalProfile(fields); this.saved = true;
    } catch { if (this.active(generation)) this.saveError = 'Profile couldn’t save. Try again.'; }
    finally { if (this.active(generation)) { this.saving = false; this.publish(); } }
  }
  async setCurrency(code: string) {
    if (!this.canEdit || this.busy || code === this.currency || !this.currencies.some(item => item.code === code)) return;
    const generation = this.generation;
    this.currencySaving = true; this.pendingCurrency = code; this.currencyError = ''; this.publish();
    try {
      const designation = this.currencies.find(item => item.code === code).label;
      await this.write({ text: 'Updating my preferred currency to ' + designation, userCurrency: code });
      if (!this.active(generation)) return;
      this.profile = { ...this.profile, userCurrency: code }; this.updateLocalProfile({ userCurrency: code });
    } catch { if (this.active(generation)) this.currencyError = 'Currency couldn’t save. Try again.'; }
    finally { if (this.active(generation)) { this.pendingCurrency = null; this.currencySaving = false; this.publish(); } }
  }
  async saveContract() {
    if (!this.canEdit || this.busy || !this.contractChanged || !this.validContract) return;
    const generation = this.generation, level = Number(this.contractLevel);
    this.contractSaving = true; this.contractError = ''; this.contractSaved = false; this.publish();
    try {
      await this.write({ text: 'Updating my contract details to level ' + level, contract: { level } });
      if (!this.active(generation)) return;
      this.profile = { ...this.profile, contract: { ...this.profile.contract, level, signed: false } };
      this.updateLocalProfile({ contract: this.profile.contract }); this.contractSaved = true;
    } catch { if (this.active(generation)) this.contractError = 'Contract couldn’t save. Try again.'; }
    finally { if (this.active(generation)) { this.contractSaving = false; this.publish(); } }
  }
  cancelContract() {
    if (this.contractSaving) return;
    this.contractLevel = String(this.profile.contract?.level || ''); this.contractError = ''; this.contractSaved = false;
  }
  editContract(value: string) { this.contractLevel = value.replace(/\D/g, '').slice(0, 2); this.contractError = ''; this.contractSaved = false; }

  async uploadPhoto(input: HTMLInputElement) {
    try { await this.uploadPhotoFile(input.files?.[0]); } finally { input.value = ''; }
  }
  async pastePhoto() {
    if (this.busy || !this.canEdit) return;
    const generation = this.generation, photo = this.photo;
    photo.busy = true; photo.percent = null; photo.error = ''; this.publish();
    let image: File;
    try {
      const items = await navigator.clipboard.read();
      const item = items.find(item => item.types.some(type => type.startsWith('image/')));
      if (!item) throw new Error('No image');
      const type = item.types.find(type => type.startsWith('image/'));
      const blob = await item.getType(type);
      image = new File([blob], 'pasted-photo.' + (type.split('/')[1] || 'png'), { type });
    } catch {
      if (this.active(generation)) photo.error = 'Use Paste (⌘V or Ctrl+V) here, or choose a photo.';
    } finally { photo.busy = false; if (this.active(generation)) this.publish(); }
    if (image && this.active(generation)) await this.uploadPhotoFile(image);
  }
  async uploadPhotoFile(image?: File) {
    const photo = this.photo, generation = this.generation;
    if (!image || !image.type.startsWith('image/') || this.busy || !this.canEdit) return;
    const timestamp = String(Date.now());
    photo.busy = true; photo.percent = 0; photo.error = ''; this.publish();
    try {
      const url = await this.uploads.upload(`images/${timestamp}${image.name}`, image, percent => {
        if (this.active(generation)) { photo.percent = percent; this.publish(); }
      });
      if (!this.active(generation)) return;
      const photos = { userImageTimestamp: timestamp, imageUrlThumbUser: url, imageUrlMedium: url, imageUrlOriginal: url };
      await this.write({ text: 'updating my profile picture', ...photos,
        chatImageTimestamp: timestamp, chatImageUrlThumb: url, chatImageUrlMedium: url, chatImageUrlOriginal: url });
      if (!this.active(generation)) return;
      this.profile = { ...this.profile, ...photos }; this.updateLocalProfile(photos);
    } catch { if (this.active(generation)) photo.error = 'Profile picture couldn’t save. Try again.'; }
    finally {
      photo.busy = false; photo.percent = null;
      if (this.active(generation)) this.publish();
    }
  }
  private async write(fields: Record<string, unknown>) {
    const uid = this.uid, generation = this.generation;
    if (!this.canEdit || (await this.auth.currentUser)?.uid !== uid || !this.active(generation) || this.UI.currentUser !== uid) throw new Error('Account changed');
    await this.UI.createMessage({ chain: uid, ...fields });
  }
  private receive(profile: SettingsProfile) {
    const next = profileDraft(profile), dirty = this.dirty, contractDirty = this.contractChanged;
    for (const field of profileFields) if (!dirty || this.draft[field] === this.baseline[field]) this.draft[field] = next[field];
    if (!contractDirty) this.contractLevel = String(profile.contract?.level || '');
    this.baseline = next; this.profile = profile; this.loading = false; this.unavailable = false; this.publish();
  }
  private reset(uid: string) {
    this.generation++; this.uid = uid; this.profile = {}; this.baseline = profileDraft({}); this.draft = profileDraft({});
    this.contractLevel = ''; this.errors = {}; this.saveError = ''; this.currencyError = ''; this.contractError = '';
    this.saving = this.currencySaving = this.contractSaving = this.saved = this.contractSaved = false;
    this.pendingCurrency = null; this.photo = imageUploadState();
  }
  private updateLocalProfile(fields: Partial<SettingsProfile>) {
    if (this.UI.currentUser === this.uid) this.UI.currentUserLastMessageObj = { ...(this.UI.currentUserLastMessageObj || {}), ...fields };
  }
  private active(generation: number) { return !this.destroyed && generation === this.generation; }
  private publish() { if (!this.destroyed) this.zone.run(() => this.changes.next()); }
  ngOnDestroy() { this.destroyed = true; this.generation++; this.subscription?.unsubscribe(); this.changes.complete(); }
}
