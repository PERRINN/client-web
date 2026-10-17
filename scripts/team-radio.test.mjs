import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { firstValueFrom, of, Subject } from 'rxjs';

function load(path, imports = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true }
  }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, name => {
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  });
  return exports;
}
const core = { Injectable: () => target => target, runInInjectionContext: (_, fn) => fn() };
const state = load('../src/app/prototypes/team-radio/radioState.ts');
const { RadioAudioService } = load('../src/app/prototypes/team-radio/radioAudio.service.ts', { '@angular/core': core });
const { RadioRoomService } = load('../src/app/prototypes/team-radio/radioRoom.service.ts', {
  '@angular/core': core,
  rxjs: { firstValueFrom, Subject },
  'firebase/compat/app': { default: { database: { ServerValue: { TIMESTAMP: { '.sv': 'timestamp' } } } } },
  'firebase/compat/database': {}, './radioState': state
});
const now = Date.now();
function room() {
  return {
    seats: { 0: { uid: 'a', name: 'Alex' }, 1: { uid: 'b', name: 'Blair' } },
    speakers: { 0: { uid: 'a', seat: '0' }, 1: { uid: 'b', seat: '1' } },
    presence: { 0: { session: 'aSession', online: true, at: now, ready: true, muted: false }, 1: { session: 'bSession', online: true, at: now, ready: true, muted: false } },
    floor: { uid: 'a', seat: '0', session: 'aSession', token: 'one', startedAt: now, expiresAt: now + 30000 }
  };
}
test('cached offline places never authorize audio while awaiting cleanup', () => {
  const data = room();
  assert.equal(state.activeFloor(data, now)?.token, 'one');
  assert.equal(state.activeFloor(data, now + 30001), undefined);
  data.presence = {};
  assert.equal(state.activeFloor(data, now), undefined);
  assert.equal(state.seatFor(data, 'a'), '0');
  assert.equal(state.speakerFor(data, 'a'), '0');
  data.presence = { 0: { session: 'replacementSession', online: true, at: now } };
  assert.equal(state.activeFloor(data, now), undefined);
});
test('stale heartbeat, removed role, wrong account and oversized lease cannot authorize reception', () => {
  const variants = [
    data => data.presence[0].at = now - 20001,
    data => data.speakers = {},
    data => data.seats[0].uid = 'someoneElse',
    data => data.floor.expiresAt = now + 60000
  ];
  for (const mutate of variants) { const data = room(); mutate(data); assert.equal(state.activeFloor(data, now), undefined); }
});
test('Space ignores repeats, modifier shortcuts and text/control interaction', () => {
  const key = { code: 'Space', repeat: false, target: { closest: () => null } };
  assert.equal(state.acceptsTalkKey(key), true);
  for (const update of [{ repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { code: 'KeyR' }, { target: { closest: () => ({}) } }]) {
    assert.equal(state.acceptsTalkKey({ ...key, ...update }), false);
  }
});
function service(data = room()) {
  const authState = new Subject();
  let storedFloor = data.floor;
  let delayed;
  let transmitted = 0;
  const writes = []; const disconnects = [];
  const ref = {
    child: () => ref, limitToFirst: () => ref,
    on: () => () => {}, off() {}, remove: async () => {},
    update: async patch => { writes.push(patch); },
    onDisconnect: () => ({ cancel: async () => {}, set: async value => { disconnects.push(value); } }),
    transaction: async update => {
      if (delayed) await delayed;
      const next = update(storedFloor);
      if (next === undefined) return { committed: false, snapshot: { val: () => storedFloor } };
      storedFloor = next;
      return { committed: true, snapshot: { val: () => next } };
    }
  };
  const audio = { onSignal() {}, onChange() {}, onError() {}, onEnded() {}, canTransmit: true,
    stop() {}, close() {}, reconcile() {}, setFloor() {}, transmit() { transmitted++; } };
  const radio = new RadioRoomService({ authState }, { database: { ref: () => ref } }, audio, { run: fn => fn() });
  radio.room = data; radio.user = { uid: 'b' }; radio.seat = '1'; radio.session = 'bSession';
  radio.connected = true; radio.joined = true; radio.activePresence = true; radio.clock = now;
  return { radio, authState, writes, disconnects, ref, get storedFloor() { return storedFloor; }, get transmitted() { return transmitted; },
    setFloor(value) { storedFloor = value; radio.room.floor = value; }, delay(value) { delayed = value; } };
}
test('a busy press cannot turn into a queued transmission; release and fresh press are required', async () => {
  const fixture = service();
  try {
    await fixture.radio.talk();
    assert.equal(fixture.radio.error, 'Channel busy');
    fixture.setFloor(null);
    await fixture.radio.talk();
    assert.equal(fixture.transmitted, 0);
    await fixture.radio.releaseTalk();
    await fixture.radio.talk();
    assert.equal(fixture.transmitted, 1);
    assert.equal(fixture.storedFloor.uid, 'b');
    await fixture.radio.releaseTalk();
    assert.equal(fixture.storedFloor, null);
  } finally { fixture.radio.ngOnDestroy(); }
});
test('releasing while acquisition is pending never beeps or transmits, and clears the late claim', async () => {
  const fixture = service(); fixture.setFloor(null);
  let release;
  fixture.delay(new Promise(resolve => release = resolve));
  try {
    const pending = fixture.radio.talk();
    await fixture.radio.releaseTalk();
    release(); await pending;
    assert.equal(fixture.transmitted, 0);
    assert.equal(fixture.storedFloor, null);
  } finally { fixture.radio.ngOnDestroy(); }
});
test('cleanup of an old transmission cannot erase a newer token', async () => {
  const fixture = service();
  try { await fixture.radio.clearFloor('old-token'); assert.equal(fixture.storedFloor.token, 'one'); }
  finally { fixture.radio.ngOnDestroy(); }
});

function fakeContext() {
  const gains = [];
  const nodes = [];
  const node = () => { const n = { connect() { return this; }, disconnect() { this.disconnected = true; } }; nodes.push(n); return n; };
  const context = {
    state: 'running', currentTime: 5, destination: {},
    createGain() { const n = node(); n.gain = { value: 0, values: [], setValueAtTime(value, time) { this.values.push([value, time]); }, cancelScheduledValues() {} }; gains.push(n); return n; },
    createOscillator() { const n = node(); n.frequency = {}; n.start = time => n.started = time; n.stop = time => n.stopped = time; return n; },
    createDelay() { const n = node(); n.delayTime = {}; return n; },
    createMediaStreamSource() { return node(); },
    createMediaStreamDestination() { return { stream: { getAudioTracks: () => [{ kind: 'audio' }] } }; },
    close() { this.state = 'closed'; return Promise.resolve(); }, resume: async () => {}
  };
  return { context, gains, nodes };
}
test('successful transmission emits a short beep, caps audio at 30 seconds and buffers opening speech', async () => {
  const audio = new RadioAudioService();
  const fake = fakeContext(); audio.context = fake.context; audio.output = fake.context.createMediaStreamDestination();
  audio.mic = { getAudioTracks: () => [{ readyState: 'live' }], getTracks: () => [] };
  audio.micGate = fake.context.createGain();
  const originalTimer = globalThis.setTimeout; let timer;
  globalThis.setTimeout = (callback, duration) => { timer = { callback, duration }; return 0; };
  let ended = 0; audio.onEnded = () => ended++;
  try {
    audio.transmit(room().floor, 30000);
    assert.equal(timer.duration, 29780);
    assert.equal(fake.nodes.find(node => node.frequency)?.frequency.value, 880);
    assert.deepEqual(audio.micGate.gain.values.at(-1), [1, 5]);
    timer.callback();
    assert.equal(ended, 1);
    assert.deepEqual(audio.micGate.gain.values.at(-1), [0, 5]);
    assert.equal(audio.activeToken, undefined);
  } finally { globalThis.setTimeout = originalTimer; audio.close(); }
});
test('a microphone permission request completing after page cleanup stops its tracks', async () => {
  const audio = new RadioAudioService(); const fake = fakeContext();
  audio.context = fake.context; audio.output = fake.context.createMediaStreamDestination();
  let resolve; let stopped = 0;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(done => resolve = done) } } });
  try {
    const pending = audio.enableMicrophone(); await Promise.resolve(); await Promise.resolve();
    audio.close(); resolve({ getTracks: () => [{ stop() { stopped++; } }] });
    await assert.rejects(pending, /cancelled/); assert.equal(stopped, 1);
  } finally { if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else delete globalThis.navigator; }
});

test('receivers unmute only the current authorized session and honor local playback mute', () => {
  const audio = new RadioAudioService();
  const permitted = { audio: { muted: true }, session: 'aSession' };
  const stale = { audio: { muted: true }, session: 'oldSession' };
  audio.peers.set('0', permitted); audio.peers.set('1', stale);
  audio.setFloor(room().floor, false);
  assert.equal(permitted.audio.muted, false); assert.equal(stale.audio.muted, true);
  audio.setFloor(room().floor, true); assert.equal(permitted.audio.muted, true);
  audio.setFloor(undefined, false); assert.equal(permitted.audio.muted, true);
  audio.setFloor({ ...room().floor, session: 'replaced' }, false); assert.equal(permitted.audio.muted, true);
});
test('autoplay rejection is surfaced through audio readiness and can recover on Enable sound', async () => {
  const audio = new RadioAudioService(); audio.context = fakeContext().context;
  let allowed = false;
  const peer = { audio: { play: async () => { if (!allowed) throw new Error('Blocked'); } } };
  audio.peers.set('0', peer);
  await audio.play(peer); assert.equal(audio.ready, false);
  allowed = true; await audio.play(peer); assert.equal(audio.ready, true);
});


test('names reuse only a profile belonging to the real account; fallback lookup is bounded', async () => {
  const fixture = service(); const radio = fixture.radio; const calls = [];
  radio.profiles = { currentUserLastMessageObj: { user: 'b', name: 'Blair Team' } };
  try {
    assert.equal(await radio.resolveName({ uid: 'b' }), 'Blair Team');
    radio.profiles.currentUserLastMessageObj = { user: 'other', name: 'Wrong account' };
    const query = { where(...args) { calls.push(args); return this; }, orderBy() { return this; }, limit(value) { calls.push(['limit', value]); return this; } };
    radio.firestore = { collection(name, build) { assert.equal(name, 'PERRINNMessages'); build(query); return { get: () => of({ docs: [{ data: () => ({ name: 'Correct profile' }) }] }) }; } };
    assert.equal(await radio.resolveName({ uid: 'b' }), 'Correct profile');
    assert.deepEqual(calls, [['user', '==', 'b'], ['verified', '==', true], ['limit', 1]]);
  } finally { radio.ngOnDestroy(); }
});
test('sign-out clears prior identities, reservations in the view and active audio', () => {
  const fixture = service(); let closed = 0; fixture.radio.audio.close = () => closed++;
  try {
    fixture.authState.next(null);
    assert.equal(fixture.radio.user, undefined); assert.equal(fixture.radio.seat, undefined);
    assert.deepEqual(fixture.radio.room, {}); assert.equal(fixture.radio.joined, false); assert.equal(closed, 1);
  } finally { fixture.radio.ngOnDestroy(); }
});

test('answering peers negotiate sending as well as receiving before a listener becomes a speaker', async () => {
  const audio = new RadioAudioService(); audio.localSeat = '1'; audio.localSession = 'local';
  const fake = fakeContext(); audio.context = fake.context; audio.output = fake.context.createMediaStreamDestination();
  let track; let published = false;
  const transceiver = { direction: 'recvonly', sender: { replaceTrack: async value => track = value } };
  const peer = { session: 'remote', offerId: '', queue: Promise.resolve(), pc: {
    setRemoteDescription: async () => {}, getTransceivers: () => [transceiver],
    setLocalDescription: async () => {}, createAnswer: async () => ({ type: 'answer' })
  } };
  audio.peers.set('0', peer); audio.publish = async () => published = true;
  audio.receive('0', { fromSession: 'remote', toSession: 'local', offerId: 'offer', type: 'offer', sdp: 'sdp' });
  await peer.queue;
  assert.equal(transceiver.direction, 'sendrecv'); assert.equal(track.kind, 'audio'); assert.equal(published, true);
});

test('radio avatars reuse the real current profile, bound other lookups and release subscriptions', () => {
  const photos = load('../src/app/userAvatar.ts');
  const { RadioAvatarsService } = load('../src/app/prototypes/team-radio/radioAvatars.service.ts', {
    '@angular/core': core, '../../userAvatar': photos
  });
  const subjects = new Map(); const queries = [];
  const firestore = { collection(name, build) {
    let uid;
    const query = { where(field, op, value) { if (field === 'user') uid = value; return this; }, orderBy() { return this; }, limit(value) { assert.equal(value, 1); return this; } };
    build(query); queries.push(uid); assert.equal(name, 'PERRINNMessages');
    const subject = new Subject(); subjects.set(uid, subject); return { valueChanges: () => subject };
  } };
  const profiles = { currentUserLastMessageObj: { user: 'a', imageUrlThumbUser: 'own-photo' } };
  const avatars = new RadioAvatarsService(firestore, profiles, {});
  avatars.sync(['a', 'b'], 'a');
  assert.deepEqual(queries, ['b']); assert.deepEqual(avatars.sources('a'), ['own-photo']);
  subjects.get('b').next([{ imageUrlThumbUser: '1709995468152-placeholder', imageUrlMedium: 'medium', imageUrlOriginal: 'original' }]);
  assert.deepEqual(avatars.sources('b'), ['medium', 'original']);
  const stable = avatars.sources('b'); avatars.sync(['a', 'b'], 'a');
  assert.equal(avatars.sources('b'), stable); assert.deepEqual(queries, ['b']);
  avatars.sync(['a'], 'a'); assert.equal(subjects.get('b').observers.length, 0); assert.deepEqual(avatars.sources('b'), []);
  profiles.currentUserLastMessageObj = { user: 'other', imageUrlThumbUser: 'wrong-photo' };
  avatars.sync(['a'], 'a'); assert.deepEqual(queries, ['b', 'a']);
  avatars.ngOnDestroy(); assert.equal(subjects.get('a').observers.length, 0);
});

test('exit stops media immediately and releases listener, speaker and signaling with a session guard', async () => {
  const fixture = service(); const { radio } = fixture; let closed = 0;
  radio.audio.close = () => closed++;
  radio.cleanup = radio.releasePatch('1', 'bSession', '1');
  try {
    radio.exit();
    assert.equal(radio.joined, false); assert.equal(radio.session, ''); assert.equal(closed, 1);
    const patch = fixture.writes[0];
    assert.equal(patch['seats/1'], null); assert.equal(patch['speakers/1'], null);
    assert.equal(patch['presence/1'].session, 'bSession'); assert.equal(patch['presence/1'].online, false);
    assert.equal(patch['signals/1'], null); assert.equal(patch['signals/9/1'], null);
    assert.equal('floor' in patch, false, 'disconnect must not clear another sender floor');
    radio.exit(); assert.equal(fixture.writes.length, 1);
  } finally { radio.ngOnDestroy(); }
});
test('disconnect fallback registers only the session tombstone, not unsafe partial place deletes', async () => {
  const fixture = service(); const { radio } = fixture;
  radio.presenceRef = fixture.ref; radio.cleanup = radio.releasePatch('1', 'bSession', '1');
  try {
    await radio.armCleanup();
    assert.equal(fixture.disconnects.length, 1);
    assert.equal(fixture.disconnects[0].session, 'bSession'); assert.equal(fixture.disconnects[0].online, false);
  } finally { radio.ngOnDestroy(); }
});
test('stale recovery skips own cached places and attempts only stale remote places', async () => {
  const fixture = service(); const { radio } = fixture;
  radio.room.presence[0].at = Date.now() - 180001;
  radio.room.presence[1].at = Date.now() - 180001;
  try {
    await radio.reclaimStale();
    assert.equal(fixture.writes.length, 1);
    assert.deepEqual(fixture.writes[0], { 'seats/0': null, 'speakers/0': null });
  } finally { radio.ngOnDestroy(); }
});

test('an old enable-talking request cannot disable the microphone of a newer session', async () => {
  const fixture = service(); const { radio } = fixture; let finish; let disabled = 0;
  radio.audio.enableMicrophone = () => new Promise(resolve => { finish = resolve; });
  radio.audio.disableMicrophone = () => { disabled++; };
  try {
    const pending = radio.enableTalking();
    radio.exit(); radio.session = 'new-session'; radio.joined = true;
    finish(); await pending;
    assert.equal(disabled, 0);
  } finally { radio.ngOnDestroy(); }
});

test('network loss preserves both places without queuing deletion, stops transmission and resets held input', async () => {
  const fixture = service(); const { radio } = fixture; const paths = [];
  radio.cleanup = radio.releasePatch('1', 'bSession', '1'); radio.held = true;
  radio.audio.reconcile = (...args) => paths.push(args);
  try {
    radio.connectionChanged(false);
    assert.equal(radio.joined, true); assert.equal(radio.reconnecting, true);
    assert.equal(radio.session, 'bSession'); assert.equal(radio.speakingPlace, '1');
    assert.equal(radio.audioReady, false); assert.equal(radio.held, false);
    assert.equal(fixture.writes.length, 0);
    assert.deepEqual(paths[0], ['1', 'bSession', false, []]);
    assert.equal(radio.status('1'), 'Reconnecting');
    const deadline = radio.disconnectDeadline;
    radio.connectionChanged(false);
    assert.equal(radio.disconnectDeadline, deadline, 'repeated disconnect callbacks never extend grace');
  } finally { radio.ngOnDestroy(); }
});
test('automatic recovery retains speaking permission, rotates session and never resumes a held transmission', async () => {
  const fixture = service(); const { radio } = fixture;
  radio.audio.resume = async () => {};
  let current = radio.room.presence[1];
  radio.presenceRef = {
    transaction: async update => { const next = update(current); if (!next) return { committed: false }; current = next; radio.room.presence[1] = { ...next, at: Date.now() }; return { committed: true }; },
    onDisconnect: fixture.ref.onDisconnect
  };
  try {
    radio.held = true; radio.connectionChanged(false); radio.connected = true;
    await radio.restoreSession();
    assert.equal(radio.joined, true); assert.equal(radio.reconnecting, false); assert.equal(radio.activePresence, true);
    assert.notEqual(radio.session, 'bSession'); assert.equal(radio.speakingPlace, '1');
    assert.equal(fixture.disconnects[0].session, radio.session);
    assert.equal(radio.held, false); assert.equal(fixture.transmitted, 0);
    assert.equal(fixture.writes.length, 0, 'no place deletion during successful recovery');
  } finally { radio.ngOnDestroy(); }
});
test('three-minute expiry ends the session and prepares normal guarded cleanup', () => {
  const fixture = service(); const { radio } = fixture;
  radio.cleanup = radio.releasePatch('1', 'bSession', '1');
  try {
    radio.connectionChanged(false);
    assert.ok(radio.disconnectDeadline >= Date.now() + 179000);
    radio.disconnectDeadline = Date.now() - 1;
    radio.sync();
    assert.equal(radio.joined, false); assert.equal(radio.reconnecting, false);
    assert.equal(fixture.writes[0]['seats/1'], null); assert.equal(fixture.writes[0]['speakers/1'], null);
  } finally { radio.ngOnDestroy(); }
});
test('a reclaimed or superseded session cannot automatically rejoin or steal a speaking place', async () => {
  const fixture = service(); const { radio } = fixture;
  radio.presenceRef = { transaction: async update => ({ committed: update({ session: 'new-tab', at: Date.now() }) !== undefined }) };
  try {
    radio.connectionChanged(false); radio.connected = true;
    await radio.restoreSession();
    assert.equal(radio.joined, false); assert.equal(radio.session, '');
    assert.equal(radio.error, 'Radio session ended.');
    assert.equal(fixture.writes.length, 0);
  } finally { radio.ngOnDestroy(); }
});
test('places remain reserved throughout grace while stale presence still invalidates audio after 20 seconds', async () => {
  const fixture = service(); const { radio } = fixture;
  try {
    radio.room.presence[0].at = Date.now() - 120000;
    await radio.reclaimStale();
    assert.equal(fixture.writes.length, 0);
    assert.equal(state.activeFloor(radio.room, Date.now()), undefined);
    assert.equal(state.RECONNECT_GRACE_MS, 180000); assert.equal(state.PRESENCE_TIMEOUT_MS, 20000);
  } finally { radio.ngOnDestroy(); }
});

test('leaving during recovery cleans a late renewed session without restoring audio', async () => {
  const fixture = service(); const { radio } = fixture; let finish;
  radio.cleanup = radio.releasePatch('1', 'bSession', '1');
  radio.presenceRef = { transaction: () => new Promise(resolve => { finish = resolve; }) };
  try {
    radio.connectionChanged(false); radio.connected = true;
    const pending = radio.restoreSession(); radio.exit();
    finish({ committed: true }); await pending;
    assert.equal(radio.joined, false);
    assert.equal(fixture.writes.length, 2);
    assert.equal(fixture.writes[1]['speakers/1'], null);
    assert.notEqual(fixture.writes[1]['presence/1'].session, 'bSession');
    assert.equal(fixture.transmitted, 0);
  } finally { radio.ngOnDestroy(); }
});

const { RadioLifecycleService } = load('../src/app/prototypes/team-radio/radioLifecycle.service.ts', {
  '@angular/fire/compat/auth': { AngularFireAuth: class {} },
  '@angular/fire/compat/database': { AngularFireDatabase: class {} },
  '@angular/fire/compat/firestore': { AngularFirestore: class {} },
  '@angular/core': { ...core, createEnvironmentInjector: (_, parent) => parent.createScope() },
  rxjs: { Subject }, './radioRoom.service': { RadioRoomService }, './radioAudio.service': { RadioAudioService }, './radioState': state
});
const returnKey = 'perrinn.teamRadio.return';
function lifecycleFixture(ticket, overrides = {}) {
  const previous = { window: globalThis.window, document: globalThis.document, sessionStorage: globalThis.sessionStorage };
  const win = new EventTarget(); const doc = new EventTarget(); doc.hidden = false;
  const values = new Map(ticket ? [[returnKey, JSON.stringify(ticket)]] : []);
  globalThis.window = win; globalThis.document = doc;
  globalThis.sessionStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const calls = { scopes: 0, disposed: 0, recover: [], active: [], suspended: 0, resumed: 0, exits: 0, joins: 0 };
  const radio = {
    changed: new Subject(), joined: false, connected: true, authResolved: true, loading: false,
    user: { uid: 'b' }, seat: '1', session: 'bSession', reconnecting: false, seats: [], error: '',
    join: async () => { calls.joins++; radio.joined = true; }, showError: error => { radio.error = error.message; },
    get returnUntil() { return Date.now() + state.RECONNECT_GRACE_MS; },
    setPageActive: active => calls.active.push(active),
    recover: async saved => { calls.recover.push(saved); radio.joined = true; },
    exit: () => { calls.exits++; radio.joined = false; radio.changed.next(); },
    suspendPage: () => { calls.suspended++; }, resumePage: () => { calls.resumed++; },
    ...overrides
  };
  const parent = { get: () => ({}), createScope: () => { calls.scopes++; return { get: () => radio, destroy: () => { calls.disposed++; } }; } };
  const lifecycle = new RadioLifecycleService(parent);
  return { lifecycle, radio, calls, values, win, doc,
    close() { lifecycle.ngOnDestroy(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } } };
}

test('the app radio lifecycle opens no Firebase scope until its page is visited or a valid return exists', () => {
  const fixture = lifecycleFixture();
  try {
    assert.equal(fixture.calls.scopes, 0); assert.equal(fixture.lifecycle.returnLabel, '');
    fixture.lifecycle.enterPage(); assert.equal(fixture.calls.scopes, 1);
    fixture.lifecycle.leavePage(); assert.equal(fixture.calls.disposed, 1);
  } finally { fixture.close(); }
});
test('leaving retains listening and both places; returning cancels the three-minute away window', () => {
  const fixture = lifecycleFixture(); const { lifecycle, radio, calls } = fixture;
  try {
    lifecycle.enterPage(); radio.joined = true; radio.changed.next(); lifecycle.leavePage();
    assert.match(lifecycle.returnLabel, /^Radio · [23]:/);
    assert.equal(calls.exits, 0); assert.equal(calls.disposed, 0); assert.equal(calls.active.at(-1), false);
    const saved = JSON.parse(fixture.values.get(returnKey)); assert.equal(saved.session, 'bSession');
    lifecycle.enterPage(); assert.equal(lifecycle.returnLabel, ''); assert.equal(lifecycle.awayUntil, 0);
    assert.equal(calls.active.at(-1), true); assert.equal(calls.scopes, 1);
  } finally { fixture.close(); }
});
test('focus and page visibility start an away window; subsequent network loss cannot extend it', () => {
  const fixture = lifecycleFixture(); const { lifecycle, radio, win, doc } = fixture;
  try {
    lifecycle.enterPage(); radio.joined = true;
    win.dispatchEvent(new Event('blur'));
    lifecycle.awayUntil = Date.now() + 120000; const deadline = lifecycle.awayUntil;
    doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
    radio.reconnecting = true; radio.changed.next();
    assert.equal(lifecycle.awayUntil, deadline);
    assert.equal(JSON.parse(fixture.values.get(returnKey)).until, deadline);
    doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(lifecycle.awayUntil, 0);
  } finally { fixture.close(); }
});
test('expiry clears the session and its per-tab return reference; a late return does not renew it', () => {
  const fixture = lifecycleFixture(); const { lifecycle, radio, calls } = fixture;
  try {
    lifecycle.enterPage(); radio.joined = true; radio.changed.next(); lifecycle.leavePage();
    lifecycle.awayUntil = Date.now() - 1;
    lifecycle.enterPage();
    assert.equal(calls.exits, 1); assert.equal(radio.joined, false); assert.equal(fixture.values.has(returnKey), false);
    lifecycle.leavePage(); assert.equal(calls.disposed, 1);
  } finally { fixture.close(); }
});
test('reload recovery waits for real authentication and the complete roster before restoring', () => {
  const ticket = { uid: 'b', seat: '1', session: 'bSession', until: Date.now() + 120000 };
  const fixture = lifecycleFixture(ticket, { authResolved: false, loading: true });
  try {
    fixture.radio.changed.next(); assert.equal(fixture.calls.recover.length, 0);
    fixture.radio.authResolved = true; fixture.radio.changed.next(); assert.equal(fixture.calls.recover.length, 0);
    fixture.radio.loading = false; fixture.radio.changed.next();
    assert.deepEqual(fixture.calls.recover, [ticket]);
    assert.equal(fixture.lifecycle.awayUntil, ticket.until);
  } finally { fixture.close(); }
});
test('a return reference cannot restore another account, a signed-out user or an expired session', () => {
  for (const overrides of [{ user: { uid: 'other' } }, { user: undefined, connected: false }]) {
    const fixture = lifecycleFixture({ uid: 'b', seat: '1', session: 'bSession', until: Date.now() + 100000 }, overrides);
    try {
      fixture.radio.changed.next(); assert.equal(fixture.calls.recover.length, 0);
      assert.equal(fixture.values.has(returnKey), false); assert.equal(fixture.calls.disposed, 1);
    } finally { fixture.close(); }
  }
  const fixture = lifecycleFixture({ uid: 'b', seat: '1', session: 'bSession', until: Date.now() - 1 });
  try { assert.equal(fixture.calls.scopes, 0); assert.equal(fixture.values.has(returnKey), false); }
  finally { fixture.close(); }
});
test('pagehide preserves a bounded return reference and suspends media; pageshow resumes safely', () => {
  const fixture = lifecycleFixture(); const { lifecycle, radio, calls, win } = fixture;
  try {
    lifecycle.enterPage(); radio.joined = true; radio.changed.next();
    win.dispatchEvent(new Event('pagehide'));
    assert.equal(calls.suspended, 1); assert.equal(calls.exits, 0);
    assert.equal(JSON.parse(fixture.values.get(returnKey)).session, 'bSession');
    win.dispatchEvent(new Event('pageshow'));
    assert.equal(calls.resumed, 1); assert.equal(lifecycle.awayUntil, 0);
  } finally { fixture.close(); }
});
test('away mode forbids transmission without closing listening audio', async () => {
  const fixture = service(); const { radio } = fixture; let closed = 0; let reconciled = 0;
  radio.audio.close = () => closed++; radio.audio.reconcile = () => reconciled++;
  try {
    radio.setPageActive(false); await radio.talk();
    assert.equal(fixture.transmitted, 0); assert.equal(closed, 0); assert.equal(reconciled, 0);
    assert.equal(radio.joined, true); assert.equal(radio.audioReady, false);
  } finally { radio.ngOnDestroy(); }
});
test('real session recovery keeps the existing place and speaking role but confirms ownership before renewing', async () => {
  const fixture = service(); const { radio } = fixture;
  radio.joined = false; radio.loading = false; radio.authResolved = true; radio.audio.resume = async () => {};
  let confirmations = 0;
  const presence = { onDisconnect: fixture.ref.onDisconnect, transaction: async update => {
    confirmations++; const next = update(radio.room.presence[1]);
    if (!next) return { committed: false };
    radio.room.presence[1] = { ...next, at: Date.now() }; return { committed: true };
  } };
  fixture.ref.child = path => path === 'presence/1' ? presence : fixture.ref;
  try {
    const ticket = { uid: 'wrong', seat: '1', session: 'bSession', until: Date.now() + 120000 };
    await radio.recover(ticket); assert.equal(confirmations, 0);
    await radio.recover({ ...ticket, uid: 'b' });
    assert.equal(confirmations, 1); assert.equal(radio.joined, true); assert.equal(radio.speakingPlace, '1');
    assert.notEqual(radio.session, 'bSession'); assert.equal(fixture.writes.length, 0);
  } finally { radio.ngOnDestroy(); }
});

test('the return countdown stays stable during rendering and updates on the radio clock', () => {
  const fixture = lifecycleFixture(); const { lifecycle, radio } = fixture; const originalNow = Date.now;
  try {
    lifecycle.enterPage(); radio.joined = true; lifecycle.leavePage();
    const initial = lifecycle.returnLabel; const base = Date.now();
    Date.now = () => base + 1500;
    assert.equal(lifecycle.returnLabel, initial, 'rendering alone must not mutate a binding');
    radio.changed.next(); assert.notEqual(lifecycle.returnLabel, initial);
  } finally { Date.now = originalNow; fixture.close(); }
});

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
test('automatic listening waits for authentication, connection and the complete roster', async () => {
  const f = lifecycleFixture(undefined, { authResolved: false, loading: true, connected: false });
  try {
    f.lifecycle.enterPage(); await settle(); assert.equal(f.calls.joins, 0);
    f.radio.authResolved = true; f.radio.loading = false; f.radio.changed.next(); await settle(); assert.equal(f.calls.joins, 0);
    f.radio.connected = true; f.radio.changed.next(); await settle(); assert.equal(f.calls.joins, 1);
    f.radio.changed.next(); await settle(); assert.equal(f.calls.joins, 1);
  } finally { f.close(); }
});
test('a full room waits without claims and automatically joins when a place opens', async () => {
  const f = lifecycleFixture(undefined, { seat: undefined, seats: Array.from({ length: 10 }, (_, id) => ({ id: String(id), uid: `user${id}` })) });
  try {
    f.lifecycle.enterPage(); await settle(); assert.equal(f.calls.joins, 0);
    f.radio.changed.next(); await settle(); assert.equal(f.calls.joins, 0);
    f.radio.seats.pop(); f.radio.changed.next(); await settle(); assert.equal(f.calls.joins, 1);
  } finally { f.close(); }
});
test('leaving or hiding before automatic joining starts never claims a place', async () => {
  for (const hide of [false, true]) {
    const f = lifecycleFixture();
    try {
      f.lifecycle.enterPage();
      if (hide) { f.doc.hidden = true; f.doc.dispatchEvent(new Event('visibilitychange')); }
      else f.lifecycle.leavePage();
      await settle(); assert.equal(f.calls.joins, 0);
      if (hide) {
        f.doc.hidden = false; f.doc.dispatchEvent(new Event('visibilitychange'));
        await settle(); assert.equal(f.calls.joins, 1, 'returning must retry a cancelled admission');
      }
    } finally { f.close(); }
  }
});
test('capacity contention does not retry every clock tick but retries after a roster change', async () => {
  const f = lifecycleFixture(); let attempts = 0;
  f.radio.join = async () => { attempts++; throw new Error('Room full. All 10 places are taken.'); };
  try {
    f.lifecycle.enterPage(); await settle(); assert.equal(attempts, 1);
    f.radio.changed.next(); await settle(); assert.equal(attempts, 1); assert.equal(f.radio.error, '');
    f.radio.seats.push({ id: '2', uid: 'other' }); f.radio.changed.next(); await settle(); assert.equal(attempts, 2);
  } finally { f.close(); }
});
test('autoplay waiting for a gesture does not block listener admission or request a microphone', async () => {
  const f = service({ seats: {}, speakers: {}, presence: {} }); const { radio } = f; let microphoneRequests = 0;
  radio.joined = false; radio.resolveName = async () => 'Blair'; radio.reclaimStale = async () => {};
  radio.audio.resume = () => new Promise(() => {}); radio.audio.enableMicrophone = () => { microphoneRequests++; };
  f.ref.update = async patch => { f.writes.push(patch); for (const [path, value] of Object.entries(patch)) { const [group, key] = path.split('/'); if (group === 'seats' || group === 'presence') (radio.room[group] ||= {})[key] = group === 'presence' ? { ...value, at: Date.now() } : value; } };
  try {
    await radio.join(); assert.equal(radio.joined, true); assert.equal(microphoneRequests, 0);
    assert.equal(radio.speakingPlace, undefined);
  } finally { radio.ngOnDestroy(); }
});
test('a late automatic claim is cleaned when its page was disposed during admission', async () => {
  const f = service({ seats: {}, speakers: {}, presence: {} }); const { radio } = f; let complete;
  radio.joined = false; radio.resolveName = async () => 'Blair'; radio.reclaimStale = async () => {}; radio.audio.resume = async () => {};
  f.ref.update = patch => { f.writes.push(patch); return f.writes.length === 1 ? new Promise(resolve => complete = resolve) : Promise.resolve(); };
  try {
    const admission = radio.join(); await settle(); radio.exit(); complete(); await admission;
    assert.equal(radio.joined, false); assert.equal(f.writes.at(-1)['seats/0'], null);
  } finally { radio.ngOnDestroy(); }
});
test('microphone acquisition is shared, starts in the gesture and reuses a live stream', async () => {
  const audio = new RadioAudioService(); const fake = fakeContext(); let resolve; let requests = 0;
  audio.context = fake.context; audio.output = fake.context.createMediaStreamDestination();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const track = { readyState: 'live', stop() { this.readyState = 'ended'; } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => { requests++; return new Promise(done => resolve = done); } } } });
  try {
    const first = audio.enableMicrophone(); const second = audio.enableMicrophone();
    assert.equal(requests, 1, 'request must start before leaving the gesture'); assert.equal(first, second);
    resolve({ getTracks: () => [track], getAudioTracks: () => [track] }); await first;
    await audio.enableMicrophone(); assert.equal(requests, 1); assert.equal(audio.microphoneReady, true);
    audio.disableMicrophone(); assert.equal(track.readyState, 'ended');
  } finally { audio.close(); if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator; }
});

test('expiry stops a captured microphone even while the audio context awaits a gesture', async () => {
  const audio = new RadioAudioService(); const fake = fakeContext(); let resume;
  audio.context = fake.context; audio.output = fake.context.createMediaStreamDestination();
  fake.context.resume = () => new Promise(resolve => resume = resolve);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const track = { readyState: 'live', stop() { this.readyState = 'ended'; } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } } });
  try {
    const pending = audio.enableMicrophone(); await settle();
    audio.close(); assert.equal(track.readyState, 'ended'); resume(); await assert.rejects(pending, /cancelled/);
  } finally { if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator; }
});
