import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, beforeEach, test } from 'node:test';
import firebase from 'firebase/compat/app';
import 'firebase/compat/database';

// Deliberately refuse all non-local targets, including production database URLs.
const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9001';
assert.match(host, /^(127\.0\.0\.1|localhost):\d+$/);
const namespace = `demo-team-radio-rules-${process.pid}`;
function token(uid) {
  const base64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${base64({ alg: 'none', typ: 'JWT' })}.${base64({ sub: uid, user_id: uid, aud: 'demo-team-radio', iss: 'https://securetoken.google.com/demo-team-radio', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600, firebase: { sign_in_provider: 'custom', identities: {} } })}.`;
}
async function request(path, method = 'GET', data, uid, headers = {}) {
  const url = new URL(`http://${host}/${path}.json`); url.searchParams.set('ns', namespace);
  if (uid && uid !== 'owner') url.searchParams.set('auth', token(uid));
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(uid === 'owner' ? { Authorization: 'Bearer owner' } : {}), ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: response.status, data: await response.json(), etag: response.headers.get('etag') };
}
const path = suffix => `teamRadio/team/${suffix}`;
async function allow(suffix, value, uid) { const result = await request(path(suffix), 'PUT', value, uid); assert.equal(result.status, 200, JSON.stringify(result.data)); }
async function deny(suffix, value, uid) { const result = await request(path(suffix), 'PUT', value, uid); assert.equal(result.status, 401, JSON.stringify(result.data)); }
const connection = (session, online = true) => ({ session, online, at: { '.sv': 'timestamp' }, muted: false, ready: online });
const claim = (uid, seat) => ({ [`seats/${seat}`]: { uid, name: uid }, [`presence/${seat}`]: connection(`session-${uid}`) });
const cleanup = (seat, session, speaker) => ({ [`seats/${seat}`]: null, [`presence/${seat}`]: connection(session, false), ...(speaker === undefined ? {} : { [`speakers/${speaker}`]: null }) });
async function patch(value, uid, status = 200) { const result = await request('teamRadio/team', 'PATCH', value, uid); assert.equal(result.status, status, JSON.stringify(result.data)); }
async function seed() {
  const seats = {}; const speakers = {}; const presence = {};
  for (let i = 0; i < 10; i++) { seats[i] = { uid: `user${i}`, name: `User ${i}` }; presence[i] = { session: `session${i}`, online: true, at: Date.now(), muted: false, ready: true }; }
  for (let i = 0; i < 3; i++) speakers[i] = { uid: `user${i}`, seat: String(i) };
  await request('teamRadio/team', 'PUT', { seats, speakers, presence }, 'owner');
}
const floor = (i, extra = {}) => { const now = Date.now() - 25; return { uid: `user${i}`, seat: String(i), session: `session${i}`, token: `token${i}`, startedAt: now, expiresAt: now + 30000, ...extra }; };
before(async () => {
  const result = await request('.settings/rules', 'PUT', JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url))), 'owner');
  assert.equal(result.status, 200, JSON.stringify(result.data));
});
beforeEach(seed);
test('signed-out reads/writes and unrelated database paths remain denied', async () => {
  assert.equal((await request(path('seats'))).status, 401);
  await deny('seats/0', { uid: 'user0', name: 'Fake' });
  assert.equal((await request('unrelated', 'PUT', true, 'user0')).status, 401);
  assert.equal((await request(path('seats'), 'GET', undefined, 'user9')).status, 200);
});
test('ten fixed participant places, ownership, unique accounts and bounded data are enforced', async () => {
  await deny('seats/10', { uid: 'extra', name: 'Eleventh' }, 'extra');
  await deny('seats/0', null, 'user1');
  await deny('seats/0', { uid: 'user1', name: 'Impersonation' }, 'user0');
  await deny('seats/0', { uid: 'user0', name: 'a'.repeat(81) }, 'user0');
  await deny('seats/0', { uid: 'user0', name: 'Alex', extra: true }, 'user0');
  await allow('seats/9', null, 'user9');
  await deny('seats/9', { uid: 'user0', name: 'Duplicate' }, 'user0');
  await deny('seats/9', { uid: 'extra', name: 'Replacement' }, 'extra');
  await patch(claim('extra', '9'), 'extra');
});
test('only three speaking places, held by unique reserved accounts', async () => {
  await deny('speakers/3', { uid: 'user3', seat: '3' }, 'user3');
  await deny('speakers/0', null, 'user3');
  await allow('speakers/2', null, 'user2');
  await deny('speakers/2', { uid: 'user0', seat: '0' }, 'user0');
  await deny('speakers/2', { uid: 'user3', seat: '7' }, 'user3');
  await allow('speakers/2', { uid: 'user3', seat: '3' }, 'user3');
});
test('a simultaneous claim has one winner; the loser cannot overwrite the place', async () => {
  await allow('seats/9', null, 'user9');
  const results = await Promise.all(['newA','newB'].map(uid => request('teamRadio/team', 'PATCH', claim(uid, '9'), uid)));
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.equal(results.filter(result => result.status === 401).length, 1);
});
test('transmission requires a speaking place and live owned connection; concurrent speakers are rejected', async () => {
  await deny('floor', floor(3), 'user3');
  await deny('floor', floor(0, { uid: 'user1' }), 'user0');
  await deny('floor', floor(0, { session: 'invented' }), 'user0');
  await deny('floor', floor(0, { expiresAt: Date.now() + 60000 }), 'user0');
  await allow('floor', floor(0), 'user0');
  await deny('floor', floor(1), 'user1');
  await deny('floor', null, 'user1');
  await allow('floor', null, 'user0');
  await allow('floor', floor(1), 'user1');
});
test('atomic exit frees both places and invalidates transmission', async () => {
  await allow('floor', floor(0), 'user0');
  await patch(cleanup('0', 'session0', '0'), 'user0');
  await allow('floor', floor(1), 'user1');
  assert.equal((await request(path('seats/0'), 'GET', undefined, 'user1')).data, null);
  assert.equal((await request(path('speakers/0'), 'GET', undefined, 'user1')).data, null);
  await patch(claim('replacement', '0'), 'replacement');
});
test('only stale places can be reclaimed by another signed-in user, including their speaking place', async () => {
  await patch({ 'seats/0': null, 'speakers/0': null }, 'user9', 401);
  await request(path('presence/0/at'), 'PUT', Date.now() - 21000, 'owner');
  await patch({ 'seats/0': null }, 'user9', 401);
  await patch({ 'seats/0': null, 'speakers/0': null }, 'user9');
  assert.equal((await request(path('seats/1'), 'GET', undefined, 'user9')).data.uid, 'user1');
  await request(path('presence/1/at'), 'PUT', Date.now() - 21000, 'owner');
  await allow('presence/1', connection('session1'), 'user1');
  await patch({ 'seats/1': null, 'speakers/1': null }, 'user9', 401);
});
test('an old session cannot atomically remove a replacement session or either of its places', async () => {
  await allow('presence/0', connection('replacement'), 'user0');
  await patch(cleanup('0', 'session0', '0'), 'user0', 401);
  assert.equal((await request(path('seats/0'), 'GET', undefined, 'user1')).data.uid, 'user0');
  assert.equal((await request(path('speakers/0'), 'GET', undefined, 'user1')).data.uid, 'user0');
  await patch(cleanup('0', 'replacement', '0'), 'user0');
});
test('orphan speaking places can be recovered without affecting active places', async () => {
  await request(path('seats/0'), 'PUT', null, 'owner');
  await allow('speakers/0', null, 'user9');
  await deny('speakers/1', null, 'user9');
});
test('presence is owner-only, bounded and protected from a superseded tab disconnect', async () => {
  const connection = { session: 'session0', online: true, at: { '.sv': 'timestamp' }, ready: true, muted: false };
  await deny('presence/0', connection, 'user1');
  await deny('presence/0', { ...connection, at: 1 }, 'user0');
  await deny('presence/0', { ...connection, extra: true }, 'user0');
  await allow('presence/0', { ...connection, session: 'replacement' }, 'user0');
  await deny('presence/0', { ...connection, online: false }, 'user0');
  assert.equal((await request(path('presence/0'), 'GET', undefined, 'user1')).data.session, 'replacement');
  await allow('presence/0', { ...connection, session: 'replacement', online: false }, 'user0');
});
test('signaling is private to its recipient, sender-owned, session-bound and size-bounded', async () => {
  const signal = { fromSession: 'session0', toSession: 'session1', offerId: 'offer', type: 'offer', sdp: 'test sdp' };
  await allow('signals/1/0', signal, 'user0');
  assert.equal((await request(path('signals/1'), 'GET', undefined, 'user1')).status, 200);
  assert.equal((await request(path('signals/1'), 'GET', undefined, 'user2')).status, 401);
  await deny('signals/1/0', signal, 'user2');
  await deny('signals/1/0', { ...signal, fromSession: 'old' }, 'user0');
  await deny('signals/1/0', { ...signal, sdp: 'x'.repeat(65537) }, 'user0');
  await allow('signals/1/0', null, 'user1');
});

test('multi-path writes cannot claim duplicate participant or speaker places or abandon a speaking place', async () => {
  const duplicateSeats = await request('teamRadio/team', 'PATCH', { 'seats/8': null, 'seats/9': null }, 'owner');
  assert.equal(duplicateSeats.status, 200);
  await patch({ ...claim('new', '8'), ...claim('new', '9') }, 'new', 401);
  await request('teamRadio/team/speakers', 'PUT', null, 'owner');
  assert.equal((await request('teamRadio/team/speakers', 'PATCH', { 0: { uid: 'user0', seat: '0' }, 1: { uid: 'user0', seat: '0' } }, 'user0')).status, 401);
  await allow('speakers/0', { uid: 'user0', seat: '0' }, 'user0');
  await deny('seats/0', null, 'user0');
  assert.equal((await request('teamRadio/team', 'PATCH', { 'seats/0': null, 'speakers/0': null }, 'user0')).status, 200);
});

test('Firebase disconnect marks only its session offline; stale recovery frees both places', { timeout: 15000 }, async () => {
  const app = firebase.initializeApp({ projectId: 'demo-team-radio', databaseURL: `https://${namespace}.firebaseio.com` }, `disconnect-${Date.now()}`);
  const database = app.database();
  const [hostname, port] = host.split(':');
  database.useEmulator(hostname, Number(port), { mockUserToken: { sub: 'user0', user_id: 'user0' } });
  try {
    await database.ref('teamRadio/team/presence/0').onDisconnect().set(connection('session0', false));
    database.goOffline();
    let offline = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const presence = await request(path('presence/0'), 'GET', undefined, 'user1');
      if (presence.data.online === false) { offline = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(offline, true, 'server marked the disconnected session offline');
    await patch({ 'seats/0': null, 'speakers/0': null }, 'user1', 401);
    await request(path('presence/0/at'), 'PUT', Date.now() - 21000, 'owner');
    await patch({ 'seats/0': null, 'speakers/0': null }, 'user1');
    assert.equal((await request(path('seats/0'), 'GET', undefined, 'user1')).data, null);
    assert.equal((await request(path('speakers/0'), 'GET', undefined, 'user1')).data, null);
    assert.equal((await request(path('seats/1'), 'GET', undefined, 'user1')).data.uid, 'user1');
  } finally { await app.delete(); }
});

test('a registered old disconnect cannot mark a newer session offline', { timeout: 15000 }, async () => {
  const app = firebase.initializeApp({ projectId: 'demo-team-radio', databaseURL: `https://${namespace}.firebaseio.com` }, `takeover-${Date.now()}`);
  const database = app.database(); const [hostname, port] = host.split(':');
  database.useEmulator(hostname, Number(port), { mockUserToken: { sub: 'user0', user_id: 'user0' } });
  try {
    await database.ref('teamRadio/team/presence/0').onDisconnect().set(connection('session0', false));
    await allow('presence/0', connection('replacement'), 'user0');
    database.goOffline();
    await new Promise(resolve => setTimeout(resolve, 200));
    const current = (await request(path('presence/0'), 'GET', undefined, 'user1')).data;
    assert.equal(current.session, 'replacement'); assert.equal(current.online, true);
    assert.equal((await request(path('seats/0'), 'GET', undefined, 'user1')).data.uid, 'user0');
  } finally { await app.delete(); }
});
