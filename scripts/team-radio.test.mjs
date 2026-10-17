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
test('reservations survive offline status, while audio ownership requires a live speaker session', () => {
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
test('configured key ignores repeats, modifier shortcuts and text/control interaction', () => {
  const key = { code: 'KeyR', repeat: false, target: { closest: () => null } };
  assert.equal(state.acceptsTalkKey(key, 'KeyR'), true);
  for (const update of [{ repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { code: 'Space' }, { target: { closest: () => ({}) } }]) {
    assert.equal(state.acceptsTalkKey({ ...key, ...update }, 'KeyR'), false);
  }
});
function service(data = room()) {
  const authState = new Subject();
  let storedFloor = data.floor;
  let delayed;
  let transmitted = 0;
  const ref = {
    child: () => ref, limitToFirst: () => ref,
    on: () => () => {}, off() {}, remove: async () => {},
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
  return { radio, authState, get storedFloor() { return storedFloor; }, get transmitted() { return transmitted; },
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
