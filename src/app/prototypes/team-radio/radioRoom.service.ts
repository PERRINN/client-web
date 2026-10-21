import { EnvironmentInjector, Injectable, NgZone, OnDestroy, runInInjectionContext } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { UserInterfaceService } from '../../userInterface.service';
import { AngularFireDatabase } from '@angular/fire/compat/database';
import firebase from 'firebase/compat/app';
import 'firebase/compat/database';
import { firstValueFrom, Subject, Subscription } from 'rxjs';
import { RadioAudioService, RadioSignal } from './radioAudio.service';
import { isRadioPermissionDenied, RadioDiagnosticDetails } from './radioDiagnostics';
import { activeFloor, connectionFor, RadioFloor, RadioRoom, RECONNECT_GRACE_MS, ROOM_PATH, seatFor, speakerFor } from './radioState';

export interface RadioReturnSession { uid: string; seat: string; session: string; until: number }

@Injectable()
export class RadioRoomService implements OnDestroy {
  readonly changed = new Subject<void>();
  room: RadioRoom = {};
  user?: firebase.User;
  loading = true;
  authResolved = false;
  private rosterLoaded = new Set<string>();
  private pageActive = true;
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
  get returnUntil() { return this.reconnecting ? this.disconnectDeadline - this.offset : Date.now() + RECONNECT_GRACE_MS; }
  get audioReady() { return this.pageActive && !this.reconnecting && this.activePresence && this.connected && this.audio.canTransmit; }
  get reservedElsewhere() {
    if (this.joined || !this.user) return false;
    const seat = seatFor(this.room, this.user.uid);
    if (seat === undefined) return false;
    const presence = this.room.presence?.[seat];
    // Respect another device's live session and its existing recovery grace.
    return !presence || presence.at > Date.now() + this.offset - RECONNECT_GRACE_MS;
  }

  constructor(private auth: AngularFireAuth, database: AngularFireDatabase, public audio: RadioAudioService, private zone: NgZone, private profiles: UserInterfaceService, private firestore: AngularFirestore, private injector: EnvironmentInjector) {
    this.root = database.database.ref(ROOM_PATH);
    this.audio.onSignal = async (seat, signal) => {
      if (this.connected && this.activePresence && signal.fromSession === this.session) await this.root.child(`signals/${seat}/${this.seat}`).set(signal);
    };
    this.audio.onError = message => this.zone.run(() => { if (!this.reconnecting) this.error = message; this.changed.next(); });
    this.audio.onEnded = () => this.zone.run(() => { void this.releaseTalk(); });
    this.audio.onChange = () => this.zone.run(() => { this.refreshPresence(); this.changed.next(); });
    this.authSubscription = this.auth.authState.subscribe(user => {
      this.audio.diagnostics?.record('auth-state', { reason: user ? 'signed-in' : 'signed-out' });
      this.stopSession(); this.unlisten(); this.room = {}; this.seat = undefined; this.error = '';
      this.user = user || undefined; this.loading = !!user; this.authResolved = true; this.rosterLoaded.clear();
      if (!user) return;
      this.watch(database.database.ref('.info/serverTimeOffset'), value => this.offset = Number(value) || 0);
      this.watch(database.database.ref('.info/connected'), value => {
        this.connectionChanged(value === true);
      });
      for (const [name, limit] of [['seats', 10], ['speakers', 3], ['presence', 10]] as const) {
        this.watch(this.root.child(name).limitToFirst(limit), value => {
          if (name !== 'presence') this.audio.diagnostics?.record('roster', { kind: name, reason: Object.keys(value || {}).sort().join(',') });
          this.room = { ...this.room, [name]: value || {} };
          if (name === 'seats') this.seat = seatFor(this.room, user.uid);
          this.rosterLoaded.add(name); this.loading = this.rosterLoaded.size < 3;
          this.sync();
        });
      }
      this.watch(this.root.child('floor'), value => { this.room = { ...this.room, floor: value || undefined }; this.sync(); });
    });
    this.tickTimer = setInterval(() => this.zone.run(() => { this.clock = Date.now() + this.offset; this.sync(); }), 250);
    this.heartbeatTimer = setInterval(() => { this.refreshPresence(true); void this.reclaimStale(); }, 5000);
  }

  async join(takeOver = false) {
    if (!this.user || !this.connected) throw new Error('Sign in and connect before joining.');
    if (!takeOver && this.reservedElsewhere) return;
    const generation = ++this.generation;
    const uid = this.user.uid;
    this.error = '';
    // Autoplay may wait for a gesture indefinitely. It must not block claiming
    // a listener place; the page exposes Enable sound when playback is blocked.
    void this.audio.resume().catch(() => this.changed.next());
    await this.reclaimStale();
    const name = await this.resolveName(this.user);
    if (generation !== this.generation || this.destroyed || this.user?.uid !== uid) return;
    if (!takeOver && this.reservedElsewhere) return;
    const session = crypto.randomUUID(); this.session = session;
    for (let index = 0; index < 10; index++) {
      if (!takeOver && this.reservedElsewhere) { this.cleanup = undefined; this.session = ''; return; }
      const seat = String(index);
      if (this.room.seats?.[seat] && this.room.seats[seat].uid !== uid) continue;
      this.seat = seat;
      this.cleanup = this.releasePatch(seat, session);
      const cleanup = this.cleanup;
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
      if (generation !== this.generation || this.destroyed) { await this.root.update(cleanup).catch(() => {}); return; }
      this.joined = true;
      this.audio.diagnostics?.record('session-joined', { seat, session });
      this.presenceRef = this.root.child(`presence/${seat}`);
      try {
        await this.armCleanup();
        if (generation !== this.generation || this.destroyed) return;
        this.activePresence = true; this.lastPresence = '';
        this.listenSignals(seat);
        this.sync(); return;
      } catch (error) { if (generation === this.generation) this.stopSession(); throw error; }
    }
    this.session = ''; this.audio.close();
    throw new Error('Room full. All 10 places are taken.');
  }

  setPageActive(active: boolean) {
    if (active === this.pageActive) return;
    this.pageActive = active;
    if (!active) void this.releaseTalk();
  }

  suspendPage() {
    if (this.joined && !this.reconnecting) this.pauseSession();
    this.changed.next();
  }

  resumePage() { if (this.joined && this.reconnecting && this.connected) void this.restoreSession(); }

  async recover(saved: RadioReturnSession) {
    if (this.joined || !this.connected || this.loading || this.user?.uid !== saved.uid || saved.until <= Date.now()) return;
    if (seatFor(this.room, saved.uid) !== saved.seat || this.room.presence?.[saved.seat]?.session !== saved.session) return;
    ++this.generation;
    this.seat = saved.seat; this.session = saved.session; this.joined = true;
    this.cleanup = this.releasePatch(saved.seat, saved.session, this.speakingPlace);
    this.presenceRef = this.root.child(`presence/${saved.seat}`);
    this.disconnectDeadline = saved.until + this.offset; this.activePresence = false;
    this.listenSignals(saved.seat);
    await this.restoreSession();
  }

  private listenSignals(seat: string) {
    this.mailbox?.();
    this.mailbox = this.watch(this.root.child(`signals/${seat}`).limitToFirst(10), value => { this.signals = value || {}; this.sync(); }, false);
  }

  async reconnect() { this.stopSession(); await this.join(true); }

  async enableTalking() {
    this.recordTalk('enable-talking-start');
    if (!this.joined || !this.activePresence) throw new Error('Join the radio first.');
    const uid = this.user.uid;
    const session = this.session;
    const seat = this.seat;
    let claimed = false;
    let phase = 'microphone';
    const started = performance.now();
    try {
      await this.audio.enableMicrophone();
      this.recordTalk('enable-talking-microphone-ready', undefined, { session });
      if (this.destroyed || !this.joined || !this.activePresence || this.session !== session || this.user?.uid !== uid) return;
      if (this.speakingPlace !== undefined) return;
      phase = 'stale-cleanup';
      await this.reclaimStale();
      if (this.destroyed || !this.joined || !this.activePresence || this.session !== session) return;
      for (let index = 0; index < 3; index++) {
        phase = 'speaker-claim';
        this.recordTalk('speaker-claim-start', undefined, { session, attempt: index + 1 });
        const result = await this.root.child(`speakers/${index}`).transaction(current => this.activePresence && this.session === session && current === null ? { uid, seat } : undefined, undefined, false);
        this.recordTalk(result.committed ? 'speaker-claim-committed' : 'speaker-claim-skipped', undefined, { session, attempt: index + 1 });
        if (result.committed) {
          // Include the new role in normal-exit cleanup; abrupt loss uses grace recovery.
          const cleanup = this.releasePatch(seat, session, String(index));
          if (session !== this.session || !this.joined) {
            phase = 'late-cleanup';
            await this.root.update(cleanup).catch(() => {}); return;
          }
          claimed = true; this.cleanup = cleanup;
          phase = 'disconnect-hook';
          await this.armCleanup(); return;
        }
      }
      phase = 'speaker-capacity';
      throw new Error('All 3 speaking places are taken.');
    } catch (error) {
      const name = (error as Error)?.name;
      this.recordTalk('enable-talking-rejected', undefined, { session, kind: phase,
        reason: this.permissionDenied(error) ? 'permission-denied' : name === 'NotAllowedError' ? 'microphone-permission-denied' : name === 'NotFoundError' ? 'no-microphone' : 'other',
        elapsedMs: Math.round(performance.now() - started) });
      if (session === this.session) { if (claimed) this.stopSession(); else this.audio.disableMicrophone(); }
      throw error;
    }
  }

  captureDiagnostics() {
    this.recordTalk('diagnostics-capture', undefined, {
      kind: !this.joined ? 'not-joined' : this.speakingPlace === undefined ? 'joined-listener' : 'joined-speaker',
      connection: this.connected ? 'connected' : 'disconnected',
      microphoneReady: this.audio.canTransmit, errorPresent: !!this.error
    });
    return this.audio.diagnostics.snapshot();
  }

  exit() { this.stopSession(); this.changed.next(); }

  async talk() {
    if (!this.pageActive || this.held || this.releasing) return;
    this.held = true;
    const press = ++this.press;
    this.error = '';
    if (this.speakingPlace === undefined || !this.audioReady) { this.error = 'Audio is not ready.'; return; }
    const token = crypto.randomUUID();
    const started = performance.now();
    const session = this.session;
    let attempt = 0;
    let candidate: RadioFloor | undefined;
    let phase = 'acquire';
    this.recordTalk('talk-acquire-start');
    try {
      const result = await this.root.child('floor').transaction(current => {
        if (press !== this.press || !this.held || !this.audioReady) return;
        const room = { ...this.room, floor: current };
        if (activeFloor(room, Date.now() + this.offset)) return;
        const now = Date.now() + this.offset;
        candidate = { uid: this.user.uid, seat: this.seat, session: this.session, token, startedAt: now, expiresAt: now + 30000 };
        this.recordTalk('talk-acquire-attempt', current, { attempt: ++attempt,
          requestedStartAt: candidate.startedAt, requestedExpiresAt: candidate.expiresAt });
        return candidate;
      }, undefined, false);
      if (!result.committed) {
        this.recordTalk('talk-acquire-aborted', undefined, { attempt, elapsedMs: Math.round(performance.now() - started) });
        if (press === this.press && this.held && session === this.session) this.error = 'Channel busy';
        return;
      }
      this.recordTalk('talk-acquire-committed', result.snapshot.val(), { attempt, elapsedMs: Math.round(performance.now() - started) });
      phase = 'late-release';
      if (press !== this.press || !this.held || !this.audioReady) { await this.clearFloor(token); return; }
      const floor = result.snapshot.val();
      this.speakingToken = token;
      phase = 'transmit';
      this.audio.transmit(floor, floor.expiresAt - Date.now() - this.offset);
      this.changed.next();
    } catch (error) {
      this.recordTalk(`talk-${phase}-rejected`, undefined, { session, attempt, elapsedMs: Math.round(performance.now() - started),
        requestedStartAt: candidate?.startedAt, requestedExpiresAt: candidate?.expiresAt,
        reason: this.permissionDenied(error) ? 'permission-denied' : 'other' });
      await this.clearFloor(token).catch(() => {});
      if (session !== this.session || this.destroyed) return;
      if (this.permissionDenied(error)) this.error = phase === 'acquire'
        ? 'Talk was rejected. Reconnect and enable talking again.' : 'Couldn’t release Talk. Try Reconnect.';
      else this.showError(error);
      this.changed.next();
    }
  }

  async releaseTalk() {
    this.held = false; ++this.press;
    this.audio.stop();
    const token = this.speakingToken;
    const uid = this.user?.uid;
    const session = this.session;
    this.speakingToken = undefined;
    this.changed.next();
    if (!token || this.releasing) return;
    this.releasing = true;
    try {
      // Let the buffered final syllable drain before receivers close their audio gates.
      await new Promise(resolve => setTimeout(resolve, 200));
      if (this.connected && this.user?.uid === uid && this.session === session) await this.clearFloor(token);
    } catch (error) {
      if (session === this.session && !this.destroyed) {
        if (this.permissionDenied(error)) this.error = 'Couldn’t release Talk. Try Reconnect.';
        else this.showError(error);
        this.changed.next();
      }
    }
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
    if (this.permissionDenied(error)) this.error = 'Radio request denied. Try Reconnect.';
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
    const started = performance.now();
    let attempt = 0;
    this.recordTalk('talk-release-start');
    try {
      const result = await this.root.child('floor').transaction(current => {
        if (current?.token !== token) return;
        this.recordTalk('talk-release-attempt', current, { attempt: ++attempt });
        return null;
      }, undefined, false);
      this.recordTalk(result.committed ? 'talk-release-committed' : 'talk-release-skipped', undefined,
        { attempt, elapsedMs: Math.round(performance.now() - started) });
    } catch (error) {
      this.recordTalk('talk-release-rejected', undefined, { attempt, elapsedMs: Math.round(performance.now() - started),
        reason: this.permissionDenied(error) ? 'permission-denied' : 'other' });
      throw error;
    }
  }
  private recordTalk(event: string, floor: RadioFloor = this.room.floor, details: RadioDiagnosticDetails = {}) {
    const now = Date.now() + this.offset;
    const session = details.session || this.session;
    const presence = this.room.presence?.[this.seat];
    const owner = floor && this.room.presence?.[floor.seat];
    this.audio.diagnostics?.record(event, {
      seat: this.seat, session, observedServerNow: now, serverOffsetMs: this.offset,
      presenceAgeMs: presence ? now - presence.at : undefined,
      seatOwned: !!this.user && this.room.seats?.[this.seat]?.uid === this.user.uid,
      speakerReserved: this.speakingPlace !== undefined,
      sessionMatches: presence?.session === session, presenceOnline: presence?.online === true,
      floorAvailable: !floor || floor.expiresAt <= now || owner?.session !== floor.session || !owner?.online || owner.at <= now - 20000,
      floorOwned: !!floor && floor.uid === this.user?.uid,
      floorSessionMatches: !!floor && owner?.session === floor.session,
      ...details
    });
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

  private permissionDenied(error: unknown) { return isRadioPermissionDenied(error); }

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
      .catch(error => this.zone.run(() => {
        this.audio.diagnostics?.record('presence-refresh-rejected', { seat: this.seat, session: data.session,
          reason: this.permissionDenied(error) ? 'permission-denied' : 'other' });
        if (data.session === this.session && !this.destroyed) { this.showError(error); this.changed.next(); }
      }));
  }
  private connectionChanged(connected: boolean) {
    this.audio.diagnostics?.record('database-connection', { connection: connected ? 'connected' : 'disconnected', seat: this.seat, session: this.session });
    this.connected = connected;
    if (!connected && this.joined && !this.reconnecting) this.pauseSession();
    if (connected && this.reconnecting) void this.restoreSession();
    this.sync();
  }
  private pauseSession() {
    this.audio.diagnostics?.record('session-paused', { seat: this.seat, session: this.session });
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
    this.audio.diagnostics?.record('session-restore-start', { seat: this.seat, session: this.session });
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
        if (generation === this.generation && this.connected) { this.stopSession(); this.error = 'Radio session ended.'; }
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
      this.audio.diagnostics?.record('session-restored', { seat, session });
      this.changed.next();
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
        // Set this before teardown emits changes: lifecycle admission must not
        // race the replacement and immediately take the other device's place.
        if (replaced) this.error = 'Radio moved to another device.';
        if (replaced || this.room.seats?.[this.seat]?.uid !== this.user?.uid) this.stopSession();
        else { this.pauseSession(); if (this.connected) void this.restoreSession(); }
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
    const handler = query.on('value', snapshot => this.zone.run(() => { if (!this.destroyed) callback(snapshot.val()); }), error => this.zone.run(() => {
      this.audio.diagnostics?.record('database-listener-error', { reason: this.permissionDenied(error) ? 'permission-denied' : 'other' });
      this.loading = false; this.showError(error);
    }));
    const unsubscribe = () => query.off('value', handler);
    if (track) this.listeners.push(unsubscribe);
    return unsubscribe;
  }
  private unlisten() { this.listeners.splice(0).forEach(unsubscribe => unsubscribe()); this.connected = false; }
  private stopSession() {
    if (this.joined) this.audio.diagnostics?.record('session-stopped', { seat: this.seat, session: this.session });
    ++this.generation; this.disconnectDeadline = 0;
    const cleanup = this.cleanup; this.cleanup = undefined;
    if (cleanup) void this.root.update(cleanup).catch(() => { /* Server disconnect or stale-place recovery is the fallback. */ });
    this.joined = false; this.activePresence = false; void this.releaseTalk();
    this.mailbox?.(); this.mailbox = undefined; this.signals = {};
    this.presenceRef = undefined;
    this.audio.close(); this.session = '';
  }
}
