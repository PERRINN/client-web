import { EnvironmentInjector, Injectable, NgZone, OnDestroy, runInInjectionContext } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { UserInterfaceService } from '../../userInterface.service';
import { AngularFireDatabase } from '@angular/fire/compat/database';
import firebase from 'firebase/compat/app';
import 'firebase/compat/database';
import { firstValueFrom, Subject, Subscription } from 'rxjs';
import { RadioAudioService, RadioSignal } from './radioAudio.service';
import { activeFloor, connectionFor, RadioRoom, ROOM_PATH, seatFor, speakerFor } from './radioState';

@Injectable()
export class RadioRoomService implements OnDestroy {
  readonly changed = new Subject<void>();
  room: RadioRoom = {};
  user?: firebase.User;
  loading = true;
  connected = false;
  joined = false;
  muted = false;
  error = '';
  seat?: string;
  session = '';
  clock = Date.now();
  private offset = 0;
  private destroyed = false;
  private authSubscription: Subscription;
  private listeners: (() => void)[] = [];
  private mailbox?: () => void;
  private signals: Record<string, RadioSignal> = {};
  private presenceRef?: firebase.database.Reference;
  private tickTimer: ReturnType<typeof setInterval>;
  private heartbeatTimer: ReturnType<typeof setInterval>;
  private held = false;
  private press = 0;
  private releasing = false;
  private activePresence = false;
  private root: firebase.database.Reference;
  private lastPresence = '';
  private speakingToken?: string;
  get speakingPlace() { return this.user ? speakerFor(this.room, this.user.uid) : undefined; }
  get floor() { return activeFloor(this.room, this.clock); }
  get seats() { return Object.entries(this.room.seats || {}).map(([id, value]) => ({ id, ...value })); }
  get speakerCount() { return Object.keys(this.room.speakers || {}).length; }
  get transmitting() { return !!this.speakingToken && this.floor?.token === this.speakingToken; }
  get audioReady() { return this.activePresence && this.connected && this.audio.canTransmit; }

  constructor(private auth: AngularFireAuth, database: AngularFireDatabase, public audio: RadioAudioService, private zone: NgZone, private profiles: UserInterfaceService, private firestore: AngularFirestore, private injector: EnvironmentInjector) {
    this.root = database.database.ref(ROOM_PATH);
    this.audio.onSignal = async (seat, signal) => { await this.root.child(`signals/${seat}/${this.seat}`).set(signal); };
    this.audio.onError = message => this.zone.run(() => this.error = message);
    this.audio.onEnded = () => this.zone.run(() => { void this.releaseTalk(); });
    this.audio.onChange = () => this.zone.run(() => this.refreshPresence());
    this.authSubscription = this.auth.authState.subscribe(user => {
      this.stopSession(); this.unlisten(); this.room = {}; this.seat = undefined; this.error = '';
      this.user = user || undefined; this.loading = !!user;
      if (!user) return;
      this.watch(database.database.ref('.info/serverTimeOffset'), value => this.offset = Number(value) || 0);
      this.watch(database.database.ref('.info/connected'), value => {
        this.connected = value === true;
        if (!this.connected) { this.activePresence = false; void this.releaseTalk(); }
        else if (this.joined) void this.registerPresence().catch(error => this.showError(error));
      });
      for (const [name, limit] of [['seats', 10], ['speakers', 3], ['presence', 10]] as const) {
        this.watch(this.root.child(name).limitToFirst(limit), value => {
          this.room = { ...this.room, [name]: value || {} };
          if (name === 'seats') { this.loading = false; this.seat = seatFor(this.room, user.uid); }
          this.sync();
        });
      }
      this.watch(this.root.child('floor'), value => { this.room = { ...this.room, floor: value || undefined }; this.sync(); });
    });
    this.tickTimer = setInterval(() => this.zone.run(() => { this.clock = Date.now() + this.offset; this.sync(); }), 250);
    this.heartbeatTimer = setInterval(() => this.refreshPresence(true), 5000);
  }

  async join() {
    if (!this.user || !this.connected) throw new Error('Sign in and connect before joining.');
    this.error = '';
    await this.audio.resume();
    const uid = this.user.uid;
    if (this.seat === undefined) {
      const name = await this.resolveName(this.user);
      if (this.destroyed || this.user?.uid !== uid) return;
      for (let index = 0; index < 10; index++) {
        const ref = this.root.child(`seats/${index}`);
        const result = await ref.transaction(current => current === null ? { uid, name } : undefined, undefined, false);
        if (result.committed) { this.seat = String(index); break; }
      }
      if (this.seat === undefined) throw new Error('Room full. All 10 places are reserved.');
    }
    if (this.destroyed || this.user?.uid !== uid) return;
    this.joined = true;
    await this.registerPresence();
  }

  async reconnect() {
    this.stopSession();
    await this.join();
  }

  async enableTalking() {
    if (!this.joined || !this.activePresence) throw new Error('Join the radio first.');
    const uid = this.user.uid;
    const session = this.session;
    try {
      await this.audio.enableMicrophone();
      if (this.destroyed || !this.joined || this.session !== session || this.user?.uid !== uid) { this.audio.disableMicrophone(); return; }
      if (this.speakingPlace !== undefined) return;
      for (let index = 0; index < 3; index++) {
        const result = await this.root.child(`speakers/${index}`).transaction(current => current === null ? { uid, seat: this.seat } : undefined, undefined, false);
        if (result.committed) return;
      }
      throw new Error('All 3 speaking places are taken.');
    } catch (error) { this.audio.disableMicrophone(); throw error; }
  }

  async disableTalking() {
    await this.releaseTalk();
    this.audio.disableMicrophone();
    const place = this.speakingPlace;
    if (place !== undefined) await this.root.child(`speakers/${place}`).remove();
  }

  async leave() {
    if (this.seat === undefined || !this.connected) throw new Error('Reconnect to release your place.');
    await this.disableTalking();
    const seat = this.seat;
    await this.root.child(`presence/${seat}`).remove();
    // Fixed mailboxes contain at most ten bounded SDP records. Remove both directions.
    const updates: Record<string, null> = { [`signals/${seat}`]: null };
    for (let index = 0; index < 10; index++) if (String(index) !== seat) updates[`signals/${index}/${seat}`] = null;
    await this.root.update(updates);
    await this.root.child(`seats/${seat}`).remove();
    this.stopSession(); this.seat = undefined;
  }

  toggleMute() { this.muted = !this.muted; this.sync(); this.refreshPresence(); }

  async talk() {
    if (this.held || this.releasing) return;
    this.held = true;
    const press = ++this.press;
    this.error = '';
    if (this.speakingPlace === undefined || !this.audioReady) { this.error = 'Audio is not ready.'; return; }
    const token = crypto.randomUUID();
    try {
      const result = await this.root.child('floor').transaction(current => {
        const room = { ...this.room, floor: current };
        if (activeFloor(room, Date.now() + this.offset)) return;
        const now = Date.now() + this.offset;
        return { uid: this.user.uid, seat: this.seat, session: this.session, token, startedAt: now, expiresAt: now + 30000 };
      }, undefined, false);
      if (!result.committed) { this.error = 'Channel busy'; return; }
      if (press !== this.press || !this.held || !this.audioReady) { await this.clearFloor(token); return; }
      const floor = result.snapshot.val();
      this.speakingToken = token;
      this.audio.transmit(floor, floor.expiresAt - Date.now() - this.offset);
    } catch (error) { await this.clearFloor(token).catch(() => {}); this.showError(error); }
  }

  async releaseTalk() {
    this.held = false; ++this.press;
    this.audio.stop();
    const token = this.speakingToken;
    const uid = this.user?.uid;
    this.speakingToken = undefined;
    if (!token || this.releasing) return;
    this.releasing = true;
    try {
      // Let the buffered final syllable drain before receivers close their audio gates.
      await new Promise(resolve => setTimeout(resolve, 200));
      if (this.connected && this.user?.uid === uid) await this.clearFloor(token);
    } catch (error) { this.showError(error); }
    finally { this.releasing = false; }
  }

  status(seat: string) {
    const connection = connectionFor(this.room, seat, this.clock)?.[1];
    if (!connection) return 'Offline';
    if (this.floor?.seat === seat) return 'Talking';
    if (!connection.ready) return 'Connecting';
    return connection.muted ? 'Muted' : 'Listening';
  }
  isSpeaker(uid: string) { return speakerFor(this.room, uid) !== undefined; }
  showError(error: unknown) {
    const code = (error as { code?: string })?.code || '';
    if (code.includes('permission') || code.includes('PERMISSION')) this.error = 'Radio access denied.';
    else if ((error as Error)?.name === 'NotAllowedError') this.error = 'Microphone permission denied. Allow it in your browser and try again.';
    else if ((error as Error)?.name === 'NotFoundError') this.error = 'No microphone found.';
    else this.error = error instanceof Error ? error.message : 'Radio connection failed. Try Reconnect.';
  }

  ngOnDestroy() {
    this.destroyed = true; this.stopSession(); this.unlisten(); this.authSubscription.unsubscribe();
    clearInterval(this.tickTimer); clearInterval(this.heartbeatTimer); this.changed.complete();
  }
  private async resolveName(user: firebase.User) {
    const cached = this.profiles.currentUserLastMessageObj;
    if (cached?.user === user.uid && typeof cached.name === 'string' && cached.name.trim()) return cached.name.trim().slice(0, 80);
    try {
      const snapshot = await firstValueFrom(runInInjectionContext(this.injector, () =>
        this.firestore.collection<{ name?: string }>('PERRINNMessages', query =>
          query.where('user', '==', user.uid).where('verified', '==', true)
            .orderBy('serverTimestamp', 'desc').limit(1)
        ).get()
      ));
      const name = snapshot.docs[0]?.data().name?.trim();
      if (name) return name.slice(0, 80);
    } catch { /* A missing profile must not prevent authenticated participation. */ }
    return (user.displayName || `Contributor ${user.uid.slice(0, 6)}`).slice(0, 80);
  }
  private async clearFloor(token: string) {
    await this.root.child('floor').transaction(current => current?.token === token ? null : undefined, undefined, false);
  }
  private async registerPresence() {
    if (!this.joined || this.seat === undefined || !this.connected || this.destroyed) return;
    await this.removePresence();
    const session = crypto.randomUUID(); this.session = session;
    const ref = this.root.child(`presence/${this.seat}`);
    this.presenceRef = ref;
    // Confirm ownership first: the disconnect write is checked both now and at execution.
    await ref.set(this.presenceData());
    await ref.onDisconnect().set({ ...this.presenceData(), session, online: false, ready: false });
    if (this.destroyed || !this.joined || this.session !== session) { await ref.onDisconnect().cancel(); return; }
    // Replacing only this account's connection makes its newest tab the active radio.
    this.activePresence = true; this.lastPresence = '';
    this.mailbox?.();
    this.mailbox = this.watch(this.root.child(`signals/${this.seat}`).limitToFirst(10), value => { this.signals = value || {}; this.sync(); }, false);
    this.sync();
  }
  private presenceData() {
    return { session: this.session, online: true, at: firebase.database.ServerValue.TIMESTAMP, muted: this.muted, ready: this.audio.ready && this.audio.connectedCount === this.audio.peerCount };
  }
  private refreshPresence(force = false) {
    if (!this.joined || !this.connected || !this.activePresence || !this.presenceRef) return;
    const data = this.presenceData(); const key = `${data.session}:${data.muted}:${data.ready}`;
    if (!force && key === this.lastPresence) return;
    this.lastPresence = key;
    // A superseded tab must never revive itself through a late heartbeat.
    void this.presenceRef.transaction(current => current?.session === data.session ? data : undefined, undefined, false)
      .catch(error => this.zone.run(() => this.showError(error)));
  }
  private sync() {
    if (this.destroyed) return;
    this.clock = Date.now() + this.offset;
    if (this.joined && this.seat !== undefined && this.activePresence) {
      const connection = connectionFor(this.room, this.seat, this.clock);
      if (connection && connection[0] !== this.session) {
        this.stopSession(); this.error = 'Radio opened in another tab. Reconnect to use this tab.'; return;
      }
      const peers = this.seats.flatMap(seat => {
        const connection = connectionFor(this.room, seat.id, this.clock);
        return connection ? [{ seat: seat.id, session: connection[0], speaker: this.isSpeaker(seat.uid) }] : [];
      });
      this.audio.reconcile(this.seat, this.session, this.speakingPlace !== undefined, peers);
      for (const [seat, signal] of Object.entries(this.signals)) this.audio.receive(seat, signal);
    }
    this.audio.setFloor(this.connected && this.joined ? this.floor : undefined, this.muted);
    this.changed.next();
  }
  private async removePresence() {
    const ref = this.presenceRef; const session = this.session; this.presenceRef = undefined;
    if (ref) await ref.transaction(current => current?.session === session ? null : undefined, undefined, false);
  }
  private watch(query: firebase.database.Query, callback: (value: any) => void, track = true) {
    const handler = query.on('value', snapshot => this.zone.run(() => { if (!this.destroyed) callback(snapshot.val()); }), error => this.zone.run(() => { this.loading = false; this.showError(error); }));
    const unsubscribe = () => query.off('value', handler);
    if (track) this.listeners.push(unsubscribe);
    return unsubscribe;
  }
  private unlisten() { this.listeners.splice(0).forEach(unsubscribe => unsubscribe()); this.connected = false; }
  private stopSession() {
    void this.releaseTalk(); this.joined = false; this.activePresence = false;
    this.mailbox?.(); this.mailbox = undefined; this.signals = {};
    void this.removePresence().catch(() => {});
    this.audio.close(); this.session = '';
  }
}
