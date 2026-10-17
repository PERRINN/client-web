import { EnvironmentInjector, Injectable, NgZone, OnDestroy, runInInjectionContext } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { UserInterfaceService } from '../../userInterface.service';
import { AngularFireDatabase } from '@angular/fire/compat/database';
import firebase from 'firebase/compat/app';
import 'firebase/compat/database';
import { firstValueFrom, Subject, Subscription } from 'rxjs';
import { RadioAudioService, RadioSignal } from './radioAudio.service';
import { activeFloor, connectionFor, RadioRoom, RECONNECT_GRACE_MS, ROOM_PATH, seatFor, speakerFor } from './radioState';

@Injectable()
export class RadioRoomService implements OnDestroy {
  readonly changed = new Subject<void>();
  room: RadioRoom = {};
  user?: firebase.User;
  loading = true;
  connected = false;
  joined = false;
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
  private generation = 0;
  private cleanup?: Record<string, unknown>;
  private reclaiming = false;
  private disconnectDeadline = 0;
  private restoring?: number;
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
  get reconnecting() { return this.joined && this.disconnectDeadline > 0; }
  get audioReady() { return !this.reconnecting && this.activePresence && this.connected && this.audio.canTransmit; }

  constructor(private auth: AngularFireAuth, database: AngularFireDatabase, public audio: RadioAudioService, private zone: NgZone, private profiles: UserInterfaceService, private firestore: AngularFirestore, private injector: EnvironmentInjector) {
    this.root = database.database.ref(ROOM_PATH);
    this.audio.onSignal = async (seat, signal) => {
      if (this.connected && this.activePresence && signal.fromSession === this.session) await this.root.child(`signals/${seat}/${this.seat}`).set(signal);
    };
    this.audio.onError = message => this.zone.run(() => { if (!this.reconnecting) this.error = message; });
    this.audio.onEnded = () => this.zone.run(() => { void this.releaseTalk(); });
    this.audio.onChange = () => this.zone.run(() => this.refreshPresence());
    this.authSubscription = this.auth.authState.subscribe(user => {
      this.stopSession(); this.unlisten(); this.room = {}; this.seat = undefined; this.error = '';
      this.user = user || undefined; this.loading = !!user;
      if (!user) return;
      this.watch(database.database.ref('.info/serverTimeOffset'), value => this.offset = Number(value) || 0);
      this.watch(database.database.ref('.info/connected'), value => {
        this.connectionChanged(value === true);
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
    this.heartbeatTimer = setInterval(() => { this.refreshPresence(true); void this.reclaimStale(); }, 5000);
  }

  async join() {
    if (!this.user || !this.connected) throw new Error('Sign in and connect before joining.');
    const generation = ++this.generation;
    const uid = this.user.uid;
    this.error = '';
    await this.audio.resume();
    await this.reclaimStale();
    const name = await this.resolveName(this.user);
    if (generation !== this.generation || this.destroyed || this.user?.uid !== uid) return;
    const session = crypto.randomUUID(); this.session = session;
    for (let index = 0; index < 10; index++) {
      const seat = String(index);
      if (this.room.seats?.[seat] && this.room.seats[seat].uid !== uid) continue;
      this.seat = seat;
      this.cleanup = this.releasePatch(seat, session);
      const claim: Record<string, unknown> = { [`seats/${seat}`]: { uid, name }, [`presence/${seat}`]: this.presenceData() };
      for (const [slot, speaker] of Object.entries(this.room.speakers || {})) if (speaker.uid === uid) claim[`speakers/${slot}`] = null;
      try {
        // Rules atomically enforce first-come ownership, uniqueness and initial presence.
        await this.root.update(claim);
      } catch (error) {
        if (generation !== this.generation) return;
        this.cleanup = undefined; this.seat = undefined;
        if (this.permissionDenied(error)) continue;
        throw error;
      }
      if (generation !== this.generation || this.destroyed) return;
      this.joined = true;
      this.presenceRef = this.root.child(`presence/${seat}`);
      try {
        await this.armCleanup();
        if (generation !== this.generation || this.destroyed) return;
        this.activePresence = true; this.lastPresence = '';
        this.mailbox?.();
        this.mailbox = this.watch(this.root.child(`signals/${seat}`).limitToFirst(10), value => { this.signals = value || {}; this.sync(); }, false);
        this.sync(); return;
      } catch (error) { if (generation === this.generation) this.stopSession(); throw error; }
    }
    this.session = ''; this.audio.close();
    throw new Error('Room full. All 10 places are taken.');
  }

  async reconnect() { this.stopSession(); await this.join(); }

  async enableTalking() {
    if (!this.joined || !this.activePresence) throw new Error('Join the radio first.');
    const uid = this.user.uid;
    const session = this.session;
    const seat = this.seat;
    let claimed = false;
    try {
      await this.audio.enableMicrophone();
      if (this.destroyed || !this.joined || !this.activePresence || this.session !== session || this.user?.uid !== uid) return;
      if (this.speakingPlace !== undefined) return;
      await this.reclaimStale();
      if (this.destroyed || !this.joined || !this.activePresence || this.session !== session) return;
      for (let index = 0; index < 3; index++) {
        const result = await this.root.child(`speakers/${index}`).transaction(current => this.activePresence && this.session === session && current === null ? { uid, seat } : undefined, undefined, false);
        if (result.committed) {
          // Include the new role in normal-exit cleanup; abrupt loss uses grace recovery.
          const cleanup = this.releasePatch(seat, session, String(index));
          if (session !== this.session || !this.joined) {
            await this.root.update(cleanup).catch(() => {}); return;
          }
          claimed = true; this.cleanup = cleanup;
          await this.armCleanup(); return;
        }
      }
      throw new Error('All 3 speaking places are taken.');
    } catch (error) { if (session === this.session) { if (claimed) this.stopSession(); else this.audio.disableMicrophone(); } throw error; }
  }

  exit() { this.stopSession(); this.changed.next(); }

  async talk() {
    if (this.held || this.releasing) return;
    this.held = true;
    const press = ++this.press;
    this.error = '';
    if (this.speakingPlace === undefined || !this.audioReady) { this.error = 'Audio is not ready.'; return; }
    const token = crypto.randomUUID();
    try {
      const result = await this.root.child('floor').transaction(current => {
        if (press !== this.press || !this.held || !this.audioReady) return;
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
    if ((seat === this.seat && this.reconnecting) || !connection) return 'Reconnecting';
    if (this.floor?.seat === seat) return 'Talking';
    if (!connection.ready) return 'Connecting';
    return 'Listening';
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
  private releasePatch(seat: string, session: string, speakingPlace?: string): Record<string, unknown> {
    const patch: Record<string, unknown> = {
      [`seats/${seat}`]: null,
      // A session-bound tombstone makes the entire atomic cleanup fail for an older tab.
      [`presence/${seat}`]: { session, online: false, at: firebase.database.ServerValue.TIMESTAMP, muted: false, ready: false },
      [`signals/${seat}`]: null
    };
    if (speakingPlace !== undefined) patch[`speakers/${speakingPlace}`] = null;
    for (let index = 0; index < 10; index++) if (String(index) !== seat) patch[`signals/${index}/${seat}`] = null;
    return patch;
  }
  private async armCleanup() {
    const generation = this.generation; const presence = this.presenceRef;
    const offline = this.cleanup?.[`presence/${this.seat}`];
    if (!presence || !offline) return;
    await presence.onDisconnect().cancel();
    // Firebase checks disconnect updates per path; cross-path seat/role cleanup is
    // a normal atomic write. Abrupt loss marks this session offline for recovery.
    if (generation === this.generation) await presence.onDisconnect().set(offline);
  }

  private permissionDenied(error: unknown) { return /permission.denied/i.test((error as { code?: string })?.code || ''); }

  private async reclaimStale() {
    if (!this.user || !this.connected || this.reclaiming || this.destroyed) return;
    this.reclaiming = true;
    try {
      const cutoff = Date.now() + this.offset - RECONNECT_GRACE_MS;
      for (const [seat, person] of Object.entries(this.room.seats || {})) {
        if (person.uid === this.user.uid) continue;
        const presence = this.room.presence?.[seat];
        if (presence && presence.at > cutoff) continue;
        const patch: Record<string, null> = { [`seats/${seat}`]: null };
        for (const [slot, speaker] of Object.entries(this.room.speakers || {})) if (speaker.uid === person.uid) patch[`speakers/${slot}`] = null;
        try { await this.root.update(patch); }
        catch (error) { if (!this.permissionDenied(error)) this.showError(error); }
      }
      for (const [slot, speaker] of Object.entries(this.room.speakers || {})) {
        if (speaker.uid === this.user.uid || this.room.seats?.[speaker.seat]?.uid === speaker.uid) continue;
        await this.root.child(`speakers/${slot}`).transaction(current => current?.uid === speaker.uid && current?.seat === speaker.seat ? null : undefined, undefined, false)
          .catch(error => { if (!this.permissionDenied(error)) this.showError(error); });
      }
    } finally { this.reclaiming = false; }
  }
  private presenceData() {
    return { session: this.session, online: true, at: firebase.database.ServerValue.TIMESTAMP, muted: false, ready: this.audio.ready && this.audio.connectedCount === this.audio.peerCount };
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
  private connectionChanged(connected: boolean) {
    this.connected = connected;
    if (!connected && this.joined && !this.reconnecting) this.pauseSession();
    if (connected && this.reconnecting) void this.restoreSession();
    this.sync();
  }
  private pauseSession() {
    this.disconnectDeadline = Date.now() + this.offset + RECONNECT_GRACE_MS;
    this.activePresence = false;
    void this.releaseTalk();
    this.audio.setFloor(undefined, false);
    // Keep the permitted microphone/context, but remove every network audio path.
    this.audio.reconcile(this.seat, this.session, false, []);
    this.signals = {}; this.error = '';
  }
  private async restoreSession() {
    if (this.restoring === this.generation || !this.reconnecting || !this.connected) return;
    if (Date.now() + this.offset >= this.disconnectDeadline) { this.stopSession(); return; }
    this.restoring = this.generation;
    const generation = this.generation; const oldSession = this.session; const seat = this.seat;
    const session = crypto.randomUUID(); const presence = this.presenceRef;
    let cleanup: Record<string, unknown>;
    try {
      // The server confirms the old session still owns this place. Rotating the
      // audio session prevents an old floor or delayed SDP from becoming live again.
      const result = await presence.transaction(current => {
        if (generation !== this.generation || !this.connected || Date.now() + this.offset >= this.disconnectDeadline) return;
        if (current?.session !== oldSession || current.at <= Date.now() + this.offset - RECONNECT_GRACE_MS) return;
        return { ...this.presenceData(), session, ready: false };
      }, undefined, false);
      if (!result.committed) {
        if (generation === this.generation && this.connected) { this.stopSession(); this.error = 'Radio session ended. Join again.'; }
        return;
      }
      cleanup = this.releasePatch(seat, session, this.speakingPlace);
      if (generation !== this.generation || !this.joined) { await this.root.update(cleanup).catch(() => {}); return; }
      this.session = session; this.cleanup = cleanup; this.lastPresence = '';
      // Register a new disconnect hook for every restored Firebase connection.
      await this.armCleanup();
      if (generation !== this.generation || !this.joined || !this.connected) return;
      if (Date.now() + this.offset >= this.disconnectDeadline) { this.stopSession(); return; }
      this.disconnectDeadline = 0; this.activePresence = true; this.error = '';
      await this.audio.resume();
      this.sync();
    } catch (error) {
      if (generation === this.generation && this.joined && this.connected) { this.stopSession(); this.showError(error); }
    } finally {
      if (this.restoring === generation) this.restoring = undefined;
      if (generation === this.generation && this.reconnecting && this.connected && this.joined) void this.restoreSession();
    }
  }
  private sync() {
    if (this.destroyed) return;
    this.clock = Date.now() + this.offset;
    if (this.reconnecting && this.clock >= this.disconnectDeadline) this.stopSession();
    if (this.joined && this.activePresence && this.seat === undefined) this.stopSession();
    if (this.joined && this.seat !== undefined && this.activePresence) {
      const connection = connectionFor(this.room, this.seat, this.clock);
      if (!connection || connection[0] !== this.session) {
        const replaced = connection && connection[0] !== this.session;
        if (replaced || this.room.seats?.[this.seat]?.uid !== this.user?.uid) this.stopSession();
        else { this.pauseSession(); if (this.connected) void this.restoreSession(); }
        if (replaced) this.error = 'Radio opened in another tab.';
        return;
      }
      const peers = this.seats.flatMap(seat => {
        const connection = connectionFor(this.room, seat.id, this.clock);
        return connection ? [{ seat: seat.id, session: connection[0], speaker: this.isSpeaker(seat.uid) }] : [];
      });
      this.audio.reconcile(this.seat, this.session, this.speakingPlace !== undefined, peers);
      for (const [seat, signal] of Object.entries(this.signals)) this.audio.receive(seat, signal);
    }
    this.audio.setFloor(this.connected && this.joined && !this.reconnecting ? this.floor : undefined, false);
    this.changed.next();
  }
  private watch(query: firebase.database.Query, callback: (value: any) => void, track = true) {
    const handler = query.on('value', snapshot => this.zone.run(() => { if (!this.destroyed) callback(snapshot.val()); }), error => this.zone.run(() => { this.loading = false; this.showError(error); }));
    const unsubscribe = () => query.off('value', handler);
    if (track) this.listeners.push(unsubscribe);
    return unsubscribe;
  }
  private unlisten() { this.listeners.splice(0).forEach(unsubscribe => unsubscribe()); this.connected = false; }
  private stopSession() {
    ++this.generation; this.disconnectDeadline = 0;
    const cleanup = this.cleanup; this.cleanup = undefined;
    if (cleanup) void this.root.update(cleanup).catch(() => { /* Server disconnect or stale-place recovery is the fallback. */ });
    void this.releaseTalk(); this.joined = false; this.activePresence = false;
    this.mailbox?.(); this.mailbox = undefined; this.signals = {};
    this.presenceRef = undefined;
    this.audio.close(); this.session = '';
  }
}
