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
const diagnostics = load('../src/app/prototypes/team-radio/radioDiagnostics.ts');
const { RadioAudioService } = load('../src/app/prototypes/team-radio/radioAudio.service.ts', { '@angular/core': core, './radioDiagnostics': diagnostics });
const { RadioRoomService } = load('../src/app/prototypes/team-radio/radioRoom.service.ts', {
  '@angular/core': core,
  rxjs: { firstValueFrom, Subject },
  'firebase/compat/app': { default: { database: { ServerValue: { TIMESTAMP: { '.sv': 'timestamp' } } } } },
  'firebase/compat/database': {}, './radioState': state, './radioDiagnostics': diagnostics
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
    diagnostics: new diagnostics.RadioDiagnostics(),
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
    assert.equal(fixture.radio.error, '', 'a canceled press is not channel contention');
  } finally { fixture.radio.ngOnDestroy(); }
});
test('cleanup of an old transmission cannot erase a newer token', async () => {
  const fixture = service();
  try { await fixture.radio.clearFloor('old-token'); assert.equal(fixture.storedFloor.token, 'one'); }
  finally { fixture.radio.ngOnDestroy(); }
});

test('permission errors normalize SDK transaction messages and coded errors without masking microphone errors', () => {
  const f = service();
  try {
    for (const error of [new Error('permission_denied'), { code: 'PERMISSION_DENIED' }, { code: 'database/permission-denied' }]) {
      assert.equal(diagnostics.isRadioPermissionDenied(error), true);
      f.radio.showError(error); assert.equal(f.radio.error, 'Radio request denied. Try Reconnect.');
    }
    const microphone = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    assert.equal(diagnostics.isRadioPermissionDenied(microphone), false);
    f.radio.showError(microphone); assert.match(f.radio.error, /^Microphone permission denied/);
  } finally { f.radio.ngOnDestroy(); }
});

test('a rejected Talk acquisition records sanitized request timing and session checks with no transmission', async () => {
  const f = service(); f.setFloor(null); let requests = 0;
  f.ref.transaction = async update => {
    requests++;
    const candidate = update(null);
    if (candidate) throw new Error('permission_denied');
    return { committed: false };
  };
  try {
    await f.radio.talk();
    assert.equal(f.transmitted, 0); assert.equal(requests, 2, 'existing acquisition and token cleanup only');
    assert.equal(f.radio.error, 'Talk was rejected. Reconnect and enable talking again.');
    const events = f.radio.audio.diagnostics.snapshot();
    const attempt = events.find(event => event.event === 'talk-acquire-attempt');
    const rejected = events.find(event => event.event === 'talk-acquire-rejected');
    assert.equal(attempt.requestedExpiresAt - attempt.requestedStartAt, 30000);
    assert.equal(rejected.reason, 'permission-denied'); assert.equal(rejected.attempt, 1);
    assert.equal(rejected.seatOwned, true); assert.equal(rejected.speakerReserved, true);
    assert.equal(rejected.sessionMatches, true); assert.equal(rejected.presenceOnline, true);
    assert.equal(rejected.floorAvailable, true); assert.equal(rejected.serverOffsetMs, 0);
    assert.ok(rejected.elapsedMs >= 0); assert.ok(rejected.presenceAgeMs >= 0);
    for (const event of events) for (const forbidden of ['uid', 'name', 'token', 'sdp', 'error', 'message']) assert.equal(forbidden in event, false);
  } finally { f.radio.ngOnDestroy(); }
});

test('release rejection is distinct from acquisition rejection and outgoing audio stops immediately', async () => {
  const f = service(); f.setFloor(null); let stopped = 0;
  f.radio.audio.stop = () => stopped++;
  try {
    await f.radio.talk();
    f.ref.transaction = async update => { assert.equal(update(f.storedFloor), null); throw new Error('permission_denied'); };
    const releasing = f.radio.releaseTalk();
    assert.equal(stopped, 1); assert.equal(f.radio.speakingToken, undefined);
    await releasing;
    assert.equal(f.radio.error, 'Couldn’t release Talk. Try Reconnect.');
    const events = f.radio.audio.diagnostics.snapshot();
    assert.ok(events.some(event => event.event === 'talk-acquire-committed'));
    assert.ok(events.some(event => event.event === 'talk-release-rejected' && event.reason === 'permission-denied'));
    assert.equal(events.some(event => event.event === 'talk-acquire-rejected'), false);
  } finally { f.radio.ngOnDestroy(); }
});

test('diagnostic snapshots expose stale heartbeat and replaced session observations without pretending server confirmation', () => {
  const f = service();
  try {
    f.radio.room.presence[1] = { session: 'another-device', online: false, at: Date.now() - 21000 };
    f.radio.recordTalk('talk-test');
    const event = f.radio.audio.diagnostics.snapshot().at(-1);
    assert.equal(event.sessionMatches, false); assert.equal(event.presenceOnline, false);
    assert.ok(event.presenceAgeMs >= 21000);
  } finally { f.radio.ngOnDestroy(); }
});

test('a late Talk rejection cannot overwrite a newer session error', async () => {
  const f = service(); f.setFloor(null); let reject;
  f.ref.transaction = update => { update(null); return new Promise((_, fail) => reject = fail); };
  try {
    const pending = f.radio.talk();
    f.radio.session = 'replacement'; f.radio.error = 'Radio moved to another device.';
    // Cleanup must settle without replacing the newer error.
    f.ref.transaction = async () => ({ committed: false });
    reject(new Error('permission_denied')); await pending;
    assert.equal(f.radio.error, 'Radio moved to another device.');
    assert.equal(f.transmitted, 0);
  } finally { f.radio.ngOnDestroy(); }
});

test('Enable talking identifies microphone, speaking-slot and disconnect-hook failures', async () => {
  for (const phase of ['microphone', 'speaker-claim', 'disconnect-hook']) {
    const f = service(); f.radio.room.speakers = {};
    let disabled = 0;
    f.radio.audio.enableMicrophone = async () => {
      if (phase === 'microphone') throw Object.assign(new Error('private browser message'), { name: 'NotAllowedError' });
    };
    f.radio.audio.disableMicrophone = () => disabled++;
    f.ref.transaction = async update => {
      if (phase === 'speaker-claim') throw new Error('permission_denied');
      return { committed: true, snapshot: { val: () => update(null) } };
    };
    f.radio.armCleanup = async () => { throw new Error('permission_denied'); };
    try {
      await assert.rejects(f.radio.enableTalking());
      const events = f.radio.audio.diagnostics.snapshot();
      const failure = events.find(event => event.event === 'enable-talking-rejected');
      assert.equal(failure.kind, phase);
      assert.equal(failure.reason, phase === 'microphone' ? 'microphone-permission-denied' : 'permission-denied');
      assert.ok(failure.elapsedMs >= 0);
      assert.equal(disabled, phase === 'disconnect-hook' ? 0 : 1);
      assert.equal(f.radio.joined, phase !== 'disconnect-hook');
      assert.equal(JSON.stringify(events).includes('private browser message'), false);
      assert.equal(events.some(event => event.event === 'speaker-claim-start'), phase !== 'microphone');
    } finally { f.radio.ngOnDestroy(); }
  }
});

test('capture includes current listener state even without a Talk attempt', () => {
  const f = service(); f.radio.room.speakers = {}; f.radio.error = 'private error';
  f.radio.audio.canTransmit = false;
  try {
    const events = f.radio.captureDiagnostics();
    assert.equal(events.length, 1);
    assert.equal(events[0].event, 'diagnostics-capture');
    assert.equal(events[0].kind, 'joined-listener');
    assert.equal(events[0].microphoneReady, false);
    assert.equal(events[0].errorPresent, true);
    assert.equal(events[0].connection, 'connected');
    assert.equal(JSON.stringify(events).includes('private error'), false);
  } finally { f.radio.ngOnDestroy(); }
});

test('Copy diagnostics exports the current bounded trace and preserves the original error when clipboard fails', async () => {
  const { TeamRadioComponent } = load('../src/app/prototypes/team-radio/team-radio.component.ts', {
    '@angular/core': { Component: () => target => target, HostListener: () => () => {} },
    './radioAvatars.service': { RadioAvatarsService: class {} }, './radioState': state
  });
  const f = service(); const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let copied; let failed = false;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: {
    writeText: async text => { if (failed) throw new Error('Blocked'); copied = text; }
  } } });
  const component = new TeamRadioComponent({ enterPage: () => f.radio, leavePage() {} }, { markForCheck() {} }, { sync() {} });
  try {
    f.radio.error = 'Talk was rejected. Reconnect and enable talking again.';
    f.radio.recordTalk('talk-acquire-rejected', undefined, { reason: 'permission-denied' });
    await component.copyDiagnostics();
    const exported = JSON.parse(copied);
    assert.equal(exported.version, 1); assert.ok(Number.isFinite(Date.parse(exported.capturedAt)));
    assert.deepEqual(exported.events, JSON.parse(JSON.stringify(f.radio.audio.diagnostics.snapshot())));
    assert.equal(component.diagnosticsCopyLabel, 'Copied');
    failed = true; await component.copyDiagnostics();
    assert.equal(component.diagnosticsCopyLabel, 'Copy failed');
    assert.equal(f.radio.error, 'Talk was rejected. Reconnect and enable talking again.');
  } finally {
    component.ngOnDestroy(); f.radio.ngOnDestroy();
    if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator;
  }
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
  const peer = { session: 'remote', offerId: '', retries: 0, offers: new Set(), queue: Promise.resolve(), pc: {
    signalingState: 'stable',
    setRemoteDescription: async () => {}, getTransceivers: () => [transceiver],
    setLocalDescription: async () => {}, createAnswer: async () => ({ type: 'answer' })
  } };
  audio.peers.set('0', peer); audio.publish = async () => published = true;
  audio.receive('0', { fromSession: 'remote', toSession: 'local', offerId: 'offer', type: 'offer', sdp: 'sdp' });
  await peer.queue;
  assert.equal(transceiver.direction, 'sendrecv'); assert.equal(track.kind, 'audio'); assert.equal(published, true);
  clearTimeout(peer.watchdog);
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
    audio: { resume: async () => { calls.resumed++; } },
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
test('connected listening survives navigation and more than three minutes in the background', () => {
  const f = lifecycleFixture(); const originalNow = Date.now; const base = Date.now();
  try {
    f.lifecycle.enterPage(); f.radio.joined = true; f.lifecycle.leavePage();
    assert.equal(f.lifecycle.returnLabel, 'Radio');
    f.win.dispatchEvent(new Event('blur')); f.doc.hidden = true;
    f.doc.dispatchEvent(new Event('visibilitychange'));
    const firstTicket = JSON.parse(f.values.get(returnKey));
    Date.now = () => base + 600000; f.radio.changed.next();
    assert.equal(f.calls.exits, 0); assert.equal(f.calls.disposed, 0);
    assert.equal(f.calls.suspended, 0); assert.equal(f.calls.active.at(-1), false);
    assert.equal(f.lifecycle.returnLabel, 'Radio');
    assert.ok(JSON.parse(f.values.get(returnKey)).until > firstTicket.until);
    f.doc.hidden = false; f.doc.dispatchEvent(new Event('visibilitychange'));
    f.lifecycle.enterPage(); assert.equal(f.lifecycle.returnLabel, '');
    assert.equal(f.calls.active.at(-1), true); assert.equal(f.calls.scopes, 1);
  } finally { Date.now = originalNow; f.close(); }
});
test('background disconnect tickets retain the room recovery deadline without extending it', () => {
  const deadline = Date.now() + 120000;
  const f = lifecycleFixture(undefined, { get returnUntil() { return deadline; } });
  try {
    f.lifecycle.enterPage(); f.radio.joined = true; f.lifecycle.leavePage();
    f.radio.reconnecting = true; f.radio.changed.next();
    f.win.dispatchEvent(new Event('blur'));
    f.doc.hidden = true; f.doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(JSON.parse(f.values.get(returnKey)).until, deadline);
    assert.match(f.lifecycle.returnLabel, /^Radio · [12]:/);
    f.doc.hidden = false; f.doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(JSON.parse(f.values.get(returnKey)).until, deadline);
  } finally { f.close(); }
});
test('Leave ends listening without automatic readmission; Listen explicitly admits again', async () => {
  const f = lifecycleFixture();
  try {
    f.lifecycle.enterPage(); await settle(); assert.equal(f.calls.joins, 1);
    f.lifecycle.stopListening(); await settle();
    assert.equal(f.calls.exits, 1); assert.equal(f.radio.joined, false);
    assert.equal(f.values.has(returnKey), false); assert.equal(f.lifecycle.listeningStopped, true);
    f.win.dispatchEvent(new Event('focus')); f.radio.changed.next(); await settle();
    assert.equal(f.calls.joins, 1);
    f.lifecycle.startListening(); await settle();
    assert.equal(f.calls.joins, 2); assert.equal(f.lifecycle.listeningStopped, false);
  } finally { f.close(); }
});
test('reload recovery waits for real authentication and the complete roster before restoring', () => {
  const ticket = { uid: 'b', seat: '1', session: 'bSession', until: Date.now() + 120000 };
  const fixture = lifecycleFixture(ticket, { authResolved: false, loading: true });
  try {
    fixture.radio.changed.next(); assert.equal(fixture.calls.recover.length, 0);
    fixture.radio.authResolved = true; fixture.radio.changed.next(); assert.equal(fixture.calls.recover.length, 0);
    fixture.radio.loading = false; fixture.radio.changed.next();
    assert.deepEqual(fixture.calls.recover, [ticket]);
    assert.equal(fixture.radio.joined, true);
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
    assert.equal(calls.resumed, 1); assert.equal(calls.active.at(-1), true);
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
test('backgrounding an active transmission closes its microphone gate before floor cleanup finishes', async () => {
  const f = service(); let stopped = 0;
  f.radio.audio.stop = () => stopped++;
  try {
    f.setFloor(null); await f.radio.talk(); assert.equal(f.transmitted, 1);
    f.radio.setPageActive(false);
    assert.ok(stopped > 0); assert.equal(f.radio.transmitting, false);
    assert.equal(f.radio.joined, true); assert.equal(f.radio.audioReady, false);
    await f.radio.talk(); assert.equal(f.transmitted, 1);
  } finally { f.radio.ngOnDestroy(); }
});
test('returning to a visible joined radio retries blocked audio without admitting a new session', async () => {
  const f = lifecycleFixture();
  try {
    f.lifecycle.enterPage(); await settle();
    f.doc.hidden = true; f.doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(f.calls.resumed, 0);
    f.doc.hidden = false; f.doc.dispatchEvent(new Event('visibilitychange')); await settle();
    assert.equal(f.calls.resumed, 1); assert.equal(f.calls.joins, 1);
  } finally { f.close(); }
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

test('the disconnect countdown stays stable during rendering and updates on the radio clock', () => {
  const fixture = lifecycleFixture(); const { lifecycle, radio } = fixture; const originalNow = Date.now;
  try {
    lifecycle.enterPage(); radio.joined = true; lifecycle.leavePage();
    radio.reconnecting = true; const deadline = Date.now() + 120000;
    Object.defineProperty(radio, 'returnUntil', { get: () => deadline }); radio.changed.next();
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
test('opening, refocusing and reopening the radio never admits over another device reservation', async () => {
  const f = lifecycleFixture(undefined, { reservedElsewhere: true });
  try {
    f.lifecycle.enterPage(); await settle();
    for (let turn = 0; turn < 5; turn++) {
      f.win.dispatchEvent(new Event('blur')); f.win.dispatchEvent(new Event('focus'));
      f.doc.hidden = true; f.doc.dispatchEvent(new Event('visibilitychange'));
      f.doc.hidden = false; f.doc.dispatchEvent(new Event('visibilitychange'));
      f.radio.changed.next(); await settle();
    }
    assert.equal(f.calls.joins, 0);
    f.lifecycle.leavePage(); f.lifecycle.enterPage(); await settle();
    assert.equal(f.calls.joins, 0);
    f.radio.reservedElsewhere = false; f.radio.changed.next(); await settle();
    assert.equal(f.calls.joins, 1, 'a released reservation allows normal automatic admission');
  } finally { f.close(); }
});
test('a queued admission is canceled if another device appears before the claim starts', async () => {
  const f = lifecycleFixture();
  try {
    f.lifecycle.enterPage(); f.radio.reservedElsewhere = true;
    await settle(); assert.equal(f.calls.joins, 0);
  } finally { f.close(); }
});
test('a superseded reload ticket cannot fall through into automatic takeover', async () => {
  const ticket = { uid: 'b', seat: '1', session: 'old-phone', until: Date.now() + 120000 };
  const f = lifecycleFixture(ticket, { reservedElsewhere: true, recover: async () => {} });
  try {
    f.lifecycle.enterPage(); await settle(); f.win.dispatchEvent(new Event('focus')); await settle();
    assert.equal(f.calls.joins, 0); assert.equal(f.radio.joined, false);
    assert.equal(f.values.has(returnKey), false);
  } finally { f.close(); }
});
test('automatic join respects live and recently offline own-account reservations without media or writes', async () => {
  const f = service(); f.radio.joined = false; f.radio.session = '';
  try {
    for (const online of [true, false]) {
      f.radio.room.presence[1] = { ...f.radio.room.presence[1], session: 'desktop', online, at: Date.now() };
      assert.equal(f.radio.reservedElsewhere, true);
      await f.radio.join(); assert.equal(f.writes.length, 0);
    }
    f.radio.room.presence[1].at = Date.now() - 180001;
    assert.equal(f.radio.reservedElsewhere, false, 'an expired reservation is not a live device');
  } finally { f.radio.ngOnDestroy(); }
});
test('automatic admission rechecks reservations after an asynchronous profile lookup', async () => {
  const f = service({ seats: {}, speakers: {}, presence: {} }); const { radio } = f; let finish;
  radio.joined = false; radio.session = ''; radio.reclaimStale = async () => {};
  radio.audio.resume = async () => {};
  radio.resolveName = () => new Promise(resolve => finish = resolve);
  try {
    const joining = radio.join(); await settle();
    radio.room = { seats: { 1: { uid: 'b', name: 'Blair' } }, presence: { 1: { session: 'desktop', online: true, at: Date.now() } } };
    finish('Blair'); await joining;
    assert.equal(f.writes.length, 0); assert.equal(radio.joined, false);
  } finally { radio.ngOnDestroy(); }
});
test('explicit Reconnect can move the radio here through the existing session-bound claim', async () => {
  const f = service(); const { radio } = f; radio.joined = false; radio.session = '';
  radio.reclaimStale = async () => {}; radio.resolveName = async () => 'Blair'; radio.audio.resume = async () => {};
  f.ref.update = async patch => {
    f.writes.push(patch);
    for (const [path, value] of Object.entries(patch)) {
      const [group, key] = path.split('/');
      if (group === 'seats' || group === 'presence') (radio.room[group] ||= {})[key] = group === 'presence' ? { ...value, at: Date.now() } : value;
    }
  };
  try {
    await radio.reconnect();
    assert.equal(radio.joined, true); assert.notEqual(radio.session, 'bSession');
    assert.equal(f.writes[0]['seats/1'].uid, 'b');
    assert.equal(f.writes[0]['presence/1'].session, radio.session);
  } finally { radio.ngOnDestroy(); }
});
test('a replaced device reports handoff before teardown notifies automatic admission', () => {
  const f = service(); const observedErrors = [];
  f.radio.room.presence[1] = { ...f.radio.room.presence[1], at: Date.now(), session: 'phone' };
  const subscription = f.radio.changed.subscribe(() => { if (!f.radio.joined) observedErrors.push(f.radio.error); });
  try {
    f.radio.sync();
    assert.equal(f.radio.joined, false); assert.equal(f.radio.reservedElsewhere, true);
    assert.ok(observedErrors.length > 0);
    assert.ok(observedErrors.every(error => error === 'Radio moved to another device.'));
  } finally { subscription.unsubscribe(); f.radio.ngOnDestroy(); }
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

test('audio-session hints follow listening and microphone capture, then restore on close', async () => {
  const audio = new RadioAudioService(); const fake = fakeContext();
  audio.context = fake.context; audio.output = fake.context.createMediaStreamDestination();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const session = { type: 'auto' };
  const track = { readyState: 'live', stop() { this.readyState = 'ended'; } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    audioSession: session,
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) }
  } });
  try {
    await audio.resume(); assert.equal(session.type, 'playback');
    await audio.enableMicrophone(); assert.equal(session.type, 'play-and-record');
    audio.disableMicrophone(); assert.equal(session.type, 'playback');
    audio.close(); assert.equal(session.type, 'auto');
  } finally { audio.close(); if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator; }
});
test('unsupported audio-session policies never prevent playback or cleanup', async () => {
  const audio = new RadioAudioService(); audio.context = fakeContext().context;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    audioSession: { get type() { return 'auto'; }, set type(_) { throw new Error('Unsupported'); } }
  } });
  try { await audio.resume(); audio.close(); }
  finally { if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator; }
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

// Issue #92: transport identity and retry regressions, with a controlled clock.
function auditAudio() {
  const audio = new RadioAudioService();
  const created = [];
  const original = globalThis.RTCPeerConnection;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Map(); let clock = 0; let nextTimer = 0;
  globalThis.setTimeout = (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, at: clock + delay }); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  globalThis.RTCPeerConnection = class {
    connectionState = 'new';
    signalingState = 'stable';
    iceGatheringState = 'complete';
    descriptions = []; offerOptions = [];
    transceiver = { direction: 'sendrecv', sender: { replaceTrack: async () => {} } };
    constructor() { created.push(this); }
    close() { this.connectionState = 'closed'; this.signalingState = 'closed'; }
    addTransceiver() { return this.transceiver; }
    getTransceivers() { return [this.transceiver]; }
    async createOffer(options) { this.offerOptions.push(options); return { type: 'offer', sdp: `offer-${this.offerOptions.length}` }; }
    async createAnswer() { return { type: 'answer', sdp: `answer-${this.descriptions.length}` }; }
    async setLocalDescription(description) {
      this.descriptions.push(description); this.localDescription = description;
      this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
    }
    async setRemoteDescription(description) { this.descriptions.push(description); this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable'; }
  };
  // Isolate connection ownership from browser SDP, media and network behavior.
  audio.offer = async () => {};
  return { audio, created, timers,
    async advance(ms) {
      const until = clock + ms;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        clock = next[1].at; timers.delete(next[0]); next[1].callback(); await settle();
      }
      clock = until; await settle();
    },
    restore() {
      audio.close(); globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout;
      if (original) globalThis.RTCPeerConnection = original; else delete globalThis.RTCPeerConnection;
    } };
}

test('radio audit: roster additions and removals preserve unaffected peer objects', () => {
  const f = auditAudio();
  const first = { seat: '0', session: 'remote-zero', speaker: true };
  const second = { seat: '2', session: 'remote-two', speaker: true };
  try {
    f.audio.reconcile('1', 'local', true, [first]);
    const retained = f.audio.peers.get('0');
    retained.pc.connectionState = 'connected';
    f.audio.reconcile('1', 'local', true, [first, second]);
    assert.equal(f.audio.peers.get('0'), retained);
    f.audio.reconcile('1', 'local', true, [first]);
    assert.equal(f.audio.peers.get('0'), retained);
    assert.equal(retained.pc.connectionState, 'connected');
    assert.equal(f.created.length, 2);
    assert.equal(f.created[1].connectionState, 'closed');
  } finally { f.restore(); }
});

test('failed peers stay in the roster through clock ticks, then stop after three delayed retries', async () => {
  const f = auditAudio();
  const peers = [{ seat: '0', session: 'unchanged-remote', speaker: true }];
  try {
    let attempts = 0; let errors = 0;
    f.audio.offer = async () => { attempts++; };
    f.audio.onError = () => errors++;
    // Each reconciliation represents a room tick (normally every 250 ms).
    for (let tick = 0; tick < 20; tick++) {
      f.audio.reconcile('1', 'local', true, peers);
      const pc = f.audio.peers.get('0').pc;
      pc.onicecandidateerror({ errorCode: 701, address: 'private-address', errorText: 'private-details' });
      pc.connectionState = 'failed'; pc.onconnectionstatechange();
      assert.equal(f.audio.peerCount, 1);
    }
    assert.equal(f.created.length, 1); assert.equal(attempts, 0);
    await f.advance(999); assert.equal(attempts, 0);
    await f.advance(1); assert.equal(attempts, 1);
    f.created[0].onconnectionstatechange();
    await f.advance(2999); assert.equal(attempts, 1);
    await f.advance(1); assert.equal(attempts, 2);
    f.created[0].onconnectionstatechange();
    await f.advance(7999); assert.equal(attempts, 2);
    await f.advance(1); assert.equal(attempts, 3);
    f.created[0].onconnectionstatechange();
    await f.advance(100000);
    assert.equal(attempts, 3); assert.equal(errors, 1); assert.equal(f.timers.size, 0);
    for (let tick = 0; tick < 20; tick++) f.audio.reconcile('1', 'local', true, peers);
    assert.equal(f.created.length, 1); assert.equal(f.audio.peers.get('0').exhausted, true);
    assert.equal(f.created[0].connectionState, 'closed');
    assert.equal(f.created[0].onicecandidateerror, null);
    assert.equal(f.audio.diagnostics.snapshot().filter(entry => entry.event === 'peer-connection' && entry.connection === 'failed').length, 23);
    const iceError = f.audio.diagnostics.snapshot().find(entry => entry.event === 'peer-ice-error');
    assert.equal(iceError.reason, '701');
    assert.equal('address' in iceError, false); assert.equal('errorText' in iceError, false);
  } finally { f.restore(); }
});

test('failed answering peers retain consumed offer identities and never replay the old mailbox', async () => {
  const f = auditAudio(); let answers = 0;
  const peers = [{ seat: '0', session: 'unchanged-remote', speaker: true }];
  const signal = { fromSession: 'unchanged-remote', toSession: 'local', offerId: 'retained-offer', type: 'offer', sdp: 'retained-sdp' };
  f.audio.attachTrack = async () => {};
  f.audio.publish = async () => { answers++; };
  function receiveOffer() {
    const peer = f.audio.peers.get('0');
    Object.assign(peer.pc, {
      setRemoteDescription: async () => {}, getTransceivers: () => [],
      setLocalDescription: async () => {}, createAnswer: async () => ({ type: 'answer' })
    });
    f.audio.receive('0', signal);
    return peer.queue;
  }
  try {
    f.audio.reconcile('1', 'local', true, peers); await receiveOffer();
    f.audio.receive('0', signal); await f.audio.peers.get('0').queue;
    assert.equal(answers, 1, 'same peer suppresses the duplicate');
    const pc = f.audio.peers.get('0').pc;
    pc.connectionState = 'failed'; pc.onconnectionstatechange();
    f.audio.reconcile('1', 'local', true, peers); await receiveOffer();
    assert.equal(answers, 1, 'failure must not forget a consumed offer');
  } finally { f.restore(); }
});

test('radio audit: a stable initiating peer ignores a replacement answer for its old offer', async () => {
  const audio = new RadioAudioService(); let applied = 0;
  audio.localSeat = '0'; audio.localSession = 'local';
  const peer = { session: 'remote', offerId: 'old-offer', remoteSdp: 'original-answer', queue: Promise.resolve(),
    pc: { signalingState: 'stable', setRemoteDescription: async () => { applied++; } } };
  audio.peers.set('1', peer);
  audio.receive('1', { fromSession: 'remote', toSession: 'local', offerId: 'old-offer', type: 'answer', sdp: 'replacement-answer' });
  await peer.queue;
  assert.equal(applied, 0);
  assert.equal(audio.peers.get('1'), peer);
});

function negotiatedPeer(f, seat = '1', remoteSeat = '0') {
  delete f.audio.offer;
  const fake = fakeContext(); f.audio.context = fake.context; f.audio.output = fake.context.createMediaStreamDestination();
  f.audio.reconcile(seat, 'local', true, [{ seat: remoteSeat, session: 'remote', speaker: true }]);
  return f.audio.peers.get(remoteSeat);
}
const offerSignal = (id, sdp = id) => ({ fromSession: 'remote', toSession: 'local', offerId: id, type: 'offer', sdp });

test('either side can recover: an answering peer sends a fresh ICE restart offer after failure', async () => {
  const f = auditAudio(); const signals = []; f.audio.onSignal = async (_, signal) => signals.push(signal);
  try {
    const peer = negotiatedPeer(f);
    f.audio.receive('0', offerSignal('initial')); await peer.queue;
    const previousId = peer.offerId;
    peer.pc.connectionState = 'failed'; peer.pc.onconnectionstatechange();
    await f.advance(1000); await peer.queue;
    assert.equal(f.created.length, 1);
    assert.notEqual(peer.offerId, previousId);
    assert.equal(signals.at(-1).type, 'offer'); assert.equal(signals.at(-1).offerId, peer.offerId);
    assert.deepEqual(peer.pc.offerOptions, [{ iceRestart: true }]);
    f.audio.receive('0', { ...offerSignal(previousId), type: 'answer', sdp: 'late-answer' }); await peer.queue;
    assert.equal(peer.pc.signalingState, 'have-local-offer', 'late answer cannot resolve the new offer');
    f.audio.receive('0', { ...offerSignal(peer.offerId), type: 'answer', sdp: 'fresh-answer' }); await peer.queue;
    assert.equal(peer.pc.signalingState, 'stable');
  } finally { f.restore(); }
});

test('a lower-seat peer accepts a fresh offer from its recovering answering peer', async () => {
  const f = auditAudio(); const signals = []; f.audio.onSignal = async (_, signal) => signals.push(signal);
  try {
    const peer = negotiatedPeer(f, '0', '1'); await peer.queue;
    peer.pc.signalingState = 'stable'; peer.pc.connectionState = 'connected';
    f.audio.receive('1', offerSignal('remote-recovery')); await peer.queue;
    assert.equal(signals.at(-1).type, 'answer'); assert.equal(signals.at(-1).offerId, 'remote-recovery');
    assert.equal(f.audio.peers.get('1'), peer);
  } finally { f.restore(); }
});

test('colliding offers are deterministic: the higher seat rolls back, the lower seat retains its offer', async () => {
  for (const seat of ['0', '1']) {
    const f = auditAudio(); const remoteSeat = seat === '0' ? '1' : '0'; const signals = [];
    f.audio.onSignal = async (_, signal) => signals.push(signal);
    try {
      const peer = negotiatedPeer(f, seat, remoteSeat); await peer.queue;
      peer.offerId = 'own-offer'; peer.pc.signalingState = 'have-local-offer';
      f.audio.receive(remoteSeat, offerSignal('colliding-offer')); await peer.queue;
      const rollback = peer.pc.descriptions.some(description => description.type === 'rollback');
      assert.equal(rollback, seat === '1');
      assert.equal(peer.offerId, seat === '1' ? 'colliding-offer' : 'own-offer');
      assert.equal(signals.at(-1)?.type, seat === '1' ? 'answer' : 'offer');
    } finally { f.restore(); }
  }
});

test('incoming offers are deduplicated by identity and bounded even when SDP changes', async () => {
  const f = auditAudio(); let answers = 0;
  f.audio.onSignal = async (_, signal) => { if (signal.type === 'answer') answers++; };
  try {
    const peer = negotiatedPeer(f);
    f.audio.receive('0', offerSignal('one')); await peer.queue;
    f.audio.receive('0', offerSignal('one', 'changed-sdp')); await peer.queue;
    assert.equal(answers, 1);
    for (const id of ['two', 'three', 'four', 'five', 'six']) { f.audio.receive('0', offerSignal(id)); await peer.queue; }
    assert.equal(answers, 4); assert.equal(peer.offers.size, 4);
    f.audio.receive('0', { ...offerSignal('wrong-session'), fromSession: 'other-session' }); await peer.queue;
    assert.equal(peer.offers.size, 4);
  } finally { f.restore(); }
});

test('brief disconnects recover without an offer; successful connections do not reset the retry budget', async () => {
  const f = auditAudio(); let attempts = 0;
  f.audio.offer = async () => attempts++;
  try {
    f.audio.reconcile('1', 'local', true, [{ seat: '0', session: 'remote', speaker: true }]);
    const peer = f.audio.peers.get('0');
    peer.pc.connectionState = 'disconnected'; peer.pc.onconnectionstatechange();
    await f.advance(4999); assert.equal(attempts, 0);
    peer.pc.connectionState = 'connected'; peer.pc.onconnectionstatechange();
    await f.advance(1); assert.equal(attempts, 0);
    peer.pc.connectionState = 'failed'; peer.pc.onconnectionstatechange();
    await f.advance(1000); assert.equal(attempts, 1);
    peer.pc.connectionState = 'connected'; peer.pc.onconnectionstatechange();
    peer.pc.connectionState = 'failed'; peer.pc.onconnectionstatechange();
    await f.advance(1000); assert.equal(attempts, 1);
    await f.advance(2000); assert.equal(attempts, 2); assert.equal(peer.retries, 2);
  } finally { f.restore(); }
});

test('negotiation stalls exhaust their watchdog budget instead of waiting or retrying forever', async () => {
  const f = auditAudio(); let attempts = 0;
  f.audio.offer = async () => attempts++;
  try {
    f.audio.reconcile('1', 'local', true, [{ seat: '0', session: 'remote', speaker: true }]);
    await f.advance(112000);
    assert.equal(attempts, 3); assert.equal(f.audio.peers.get('0').exhausted, true);
    assert.equal(f.timers.size, 0);
  } finally { f.restore(); }
});

test('departure cancels recovery while a healthy neighboring transport stays intact', async () => {
  const f = auditAudio(); let attempts = 0;
  f.audio.offer = async () => attempts++;
  const peers = [{ seat: '0', session: 'remote', speaker: true }, { seat: '2', session: 'other', speaker: true }];
  try {
    f.audio.reconcile('1', 'local', true, peers); await settle();
    const failed = f.audio.peers.get('0'); const healthy = f.audio.peers.get('2');
    healthy.pc.connectionState = 'connected'; healthy.pc.onconnectionstatechange();
    attempts = 0;
    failed.pc.connectionState = 'failed'; failed.pc.onconnectionstatechange();
    f.audio.reconcile('1', 'local', true, [peers[1]]);
    await f.advance(100000);
    assert.equal(attempts, 0); assert.equal(f.audio.peers.get('2'), healthy);
    assert.equal(healthy.pc.connectionState, 'connected'); assert.equal(f.timers.size, 0);
  } finally { f.restore(); }
});

test('session replacement cancels pending retries and makes delayed negotiation work inert', async () => {
  const f = auditAudio(); const signals = []; let finish;
  f.audio.onSignal = async (_, signal) => signals.push(signal);
  try {
    const peer = negotiatedPeer(f); f.audio.attachTrack = () => new Promise(resolve => finish = resolve);
    peer.pc.connectionState = 'failed'; peer.pc.onconnectionstatechange();
    await f.advance(1000);
    const pending = peer.queue;
    f.audio.reconcile('1', 'replacement-local', true, []);
    finish(); await pending; await f.advance(100000);
    assert.equal(signals.length, 0); assert.equal(f.timers.size, 0); assert.equal(f.audio.peerCount, 0);
  } finally { f.restore(); }
});

test('temporary presence gaps cannot renew retries or repeatedly create exhausted transports', async () => {
  const f = auditAudio(); let offers = 0; f.audio.offer = async () => offers++;
  const remote = { seat: '0', session: 'remote', speaker: true };
  try {
    f.audio.reconcile('1', 'local', true, [remote]);
    for (let gap = 0; gap < 20; gap++) {
      f.audio.reconcile('1', 'local', true, []);
      f.audio.reconcile('1', 'local', true, [remote]);
    }
    await f.advance(100000);
    assert.equal(f.created.length, 4, 'initial transport plus at most three recovery transports');
    assert.equal(offers, 0, 'canceled retries cannot publish after departure');
    assert.equal(f.audio.peers.get('0').exhausted, true);
    assert.equal(f.audio.history.size, 1); assert.equal(f.timers.size, 0);
    f.audio.reconcile('1', 'local', true, [{ ...remote, session: 'new-remote' }]);
    assert.equal(f.created.length, 5); assert.equal(f.audio.peers.get('0').retries, 0);
    assert.equal(f.audio.history.size, 1, 'only latest session per fixed seat is retained');
  } finally { f.restore(); }
});

test('radio diagnostics retain only 200 local metadata events and return detached snapshots', () => {
  const log = new diagnostics.RadioDiagnostics();
  for (let index = 0; index < 205; index++) log.record('peer-connection', { peerSeat: String(index) });
  const snapshot = log.snapshot();
  assert.equal(snapshot.length, 200);
  assert.equal(snapshot[0].peerSeat, '5');
  assert.equal(snapshot.at(-1).peerSeat, '204');
  assert.ok(Number.isFinite(Date.parse(snapshot[0].at)));
  snapshot[0].peerSeat = 'changed'; snapshot.pop();
  assert.equal(log.snapshot()[0].peerSeat, '5'); assert.equal(log.snapshot().length, 200);
});

test('radio diagnostic console capture is opt-in and limited to 200 events per instance', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const info = console.info; const output = [];
  console.info = (...args) => output.push(args);
  try {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null } });
    new diagnostics.RadioDiagnostics().record('disabled');
    assert.equal(output.length, 0);
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => '1' } });
    const log = new diagnostics.RadioDiagnostics();
    for (let index = 0; index < 205; index++) log.record('peer-ice', { ice: 'checking' });
    assert.equal(output.length, 200);
    assert.equal(output[0][0], '[Team Radio]');
    assert.deepEqual(Object.keys(output[0][1]).sort(), ['at', 'event', 'ice']);
  } finally {
    console.info = info;
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original); else delete globalThis.sessionStorage;
  }
});
