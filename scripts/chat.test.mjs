import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';

const require = createRequire(import.meta.url);
function load(path, overrides = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, name => overrides[name] || (name.startsWith('../voice/') || name === './chatVoice.service' ? {} : require(name)));
  return exports;
}
const funds = load('../src/app/chat/chat-fund/chatFund.ts');
const events = load('../src/app/chat/chat-event/chatEvent.ts');
const dates = load('../src/app/chat/chatDate.ts');
const transfers = load('../src/app/chat/chatTransfer.ts');
const credits = load('../src/app/chat/chatTimeCredits.ts');
const model = load('../src/app/chat/chatData.ts', { './chatDate': dates, './chatTransfer': transfers, './chatTimeCredits': credits });
const core = { Injectable: () => target => target, runInInjectionContext: (_, fn) => fn() };
const { ChatDataService } = load('../src/app/chat/chatData.service.ts', {
  '@angular/core': core, './chatData': model, './chat-event/chatEvent': events, './chat-fund/chatFund': funds
});

function fixture(uid = 'owner') {
  const writes = [], uploads = [], queries = [], cursors = [], cursorWrites = [], transactionPaths = [];
  const cursorStore = { record: { serverTimestamp: { seconds: 20 }, messageId: 'read', blueFlag: true } };
  const rows = [
    { id: 'latest', data: { chain: 'chat', user: 'owner', name: 'Nico', text: 'Latest', serverTimestamp: { seconds: 30 }, lastMessage: true, chatSubject: 'Design', recipientList: ['owner', 'other'], recipients: { other: { name: 'Maya' } }, wallet: { balance: 123 }, source: 'private ledger' } },
    { id: 'earlier', data: { user: 'other', name: 'Maya', text: 'Earlier', serverTimestamp: { seconds: 10 }, chatImageUrlThumb: 'thumb', chatImageUrlOriginal: 'original' } }
  ].map(row => ({ payload: { doc: { id: row.id, data: () => row.data } } }));
  const auth = { authState: of(uid ? { uid } : null), currentUser: Promise.resolve(uid ? { uid, getIdTokenResult: async () => ({ claims: { sub: uid, perrinnAdmin: true } }) } : null) };
  const afs = {
    firestore: {
      doc: path => { transactionPaths.push(path); return path; },
      runTransaction: async fn => fn({
        get: async () => ({ data: () => cursorStore.record }),
        set: (path, fields, options) => {
          cursorWrites.push({ path, fields, options });
          cursorStore.record = { ...cursorStore.record, ...fields, serverTimestamp: { seconds: fields.serverTimestamp.getTime() / 1000 } };
        }
      })
    },
    collection: (path, build) => {
      const query = { where: (...args) => { queries.push(['where', ...args]); return query; }, orderBy: (...args) => { queries.push(['orderBy', ...args]); return query; }, limit: n => { queries.push(['limit', n]); return query; } };
      assert.equal(path, 'PERRINNMessages'); build(query);
      return { snapshotChanges: () => of(rows) };
    },
    doc: path => { cursors.push(path); return { get: () => of({ data: () => ({ serverTimestamp: { seconds: 20 } }) }) }; }
  };
  const storage = { ref: path => ({ put: async file => uploads.push({ path, file }), getDownloadURL: () => of('https://example.com/image.png') }) };
  const UI = { currentUser: uid, createMessage: async message => { writes.push(message); return { id: `created-${writes.length}` }; } };
  return { service: new ChatDataService(afs, auth, storage, {}, UI), UI, auth, writes, uploads, queries, cursors, cursorWrites, cursorStore, transactionPaths, rows };
}

test('matches the bounded production chain query, reverses history and reads only the owner cursor', async () => {
  const f = fixture();
  const chat = await firstValueFrom(f.service.watch('chat', 15));
  assert.deepEqual(f.queries, [['where', 'chain', '==', 'chat'], ['orderBy', 'serverTimestamp', 'desc'], ['limit', 15]]);
  assert.deepEqual(f.cursors, ['lastSeen/owner/chats/chat']);
  assert.deepEqual(chat.messages.map(row => row.id), ['earlier', 'latest']);
  assert.equal(chat.unreadId, 'latest'); assert.equal(chat.title, 'Design');
  assert.equal(chat.messages[1].own, true); assert.equal(chat.messages[1].author, 'You');
  assert.equal(chat.messages[0].originalImage, 'original');
  assert.equal('wallet' in chat.messages[1], false); assert.equal('source' in chat.messages[1], false);
  assert.equal(chat.members[0].name, 'You'); assert.equal(chat.members[1].name, 'Maya');
  assert.deepEqual(f.writes, []);
});

test('signed-out viewing does not read a private cursor or treat an absent author as the current user', async () => {
  const f = fixture(null);
  const chat = await firstValueFrom(f.service.watch('chat', 30));
  assert.deepEqual(f.cursors, []); assert.equal(chat.signedIn, false); assert.equal(chat.unreadId, '');
  assert.equal(model.bubbleMessage('legacy', {}, null).own, false);
  assert.equal(model.timestampMillis(123), 123); assert.equal(model.timestampMillis({ toMillis: () => 456 }), 456);
});

test('text and image sends retain the exact production message/upload contract', async () => {
  const f = fixture();
  await f.service.send('chat', { text: ' Hello ', image: null });
  assert.deepEqual(f.writes[0], { text: 'Hello', chain: 'chat', chatImageTimestamp: null, chatImageUrlThumb: null, chatImageUrlMedium: null, chatImageUrlOriginal: null });
  const image = { name: 'Design view.png', type: 'image/png', size: 100 };
  await f.service.send('chat', { text: '', image });
  assert.match(f.uploads[0].path, /^images\/\d{13}-Design_view\.png$/);
  assert.equal(f.writes[1].chatImageTimestamp, f.uploads[0].path.slice(7, 20));
  for (const field of ['chatImageUrlThumb', 'chatImageUrlMedium', 'chatImageUrlOriginal']) assert.equal(f.writes[1][field], 'https://example.com/image.png');
  assert.deepEqual(Object.keys(f.writes[1]).sort(), Object.keys(f.writes[0]).sort());
});

test('rejects unauthenticated, mismatched-account, overlong and invalid-image sends before uploads or writes', async () => {
  for (const uid of [null, 'owner']) {
    const f = fixture(uid); f.UI.currentUser = 'different';
    await assert.rejects(f.service.send('chat', { text: 'Hello', image: null }));
    assert.deepEqual(f.writes, []); assert.deepEqual(f.uploads, []);
  }
  const f = fixture();
  await assert.rejects(f.service.send('chat', { text: 'x'.repeat(501), image: null }));
  await assert.rejects(f.service.send('chat', { text: '', image: { type: 'image/svg+xml', size: 10 } }));
  await assert.rejects(f.service.send('chat', { text: '', image: { type: 'image/png', size: 16 * 1024 * 1024 } }));
  assert.deepEqual(f.writes, []); assert.deepEqual(f.uploads, []);
});

test('a storage failure prevents message creation and leaves the draft available to retry', async () => {
  const f = fixture(); const draft = { text: 'Keep my draft', image: { name: 'image.png', type: 'image/png', size: 10 } };
  f.service.storage.ref = () => ({ put: async () => { throw new Error('offline'); } });
  await assert.rejects(f.service.send('chat', draft), /offline/);
  assert.deepEqual(f.writes, []); assert.equal(draft.text, 'Keep my draft'); assert.ok(draft.image);
});

test('the composer retains text until the consumer confirms a successful send', () => {
  class Emitter { values = []; emit(value) { this.values.push(value); } }
  const decorator = () => () => {};
  const { ChatComposerComponent } = load('../src/app/chat/chat-composer/chat-composer.component.ts', {
    '../chatData': model,
    '@angular/core': { Component: () => target => target, Input: decorator, Output: decorator, ViewChild: decorator, EventEmitter: Emitter }
  });
  const composer = new ChatComposerComponent();
  composer.draft = 'Keep this until saved'; composer.send();
  assert.equal(composer.messageSent.values.length, 1); assert.equal(composer.draft, 'Keep this until saved');
  composer.disabled = true; composer.send(); assert.equal(composer.messageSent.values.length, 1);
  composer.clearDraft(); assert.equal(composer.draft, '');
});

test('chat paste selects the image draft, preserves invalid replacements, and respects editor guards', () => {
  assert.equal(model.chatImageError({ name: 'converted.HEIC', type: 'image/jpeg', size: 100 }), '');
  const { ChatComponent } = load('../src/app/chat/chat.component.ts', {
    '@angular/core': { Component: () => target => target, ViewChild: () => () => {} },
    './chatRead.service': {}, './chat-event/chat-event-editor.component': {}, './chat-fund/chat-fund-editor.component': {},
    './chat-composer/chat-composer.component': {}, './chatData': model
  });
  const component = new ChatComponent({ paramMap: of() }, {}, {}, {}, { run: fn => fn() }, {}, {}, { mode: 'text' });
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL, revoked = [];
  const originalFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = fn => fn();
  URL.createObjectURL = file => 'blob:' + file.name; URL.revokeObjectURL = url => revoked.push(url);
  const file = { name: 'photo.png', type: 'image/png', size: 100 };
  const paste = (image = file, filesOnly = false) => ({ defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, clipboardData: {
      items: filesOnly ? [] : [{ type: image.type, getAsFile: () => image }], files: filesOnly ? [image] : []
    } });
  try {
    Object.assign(component, { signedIn: true, editingDetails: true });
    const event = paste(); component.onPaste(event);
    assert.equal(event.defaultPrevented, true); assert.equal(component.imagePreview, 'blob:photo.png');
    component.onPaste(paste({ ...file, size: 16 * 1024 * 1024 }));
    assert.match(component.detailsError, /15 MB/); assert.equal(component.detailsImage, file);
    component.onPaste(paste({ ...file, name: 'phone.HEIC', type: 'image/heic' }));
    assert.match(component.detailsError, /HEIC/); assert.equal(component.detailsImage, file);
    component.onPaste(paste({ ...file, name: 'second.png' }, true));
    assert.deepEqual(revoked, ['blob:photo.png']); assert.equal(component.detailsError, '');
    component.savingDetails = true; component.onPaste(paste());
    assert.equal(component.imagePreview, 'blob:second.png');
    component.savingDetails = false; component.signedIn = false; component.onPaste(paste());
    assert.equal(component.imagePreview, 'blob:second.png');
    component.signedIn = true;
    const text = paste({ type: 'text/plain' }); component.onPaste(text); assert.equal(text.defaultPrevented, false);
    component.cancelDetailsEdit(); assert.equal(component.imagePreview, '');
    let forwarded = 0; component.composer = { onPaste: () => forwarded++ };
    component.onPaste(paste()); assert.equal(forwarded, 1);
    component.voice.mode = 'voice'; component.onPaste(paste()); assert.equal(forwarded, 1);
    component.voice.keyboard = true; component.onPaste(paste()); assert.equal(forwarded, 2);
  } finally { component.ngOnDestroy(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; globalThis.requestAnimationFrame = originalFrame; }
});

const { sidebarChatCommands, activeChatChain } = load('../src/app/chatNavigation.ts');

test('sidebar chat routing always uses the canonical production route', () => {
  assert.deepEqual(sidebarChatCommands('next'), ['/chat', 'next']);
});

test('sidebar selection recognizes production chat IDs without query or fragment suffixes', () => {
  assert.equal(activeChatChain('/chat/one?scroll=message'), 'one');
  assert.equal(activeChatChain('/chat/two#message'), 'two');
  assert.equal(activeChatChain('/chat/a%20b'), 'a b');
  assert.equal(activeChatChain('/chat'), null);
  assert.equal(activeChatChain('/prototypes/chat-bubbles/two'), null);
  assert.equal(activeChatChain('/home'), null);
});

test('sender groups stay within five minutes and reset at sender, date, unread and unresolved timestamps', () => {
  const base = { ...model.bubbleMessage('first', { user: 'one' }, null), timestamp: new Date(2026, 9, 16, 9).getTime() };
  const next = { ...base, id: 'next', timestamp: base.timestamp + 5 * 60 * 1000 };
  assert.equal(model.continuesMessageGroup(base, next, ''), true);
  assert.equal(model.continuesMessageGroup(undefined, next, ''), false);
  assert.equal(model.continuesMessageGroup(base, { ...next, user: 'two' }, ''), false);
  assert.equal(model.continuesMessageGroup(base, next, 'next'), false);
  assert.equal(model.continuesMessageGroup(base, { ...next, timestamp: new Date(2026, 9, 17, 9).getTime() }, ''), false);
  assert.equal(model.continuesMessageGroup({ ...base, user: '' }, { ...next, user: '' }, ''), false);
  assert.equal(model.continuesMessageGroup(base, { ...next, timestamp: next.timestamp + 1 }, ''), false);
  assert.equal(model.continuesMessageGroup(base, { ...next, timestamp: base.timestamp - 1 }, ''), false);
  assert.equal(model.continuesMessageGroup({ ...base, timestamp: 0 }, { ...next, timestamp: 0 }, ''), false);
  assert.equal(model.continuesMessageGroup(base, { ...next, timestamp: base.timestamp }, ''), true);
  const late = { ...base, timestamp: new Date(2026, 9, 16, 23, 59).getTime() };
  assert.equal(model.continuesMessageGroup(late, { ...next, timestamp: late.timestamp + 2 * 60 * 1000 }, ''), false);
});

test('subject changes use the existing command message without image fields', async () => {
  const f = fixture();
  await f.service.updateDetails('chat', { subject: ' Updated design ' });
  assert.deepEqual(f.writes, [{ chain: 'chat', text: 'Changing subject to Updated design', chatSubject: 'Updated design' }]);
  assert.deepEqual(f.uploads, []);
});

test('photo changes preserve production image propagation and a combined edit is one message', async () => {
  for (const subject of [undefined, 'Design review']) {
    const f = fixture();
    await f.service.updateDetails('chat', { ...(subject ? { subject } : {}), image: { name: 'Team.png', type: 'image/png', size: 100 } });
    assert.equal(f.writes.length, 1); assert.equal(f.uploads.length, 1);
    const message = f.writes[0];
    assert.equal(message.chatProfileImageTimestamp, message.chatImageTimestamp);
    for (const key of ['chatProfileImageUrlThumb', 'chatProfileImageUrlMedium', 'chatProfileImageUrlOriginal']) assert.equal(message[key], 'https://example.com/image.png');
    assert.equal(message.chatSubject, subject);
    if (!subject) { assert.equal('chatSubject' in message, false); assert.equal(message.text, 'Changing chat profile image'); }
  }
});

test('detail updates validate before writes and reject an account change during upload', async () => {
  for (const changes of [{}, { subject: '' }, { subject: ' '.repeat(3) }, { subject: 'x'.repeat(61) }, { image: { type: 'image/svg+xml', size: 10 } }]) {
    const f = fixture();
    await assert.rejects(f.service.updateDetails('chat', changes));
    assert.deepEqual(f.writes, []); assert.deepEqual(f.uploads, []);
  }
  const f = fixture();
  f.service.storage.ref = () => ({ put: async () => { f.auth.currentUser = Promise.resolve({ uid: 'different' }); }, getDownloadURL: () => of('https://example.com/image.png') });
  await assert.rejects(f.service.updateDetails('chat', { image: { name: 'Team.png', type: 'image/png', size: 100 } }));
  assert.deepEqual(f.writes, []);
  const signedOut = fixture(null);
  await assert.rejects(signedOut.service.updateDetails('chat', { subject: 'Design' }));
  assert.deepEqual(signedOut.writes, []);
});

test('failed detail saves retain the subject and image draft for retry', async () => {
  const decorator = () => () => {};
  const { ChatComponent } = load('../src/app/chat/chat.component.ts', {
    '@angular/core': { Component: () => target => target, ViewChild: decorator },
    './chatRead.service': { ChatReadService: class {} },
    './chat-event/chat-event-editor.component': { ChatEventEditorComponent: class {} },
    './chat-fund/chat-fund-editor.component': { ChatFundEditorComponent: class {} },
    './chat-composer/chat-composer.component': { ChatComposerComponent: class {} },
    './chatData': model
  });
  const route = { paramMap: of() };
  const component = new ChatComponent(route, {}, { updateDetails: async () => { throw new Error('offline'); } }, {}, { run: fn => fn() });
  Object.assign(component, { chain: 'chat', signedIn: true, editingDetails: true, title: 'Design', originalSubject: 'Design', subjectDraft: 'Review', detailsImage: { name: 'Team.png' } });
  await component.saveDetails();
  assert.equal(component.editingDetails, true); assert.equal(component.subjectDraft, 'Review'); assert.ok(component.detailsImage);
  assert.equal(component.savingDetails, false); assert.match(component.detailsError, /couldn’t save/);
  component.ngOnDestroy();
});

test('detail editor submits only changed fields, clears after success and cancels without writing', async () => {
  const decorator = () => () => {};
  const { ChatComponent } = load('../src/app/chat/chat.component.ts', {
    '@angular/core': { Component: () => target => target, ViewChild: decorator },
    './chatRead.service': { ChatReadService: class {} },
    './chat-event/chat-event-editor.component': { ChatEventEditorComponent: class {} },
    './chat-fund/chat-fund-editor.component': { ChatFundEditorComponent: class {} },
    './chat-composer/chat-composer.component': { ChatComposerComponent: class {} }, './chatData': model
  });
  const writes = [];
  const component = new ChatComponent({ paramMap: of() }, {}, { updateDetails: async (...args) => writes.push(args) }, {}, { run: fn => fn() });
  const previousFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = fn => { fn(); return 0; };
  try {
    Object.assign(component, { chain: 'chat', signedIn: true, title: 'Design' });
    component.editDetails(); component.subjectDraft = 'Review';
    await component.saveDetails();
    assert.deepEqual(writes, [['chat', { subject: 'Review' }]]);
    assert.equal(component.editingDetails, false); assert.equal(component.savingDetails, false);
    component.editDetails(); component.subjectDraft = 'Never save this'; component.cancelDetailsEdit();
    assert.equal(writes.length, 1); assert.equal(component.editingDetails, false);
    component.editDetails(); component.subjectDraft = 'Another title'; component.title = 'Changed by someone else';
    await component.saveDetails();
    assert.equal(writes.length, 1); assert.match(component.detailsError, /subject changed/);
  } finally { globalThis.requestAnimationFrame = previousFrame; component.ngOnDestroy(); }
});

test('read cursor transactions advance only forward and preserve manual flags', async () => {
  const f = fixture();
  await f.service.advanceReadCursor('chat', 'owner', { timestamp: 30000, messageId: 'm' });
  await f.service.advanceReadCursor('chat', 'owner', { timestamp: 10000, messageId: 'old' });
  await f.service.advanceReadCursor('chat', 'owner', { timestamp: 30000, messageId: 'a' });
  await f.service.advanceReadCursor('chat', 'owner', { timestamp: 30000, messageId: 'z' });
  assert.equal(f.cursorWrites.length, 2);
  assert.equal(f.cursorStore.record.blueFlag, true);
  assert.equal(f.cursorStore.record.messageId, 'z');
  assert.deepEqual(f.cursorWrites[0].options, { merge: true });
  assert.deepEqual(Object.keys(f.cursorWrites[0].fields).sort(), ['messageId', 'serverTimestamp', 'updatedAt']);
  assert.equal(f.cursorWrites[0].fields.serverTimestamp.getTime(), 30000);
  assert.ok(f.transactionPaths.every(path => path === 'lastSeen/owner/chats/chat'));
});

test('read cursor writes reject signed-out, cross-user and unresolved message timestamps', async () => {
  for (const uid of [null, 'other']) {
    const f = fixture(uid);
    assert.equal(await f.service.advanceReadCursor('chat', 'owner', { timestamp: 30000, messageId: 'latest' }), null);
    assert.deepEqual(f.transactionPaths, []); assert.deepEqual(f.cursorWrites, []);
  }
  const f = fixture();
  for (const timestamp of [0, NaN, -1]) assert.equal(await f.service.advanceReadCursor('chat', 'owner', { timestamp, messageId: 'pending' }), null);
  assert.deepEqual(f.cursorWrites, []);
});

test('cursor read failures stay unavailable and verification requires the explicit flag', async () => {
  const f = fixture();
  f.service.afs.doc = () => ({ get: () => throwError(() => new Error('denied')) });
  const chat = await firstValueFrom(f.service.watch('chat', 15));
  assert.equal(chat.cursorUnavailable, true); assert.equal(chat.seen, null);
  assert.equal(model.bubbleMessage('one', { user: 'owner', verified: true }, 'owner').verified, true);
  for (const verified of [undefined, false, 'true']) assert.equal(model.bubbleMessage('one', { verified }, 'owner').verified, false);
});

const { ChatReadService } = load('../src/app/chat/chatRead.service.ts', {
  '@angular/core': core, './chatData': model, './chat-event/chatEvent': events, './chat-fund/chatFund': funds
});
function readView() {
  const oldDocument = globalThis.document, oldWindow = globalThis.window;
  const controls = { focus: true, inert: false, dialog: false };
  globalThis.document = { visibilityState: 'visible', hasFocus: () => controls.focus, querySelector: () => controls.dialog ? {} : null, removeEventListener() {} };
  globalThis.window = { removeEventListener() {} };
  const writes = [];
  const submitted = new Subject();
  const service = new ChatReadService({ submitted, advanceReadCursor: async (chain, user, position) => { writes.push({ chain, user, position }); return position; } }, { run: fn => fn() });
  const rows = [{ id: 'first', bottom: 30 }, { id: 'second', bottom: 150 }];
  service.list = { clientHeight: 100, closest: () => controls.inert ? {} : null, removeEventListener() {}, getBoundingClientRect: () => ({ top: 0, bottom: 100 }), querySelectorAll: () => rows.map(row => ({ dataset: { messageId: row.id }, getBoundingClientRect: () => ({ bottom: row.bottom, height: 30 }) })) };
  const messages = ['first', 'second'].map((id, index) => ({ ...model.bubbleMessage(id, { user: 'other' }, 'owner'), timestamp: (index + 1) * 10000 }));
  const context = { userId: 'owner', seen: { timestamp: 0, messageId: '' }, cursorUnavailable: false, messages };
  service.update('chat', context);
  return { service, submitted, writes, rows, controls, context, dispose() { service.ngOnDestroy(); globalThis.document = oldDocument; globalThis.window = oldWindow; } };
}

test('read tracking advances only through messages reached in the visible viewport', async () => {
  const f = readView();
  try {
    await f.service.saveVisible();
    assert.equal(f.writes[0].position.messageId, 'first');
    f.rows[1].bottom = 90;
    await f.service.saveVisible();
    assert.equal(f.writes[1].position.messageId, 'second');
    await f.service.saveVisible(); assert.equal(f.writes.length, 2);
  } finally { f.dispose(); }
});

test('hidden tabs, unfocused windows, drawers, details and image previews do not mark messages read', async () => {
  const f = readView();
  try {
    for (const guard of ['hidden', 'unfocused', 'drawer', 'details', 'image']) {
      document.visibilityState = guard === 'hidden' ? 'hidden' : 'visible';
      f.controls.focus = guard !== 'unfocused'; f.controls.inert = guard === 'drawer';
      f.controls.dialog = guard === 'image'; f.service.paused = guard === 'details';
      await f.service.saveVisible();
    }
    assert.deepEqual(f.writes, []);
    f.service.update('chat', { ...f.context, userId: null, seen: null });
    await f.service.saveVisible(); assert.deepEqual(f.writes, []);
  } finally { f.dispose(); }
});

test('unread divider stays stable during pagination and resets for a new account', () => {
  const f = readView();
  try {
    assert.equal(f.service.update('chat', { ...f.context, seen: { timestamp: 10000, messageId: 'first' } }), '');
    f.service.reset();
    assert.equal(f.service.update('chat', { ...f.context, seen: { timestamp: 10000, messageId: 'first' } }), 'second');
    assert.equal(f.service.update('chat', { ...f.context, seen: { timestamp: 20000, messageId: 'second' } }), 'second');
    assert.equal(f.service.update('chat', { ...f.context, userId: 'other', seen: { timestamp: 20000, messageId: 'second' } }), '');
  } finally { f.dispose(); }
});

test('read save errors expose retry and old account results cannot replace the new cursor', async () => {
  const f = readView();
  try {
    f.service.data.advanceReadCursor = async () => { throw new Error('offline'); };
    await f.service.saveVisible(); assert.match(f.service.error, /couldn’t save/);
    let finish;
    f.service.data.advanceReadCursor = () => new Promise(resolve => finish = resolve);
    f.service.retry();
    const pending = f.service.saveVisible();
    f.service.update('another', { ...f.context, userId: 'other', seen: { timestamp: 90000, messageId: 'new' } });
    finish({ timestamp: 10000, messageId: 'first' }); await pending;
    assert.deepEqual(f.service.saved, { timestamp: 90000, messageId: 'new' });
    assert.equal(f.service.error, '');
  } finally { f.dispose(); }
});

test('cursor precision matches persisted Date milliseconds, so a read message does not become unread on reopening', async () => {
  assert.equal(model.timestampMillis({ toMillis: () => 30000.789 }), 30000);
  const f = fixture();
  await f.service.advanceReadCursor('chat', 'owner', { timestamp: 30000.789, messageId: 'latest' });
  await f.service.advanceReadCursor('chat', 'owner', { timestamp: 30000.789, messageId: 'latest' });
  assert.equal(f.cursorWrites.length, 1);
  assert.equal(model.firstUnread([{ ...model.bubbleMessage('latest', {}, null), timestamp: 30000 }], 30000, 'latest'), '');
});

test('event dates round-trip in the viewer timezone through winter and summer offsets', () => {
  const previousZone = process.env.TZ;
  try {
    for (const [zone, date, expected] of [
      ['Europe/London', '2027-01-15', '2027-01-15T19:30:00.000Z'],
      ['Europe/London', '2027-07-15', '2027-07-15T18:30:00.000Z'],
      ['America/New_York', '2027-01-15', '2027-01-16T00:30:00.000Z'],
      ['Asia/Kolkata', '2027-07-15', '2027-07-15T14:00:00.000Z']
    ]) {
      process.env.TZ = zone;
      const event = events.eventFromDraft({ description: 'Review', date, time: '19:30', duration: 1.25, location: 'Workshop' }, 0);
      assert.equal(new Date(event.start).toISOString(), expected);
      assert.equal(event.end - event.start, 4500000);
      const draft = events.eventDraft(event, 0);
      assert.equal(draft.date, date); assert.equal(draft.time, '19:30'); assert.equal(draft.duration, 1.25);
    }
  } finally { if (previousZone === undefined) delete process.env.TZ; else process.env.TZ = previousZone; }
});

test('event validation rejects impossible dates, daylight-saving gaps, invalid durations and ended events', () => {
  const previousZone = process.env.TZ;
  process.env.TZ = 'Europe/London';
  try {
    const draft = { description: 'Review', date: '2027-03-28', time: '01:30', duration: 1, location: 'Workshop' };
    assert.throws(() => events.eventFromDraft(draft, 0), /does not exist/);
    for (const invalid of [{ date: '2027-02-30' }, { time: '25:00' }, { duration: 0 }, { duration: Infinity }, { description: '' }, { location: '' }]) {
      assert.throws(() => events.eventFromDraft({ ...draft, date: '2027-07-15', time: '12:00', ...invalid }, 0));
    }
    assert.throws(() => events.eventFromDraft({ ...draft, date: '2027-07-15', time: '12:00' }, Date.UTC(2028, 0, 1)), /already ended/);
  } finally { if (previousZone === undefined) delete process.env.TZ; else process.env.TZ = previousZone; }
});

test('event projection recognizes production cancellation and meeting links allow only HTTP(S)', () => {
  assert.equal(events.chatEvent({ eventDateStart: 1000, eventDateEnd: 1000, eventDescription: 'Cancelled' }), null);
  assert.equal(events.chatEvent({}), null);
  const event = events.chatEvent({ eventDateStart: 1000, eventDateEnd: 3601000, eventDescription: 'Review' });
  assert.equal(event.duration, 1);
  assert.equal(events.eventLocationUrl('javascript:alert(1)'), '');
  assert.equal(events.eventLocationUrl('Workshop'), '');
  assert.equal(events.eventLocationUrl('https://example.com/meeting'), 'https://example.com/meeting');
});

test('event saves and cancellation use production fields without adding a new persisted state', async () => {
  const f = fixture(); const start = Date.now() + 86400000;
  await f.service.saveEvent('chat', { description: ' Review ', start, end: 0, duration: 1.5, location: ' Workshop ' });
  assert.deepEqual(f.writes[0], { text: events.eventActionText('Scheduled', { description: 'Review', start, duration: 1.5, location: 'Workshop' }), chain: 'chat', eventDescription: 'Review', eventDateStart: start, eventDateEnd: start + 5400000, eventDuration: 1.5, eventLocation: 'Workshop' });
  const event = { description: 'Review', start, end: start + 5400000, duration: 1.5, location: 'Workshop' };
  const before = Date.now(); await f.service.cancelEvent('chat', event);
  assert.equal(f.writes[1].text, events.eventActionText('Cancelled', event));
  assert.equal(f.writes[1].eventDateStart, f.writes[1].eventDateEnd);
  assert.ok(f.writes[1].eventDateEnd <= Date.now() - 3600000 && f.writes[1].eventDateEnd >= before - 3600000);
  assert.deepEqual(Object.keys(f.writes[1]).sort(), ['chain', 'eventDateEnd', 'eventDateStart', 'text']);
  const signedOut = fixture(null);
  await assert.rejects(signedOut.service.cancelEvent('chat'));
  await assert.rejects(signedOut.service.saveEvent('chat', { description: 'Review', start, end: start + 3600000, duration: 1, location: 'Workshop' }));
  assert.deepEqual(signedOut.writes, []);
});

const propertyDecorator = () => () => {};
class EventEmitterStub { values = []; emit(value) { this.values.push(value); } }
const eventCore = { Component: () => target => target, Input: propertyDecorator, Output: propertyDecorator, ViewChild: propertyDecorator, EventEmitter: EventEmitterStub };
const { ChatEventSummaryComponent } = load('../src/app/chat/chat-event/chat-event-summary.component.ts', { '@angular/core': eventCore, './chatEvent': events, '../chatDate': dates });
const { ChatEventEditorComponent } = load('../src/app/chat/chat-event/chat-event-editor.component.ts', { '@angular/core': eventCore, './chatEvent': events, '../chatDate': dates });

test('header event summary expires at the end and offers Join only near a valid meeting', () => {
  const summary = new ChatEventSummaryComponent({ run: fn => fn() });
  try {
    summary.event = { start: 1000000, end: 4600000, duration: 1, description: 'Review', location: 'https://example.com/meeting' };
    summary.now = 600000; assert.equal(summary.active, true); assert.equal(summary.joinUrl, '');
    summary.now = 700000; assert.equal(summary.joinUrl, 'https://example.com/meeting');
    summary.now = 4600000; assert.equal(summary.active, false); assert.equal(summary.joinUrl, '');
  } finally { summary.ngOnDestroy(); }
});

test('event editor retains failed drafts, requires cancellation confirmation and protects stale edits', async () => {
  const writes = [];
  let fail = true;
  const editor = new ChatEventEditorComponent({ saveEvent: async (...args) => { if (fail) throw new Error('offline'); writes.push(args); }, cancelEvent: async (...args) => writes.push(args) }, { run: fn => fn() });
  const previousFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = fn => { fn(); return 0; };
  try {
    Object.assign(editor, { chain: 'chat', signedIn: true, event: { description: 'Review', start: Math.ceil(Date.now() / 60000) * 60000 + 86400000, end: Math.ceil(Date.now() / 60000) * 60000 + 90000000, duration: 1, location: 'Workshop' } });
    editor.ngOnChanges(); editor.edit(); assert.equal(editor.changed, false);
    editor.draft.description = 'Changed'; await editor.save();
    assert.equal(editor.editing, true); assert.equal(editor.draft.description, 'Changed'); assert.equal(editor.saving, false); assert.match(editor.error, /couldn’t save/);
    fail = false; editor.event = { ...editor.event, location: 'Another workshop' }; await editor.save();
    assert.equal(writes.length, 0); assert.match(editor.error, /event changed/);
    editor.dismiss(); await editor.cancel(); assert.equal(writes.length, 0);
    editor.askCancel(); await editor.cancel(); assert.deepEqual(writes, [['chat', editor.event]]);
    assert.deepEqual(editor.busyChange.values, [true, false, true, false]);
  } finally { globalThis.requestAnimationFrame = previousFrame; editor.ngOnDestroy(); }
});


test('event action messages describe scheduling, changed fields and cancellation within the message limit', async () => {
  const previousTZ = process.env.TZ;
  process.env.TZ = 'Europe/London';
  try {
    const event = { description: 'Team review', start: Date.UTC(2027, 6, 20, 18), end: Date.UTC(2027, 6, 20, 19), duration: 1, location: 'Workshop' };
    const scheduled = events.eventActionText('Scheduled', event);
    assert.equal(scheduled, 'Scheduled event: Team review\n20 Jul 2027, 19:00 (Europe/London) · 1h\nLocation: Workshop');
    const updated = { ...event, start: event.start + 3600000, location: 'https://example.com/meeting' };
    assert.equal(events.eventActionText('Updated', updated, event), 'Updated event\nWhen: 20 Jul 2027, 20:00 (Europe/London)\nLocation: https://example.com/meeting');
    assert.equal(events.eventActionText('Cancelled', event), 'Cancelled event: Team review');
    assert.equal(events.eventActionText('Updated', { ...event, description: 'New title', duration: 2 }, event), 'Updated event\nDescription: New title\nDuration: 2h');
    assert.equal(events.eventActionText('Updated', { ...event, location: 'Garage' }, event), 'Updated event\nLocation: Garage');
    assert.equal(events.eventActionText('Updated', { ...event, duration: 0.5 }, event), 'Updated event\nDuration: 30 min');
    const longEvent = { ...updated, description: 'D'.repeat(200), location: 'L'.repeat(200), duration: 1.5 };
    const text = events.eventActionText('Updated', longEvent, event);
    assert.ok(text.length <= 500);
    assert.match(text, /When: 20 Jul 2027, 20:00 \(Europe\/London\)\nDuration: 1h 30m/);
    assert.match(text, /Location: L/);
    const f = fixture();
    await f.service.saveEvent('chat', updated, event);
    assert.equal(f.writes[0].text, events.eventActionText('Updated', updated, event));
  } finally { if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ; }
});

test('message date labels use local calendar days, weekdays and compact dates with years only when needed', () => {
  const previousTZ = process.env.TZ;
  process.env.TZ = 'Europe/London';
  try {
    const at = (year, month, day, hour = 12) => new Date(year, month - 1, day, hour).getTime();
    const now = at(2026, 10, 16);
    for (const [timestamp, label] of [
      [at(2026, 10, 16), 'Today'], [at(2026, 10, 15), 'Yesterday'],
      [at(2026, 10, 14), 'Wednesday'], [at(2026, 10, 10), 'Saturday'],
      [at(2026, 10, 9), '9 Oct'], [at(2026, 1, 3), '3 Jan'],
      [at(2025, 10, 16), '16 Oct 2025'], [at(2026, 10, 17), '17 Oct'], [0, 'Pending'], [NaN, 'Pending']
    ]) assert.equal(model.messageDateLabel(timestamp, now), label);
    assert.equal(model.messageDateLabel(at(2026, 10, 25, 0), at(2026, 10, 26, 23)), 'Yesterday');
    assert.equal(model.messageDateLabel(at(2026, 3, 28, 23), at(2026, 3, 30, 0)), 'Saturday');
    assert.equal(model.messageDateLabel(at(2026, 12, 31), at(2027, 1, 1)), 'Yesterday');
    assert.equal(model.messageDateLabel(at(2026, 12, 25), at(2027, 1, 1)), '25 Dec 2026');
    process.env.TZ = 'America/New_York';
    assert.equal(model.messageDateLabel(Date.UTC(2026, 9, 16, 2), Date.UTC(2026, 9, 16, 14)), 'Yesterday');
  } finally { if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ; }
});


test('event dates share message date formatting and add Tomorrow and nearby future weekdays', () => {
  const previousTZ = process.env.TZ;
  process.env.TZ = 'Europe/London';
  try {
    const at = (year, month, day) => new Date(year, month - 1, day, 12).getTime();
    const now = at(2026, 10, 16);
    for (const [timestamp, expected] of [
      [at(2026, 10, 16), 'Today'], [at(2026, 10, 17), 'Tomorrow'],
      [at(2026, 10, 18), 'Sunday'], [at(2026, 10, 22), 'Thursday'],
      [at(2026, 10, 23), '23 Oct'], [at(2027, 1, 3), '3 Jan 2027'],
      [at(2026, 10, 15), 'Yesterday'], [at(2026, 10, 14), 'Wednesday']
    ]) assert.equal(dates.friendlyDateLabel(timestamp, now, true), expected);
    assert.equal(dates.friendlyDateLabel(at(2027, 1, 1), at(2026, 12, 31), true), 'Tomorrow');
    assert.equal(dates.friendlyDateLabel(at(2026, 3, 30), at(2026, 3, 28), true), 'Monday');
    const summary = new ChatEventSummaryComponent({ run: fn => fn() });
    try { summary.now = now; assert.equal(summary.dateLabel(at(2026, 10, 17), summary.now, true), 'Tomorrow'); }
    finally { summary.ngOnDestroy(); }
  } finally { if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ; }
});


test('Chat opens with 30 messages and delays Latest until beyond a viewport without pulling readers down', () => {
  const { ChatComponent } = load('../src/app/chat/chat.component.ts', {
    '@angular/core': { Component: () => target => target, ViewChild: () => () => {} },
    './chatRead.service': { ChatReadService: class {} },
    './chat-event/chat-event-editor.component': { ChatEventEditorComponent: class {} },
    './chat-fund/chat-fund-editor.component': { ChatFundEditorComponent: class {} },
    './chat-composer/chat-composer.component': { ChatComposerComponent: class {} }, './chatData': model
  });
  const limits = [];
  const data = { watch: (chain, limit) => { limits.push(limit); return of(); } };
  const route = { paramMap: of({ get: () => 'chat' }), snapshot: { queryParamMap: { get: () => '' } } };
  const component = new ChatComponent(route, {}, data, {}, { run: fn => fn() }, { reset() {} }, undefined, { configure() {} });
  try {
    assert.deepEqual(limits, [30]);
    const list = { scrollHeight: 3000, clientHeight: 600, scrollTop: 2250 };
    component.messageList = { nativeElement: list };
    component.onScroll();
    assert.equal(component.awayFromLatest, true); assert.equal(component.showLatest, false);
    list.scrollTop = 1800; component.onScroll(); assert.equal(component.showLatest, false);
    list.scrollTop = 1799; component.onScroll(); assert.equal(component.showLatest, true);
    list.clientHeight = 200; list.scrollTop = 2500; component.onScroll(); assert.equal(component.showLatest, false);
    list.scrollTop = 2499; component.onScroll(); assert.equal(component.showLatest, true);
    component.loadMore(); assert.deepEqual(limits, [30, 45]);
    route.snapshot.queryParamMap.get = () => 'message';
    const linked = new ChatComponent(route, {}, data, {}, { run: fn => fn() }, { reset() {} }, undefined, { configure() {} });
    assert.equal(limits.at(-1), 100); linked.ngOnDestroy();
  } finally { component.ngOnDestroy(); }
});


test('confirmed local sends and event/detail actions publish their exact message IDs only after success', async () => {
  const f = fixture(), submitted = [];
  const listener = f.service.submitted.subscribe(value => submitted.push(value));
  const event = { description: 'Review', start: Date.now() + 86400000, duration: 1, location: 'Workshop' };
  try {
    await f.service.send('chat', { text: 'Hello' });
    await f.service.updateDetails('chat', { subject: 'Review' });
    await f.service.saveEvent('chat', event);
    await f.service.cancelEvent('chat', event);
    assert.deepEqual(submitted, [1, 2, 3, 4].map(index => ({ chain: 'chat', userId: 'owner', messageId: `created-${index}` })));
    f.UI.createMessage = async () => { throw new Error('offline'); };
    await assert.rejects(f.service.saveEvent('chat', event));
    assert.equal(submitted.length, 4);
  } finally { listener.unsubscribe(); }
});

test('own event actions are read while details hides the chat, after their server timestamp resolves', async () => {
  const f = readView();
  try {
    f.service.paused = true; f.service.list.clientHeight = 0;
    const own = { ...model.bubbleMessage('event', { user: 'owner' }, 'owner'), timestamp: 0 };
    const context = { ...f.context, seen: { timestamp: 20000, messageId: 'second' }, messages: [...f.context.messages, own] };
    f.service.reset(); f.service.update('chat', context);
    f.submitted.next({ chain: 'chat', userId: 'owner', messageId: 'event' });
    await f.service.saveVisible(); assert.equal(f.writes.length, 0);
    own.timestamp = 30000; f.service.update('chat', context);
    f.service.paused = true;
    await f.service.saveVisible();
    assert.equal(f.writes[0].position.messageId, 'event');
    await f.service.saveVisible(); assert.equal(f.writes.length, 1);
  } finally { f.dispose(); }
});

test('own actions never skip incoming unread messages and advance after those messages are reached', async () => {
  const f = readView();
  try {
    const own = { ...model.bubbleMessage('event', { user: 'owner' }, 'owner'), timestamp: 30000 };
    f.service.update('chat', { ...f.context, messages: [...f.context.messages, own] });
    f.service.paused = true;
    f.submitted.next({ chain: 'chat', userId: 'owner', messageId: 'event' });
    await f.service.saveVisible(); assert.equal(f.writes.length, 0);
    f.service.paused = false; f.rows[1].bottom = 90;
    await f.service.saveVisible();
    assert.equal(f.writes[0].position.messageId, 'event');
  } finally { f.dispose(); }
});

test('action acknowledgements respect focus, account, chain and write failures', async () => {
  const f = readView();
  try {
    const own = { ...model.bubbleMessage('event', { user: 'owner' }, 'owner'), timestamp: 30000 };
    f.service.reset();
    f.service.update('chat', { ...f.context, seen: { timestamp: 20000, messageId: 'second' }, messages: [...f.context.messages, own] });
    f.service.paused = true;
    f.submitted.next({ chain: 'another', userId: 'owner', messageId: 'event' });
    f.submitted.next({ chain: 'chat', userId: 'another', messageId: 'event' });
    await f.service.saveVisible(); assert.equal(f.writes.length, 0);
    f.submitted.next({ chain: 'chat', userId: 'owner', messageId: 'event' });
    for (const blocked of ['hidden', 'unfocused', 'drawer', 'dialog']) {
      document.visibilityState = blocked === 'hidden' ? 'hidden' : 'visible';
      f.controls.focus = blocked !== 'unfocused'; f.controls.inert = blocked === 'drawer'; f.controls.dialog = blocked === 'dialog';
      await f.service.saveVisible(); assert.equal(f.writes.length, 0);
    }
    f.controls.dialog = false;
    const advance = f.service.data.advanceReadCursor;
    f.service.data.advanceReadCursor = async () => { throw new Error('offline'); };
    await f.service.saveVisible(); assert.match(f.service.error, /couldn’t save/);
    f.service.data.advanceReadCursor = advance; f.service.retry(); await f.service.saveVisible();
    assert.equal(f.writes[0].position.messageId, 'event');
    f.service.reset(); assert.equal(f.service.acknowledged.size, 0);
  } finally { f.dispose(); }
});

test('action acknowledgements do not bridge a gap outside the loaded history window', async () => {
  const f = readView();
  try {
    const own = { ...model.bubbleMessage('event', { user: 'owner' }, 'owner'), timestamp: 30000 };
    f.service.paused = true;
    const context = { ...f.context, hasMore: true, messages: [own] };
    f.service.update('chat', context);
    f.submitted.next({ chain: 'chat', userId: 'owner', messageId: 'event' });
    await f.service.saveVisible(); assert.equal(f.writes.length, 0);
    f.service.update('chat', { ...context, hasMore: false });
    await f.service.saveVisible(); assert.equal(f.writes[0].position.messageId, 'event');
  } finally { f.dispose(); }
});

test('queued own actions arriving during a cursor write are not lost or applied to another chat', async () => {
  const f = readView();
  try {
    let finish;
    f.service.data.advanceReadCursor = (chain, user, position) => new Promise(resolve => { finish = () => resolve(position); });
    const writing = f.service.saveVisible();
    const own = { ...model.bubbleMessage('event', { user: 'owner' }, 'owner'), timestamp: 30000 };
    f.rows[1].bottom = 90;
    f.service.update('chat', { ...f.context, messages: [...f.context.messages, own] });
    f.submitted.next({ chain: 'chat', userId: 'owner', messageId: 'event' });
    finish(); await writing;
    f.service.data.advanceReadCursor = async (chain, user, position) => { f.writes.push(position); return position; };
    await f.service.saveVisible(); assert.equal(f.writes[0].messageId, 'event');
    f.service.update('different', f.context);
    assert.equal(f.service.acknowledged.size, 0);
  } finally { f.dispose(); }
});

test('closing an image dialog triggers a new read scan and cleans up its listener', () => {
  const f = readView();
  const oldMutation = globalThis.MutationObserver, oldResize = globalThis.ResizeObserver;
  try {
    const listeners = new Map(), removed = [];
    document.addEventListener = (type, listener) => listeners.set(type, listener);
    document.removeEventListener = type => removed.push(type);
    window.addEventListener = () => {};
    f.service.list.addEventListener = () => {};
    globalThis.MutationObserver = class { observe() {} disconnect() {} };
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    let scans = 0;
    f.service.scan = () => scans++;
    f.service.attach(f.service.list);
    const before = scans;
    listeners.get('close')(); assert.equal(scans, before + 1);
    f.service.ngOnDestroy(); assert.ok(removed.includes('close'));
  } finally { globalThis.MutationObserver = oldMutation; globalThis.ResizeObserver = oldResize; f.dispose(); }
});

test('new own actions do not create an unread divider and entry markers stay fixed during pagination', () => {
  const f = readView();
  try {
    f.service.reset();
    const context = { ...f.context, seen: { timestamp: 20000, messageId: 'second' } };
    assert.equal(f.service.update('chat', context), '');
    const own = { ...model.bubbleMessage('event', { user: 'owner' }, 'owner'), timestamp: 30000 };
    assert.equal(f.service.update('chat', { ...context, messages: [...context.messages, own] }), '');
    f.service.reset();
    const incoming = { ...context.messages[1], id: 'incoming', timestamp: 25000 };
    assert.equal(f.service.update('chat', { ...context, messages: [incoming, own] }), 'incoming');
    const older = { ...incoming, id: 'older', timestamp: 22000 };
    assert.equal(f.service.update('chat', { ...context, messages: [older, incoming, own] }), 'incoming');
  } finally { f.dispose(); }
});

test('user avatar projection retains stored names and photo alternatives when authors are labelled You', () => {
  const message = model.bubbleMessage('own', { user: 'owner', name: 'Alex Morgan', imageUrlThumbUser: 'thumb', imageUrlMedium: 'medium', imageUrlOriginal: 'original' }, 'owner');
  assert.equal(message.author, 'You');
  assert.equal(message.avatarName, 'Alex Morgan');
  assert.deepEqual(message.avatarSources, ['thumb', 'medium', 'original']);
  const members = model.chatMembers({ user: 'owner', name: 'Alex Morgan', recipientList: ['owner', 'other'], recipients: { other: { name: 'Blair Lee' } } }, 'owner');
  assert.equal(members[0].name, 'You');
  assert.equal(members[0].avatarName, 'Alex Morgan');
  assert.equal(members[1].avatarName, 'Blair Lee');
});

const fundCore = { Component: () => target => target, Input: () => () => {}, Output: () => () => {}, ViewChild: () => () => {}, EventEmitter: class { emit() {} } };
const { ChatFundEditorComponent } = load('../src/app/chat/chat-fund/chat-fund-editor.component.ts', {
  '@angular/core': fundCore, './chatFund': funds, '../../permissions.service': { PermissionsService: class {} }
});
const { ChatFundSummaryComponent } = load('../src/app/chat/chat-fund/chat-fund-summary.component.ts', {
  '@angular/core': fundCore, './chatFund': funds, '../../permissions.service': { PermissionsService: class {} }
});
const sampleFund = { description: 'Track testing', amountGBPTarget: 1000, amountGBPRaised: 125, daysLeft: 12.5, closesAt: Date.now() + 12.5 * 86400000, cancelled: false };

test('fund projection hides legacy cancellation markers, handles old fields and caps progress', () => {
  for (const record of [{}, { fund: {} }, { fund: { amountGBPTarget: NaN } }, { fund: { amountGBPTarget: 0.0001, daysLeft: 0.1 } }]) assert.equal(funds.chatFund(record), null);
  assert.deepEqual(funds.chatFund({ fund: { amountGBPTarget: 20 } }), { description: '', amountGBPTarget: 20, amountGBPRaised: 0, daysLeft: 0, closesAt: null, cancelled: false });
  assert.equal(funds.fundProgress({ ...sampleFund, amountGBPRaised: 2000 }), 100);
  const summary = new ChatFundSummaryComponent();
  summary.fund = sampleFund; assert.equal(summary.active, true);
  summary.fund = { ...sampleFund, closesAt: Date.now() - 1 }; assert.equal(summary.active, false);
  assert.equal(funds.activeFund(null), false);
});

test('fund validation converts selected currencies to GBP and rejects invalid targets and days', () => {
  const currency = { code: 'usd', perGBP: 1.25 };
  const draft = { description: ' Testing ', amount: 125, days: 30 };
  assert.deepEqual(funds.fundFromDraft(draft, currency), { description: 'Testing', amountGBPTarget: 100, daysLeft: 30 });
  assert.equal(funds.fundAmount(100, currency), 'US$125');
  assert.equal(funds.fundAmount(100.39, currency), 'US$125');
  assert.equal(funds.fundAmount(100.4, currency), 'US$126');
  for (const invalid of [ { description: '' }, { description: 'a'.repeat(201) }, { amount: null }, { amount: -1 }, { amount: Infinity }, { amount: 0.001 }, { amount: 1e20 }, { days: null }, { days: 0 }, { days: 1.5 }, { days: Infinity } ]) {
    assert.throws(() => funds.fundFromDraft({ ...draft, ...invalid }, currency));
  }
  assert.throws(() => funds.fundFromDraft(draft, { code: 'usd', perGBP: 0 }));
});

test('fund service writes fixed closing dates and explicit admin cancellation', async () => {
  const f = fixture(), submitted = [];
  f.UI.PERRINNAdminLastMessageObj = { currencyList: { gbp: { toCOIN: 2 }, usd: { toCOIN: 1.6 } } };
  f.UI.currentUserLastMessageObj = { userCurrency: 'usd' };
  assert.deepEqual(f.service.fundCurrency, { code: 'usd', perGBP: 1.25 });
  const subscription = f.service.submitted.subscribe(value => submitted.push(value));
  try {
    await f.service.saveFund('chat', { description: sampleFund.description, amountGBPTarget: 1000, daysLeft: 12 });
    await f.service.cancelFund('chat', sampleFund);
    assert.equal(f.writes[0].fund.description, sampleFund.description);
    assert.equal(f.writes[0].fund.amountGBPTarget, 1000);
    assert.ok(Math.abs(f.writes[0].fund.closesAt - Date.now() - 12 * 86400000) < 100);
    assert.equal(f.writes[0].fund.cancelled, false);
    assert.equal(f.writes[0].fund.daysLeft, undefined);
    assert.deepEqual(f.writes[1].fund, { cancelled: true });
    assert.equal(funds.chatFund(f.writes[1]), null);
    assert.equal(submitted.length, 2);
    assert.ok(f.writes.every(write => write.text.length <= 500 && write.chain === 'chat'));
    await assert.rejects(f.service.saveFund('', { ...sampleFund, daysLeft: 12 }));
    await assert.rejects(f.service.saveFund('chat', { ...sampleFund, daysLeft: 0 }));
    assert.equal(f.writes.length, 2);
    const out = fixture(null);
    await assert.rejects(out.service.saveFund('chat', { ...sampleFund, daysLeft: 12 }));
    await assert.rejects(out.service.cancelFund('chat', sampleFund));
    assert.deepEqual(out.writes, []);
    f.UI.currentUser = 'another';
    await assert.rejects(f.service.saveFund('chat', { ...sampleFund, daysLeft: 12 }));
    assert.equal(f.writes.length, 2);
    f.UI.PERRINNAdminLastMessageObj = {};
    assert.deepEqual(f.service.fundCurrency, { code: 'gbp', perGBP: 1 });
  } finally { subscription.unsubscribe(); }
});


test('fund editor retains failed drafts, detects changed data and requires confirmation', async () => {
  const previousRAF = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = fn => fn();
  const calls = [];
  const data = { fundCurrency: { code: 'usd', perGBP: 1.25 }, saveFund: async (...args) => { calls.push(args); throw new Error('offline'); }, cancelFund: async (...args) => calls.push(args) };
  const editor = new ChatFundEditorComponent(data, { run: fn => fn() }, { current: { ready: true, isAdmin: true } });
  Object.assign(editor, { chain: 'chat', signedIn: true, fund: sampleFund });
  editor.ngOnChanges();
  try {
    editor.edit(); assert.equal(editor.draft.amount, 1250); assert.equal(editor.draft.days, 13);
    editor.draft.description = 'New testing';
    await editor.save();
    assert.equal(editor.editing, true); assert.equal(editor.draft.description, 'New testing');
    assert.match(editor.error, /couldn’t save/); assert.equal(editor.saving, false);
    editor.fund = { ...sampleFund, amountGBPRaised: 150 };
    await editor.save(); assert.match(editor.error, /fund changed/); assert.equal(calls.length, 1);
    editor.edit(); editor.draft.amount = 0; await editor.save(); assert.match(editor.error, /target/); assert.equal(calls.length, 1);
    editor.dismiss(); await editor.cancel(); assert.equal(calls.length, 1);
    editor.askCancel(); editor.fund = { ...sampleFund, description: 'Changed' }; editor.ngOnChanges();
    assert.equal(editor.confirmation, null); await editor.cancel(); assert.equal(calls.length, 1);
    editor.askCancel(); await editor.cancel(); assert.equal(calls.length, 2); assert.equal(editor.notice, 'Cancellation sent');
    editor.signedIn = false; editor.ngOnChanges(); editor.edit(); assert.equal(editor.editing, false);
  } finally { editor.ngOnDestroy(); globalThis.requestAnimationFrame = previousRAF; }
});

test('fund edits preserve unchanged GBP targets and ignore old chat completions', async () => {
  const previousRAF = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = fn => fn();
  let finish;
  const writes = [];
  const data = { fundCurrency: { code: 'usd', perGBP: 1.2345 }, saveFund: (...args) => { writes.push(args); return new Promise(resolve => finish = resolve); } };
  const editor = new ChatFundEditorComponent(data, { run: fn => fn() }, { current: { ready: true, isAdmin: true } });
  Object.assign(editor, { chain: 'chat', signedIn: true, fund: { ...sampleFund, amountGBPTarget: 0.05 } });
  editor.ngOnChanges();
  try {
    editor.edit(); editor.draft.description = 'New';
    const saving = editor.save();
    assert.equal(writes[0][1].amountGBPTarget, 0.05); assert.equal(editor.saving, true);
    editor.chain = 'another'; editor.ngOnChanges(); finish(); await saving;
    assert.equal(editor.notice, ''); assert.equal(editor.saving, false);
    editor.edit(); editor.draft.description = 'Changed'; data.fundCurrency = { code: 'gbp', perGBP: 1 };
    await editor.save(); assert.match(editor.error, /Currency rates changed/); assert.equal(writes.length, 1);
  } finally { editor.ngOnDestroy(); globalThis.requestAnimationFrame = previousRAF; }
});

test('image sends report real upload percentages and switch to Sending before saving the message', async () => {
  const f = fixture(), percentages = new Subject(), url = new Subject(), progress = [];
  let finish;
  const task = Object.assign(new Promise(resolve => finish = resolve), { percentageChanges: () => percentages });
  f.service.storage.ref = () => ({ put: () => task, getDownloadURL: () => url });
  const sending = f.service.send('chat', { text: 'Image', image: { name: 'test.png', type: 'image/png', size: 100 } }, value => progress.push(value));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(progress, [0]); assert.equal(percentages.observed, true);
  for (const value of [undefined, NaN, 12.4, 55.6, 150]) percentages.next(value);
  assert.deepEqual(progress, [0, 12, 56, 100]); assert.deepEqual(f.writes, []);
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(progress.at(-1), null); assert.equal(percentages.observed, false);
  percentages.next(100); assert.equal(progress.at(-1), null); assert.deepEqual(f.writes, []);
  url.next('https://example.com/test.png'); await sending;
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].chatImageUrlOriginal, 'https://example.com/test.png');
});

test('upload failures release progress listeners, preserve the draft and never create a message', async () => {
  const f = fixture(), percentages = new Subject(), progress = [];
  let fail;
  const task = Object.assign(new Promise((_, reject) => fail = reject), { percentageChanges: () => percentages });
  f.service.storage.ref = () => ({ put: () => task });
  const draft = { text: 'Keep this', image: { name: 'test.png', type: 'image/png', size: 100 } };
  const sending = f.service.send('chat', draft, value => progress.push(value));
  const rejection = assert.rejects(sending, /offline/);
  await new Promise(resolve => setImmediate(resolve));
  percentages.next(25); percentages.error(Error('offline')); fail(Error('offline')); await rejection;
  assert.equal(percentages.observed, false); assert.deepEqual(f.writes, []); assert.equal(draft.text, 'Keep this'); assert.ok(draft.image);
  assert.deepEqual(progress, [0, 25]);
  const text = fixture(), textProgress = [];
  await text.service.send('chat', { text: 'Text only', image: null }, value => textProgress.push(value));
  assert.deepEqual(textProgress, []); assert.deepEqual(text.uploads, []);
});

test('Chat clears upload feedback after a failed send and ignores progress for a different chat', async () => {
  const { ChatComponent } = load('../src/app/chat/chat.component.ts', {
    '@angular/core': { Component: () => target => target, ViewChild: () => () => {} },
    './chatRead.service': { ChatReadService: class {} },
    './chat-event/chat-event-editor.component': { ChatEventEditorComponent: class {} },
    './chat-fund/chat-fund-editor.component': { ChatFundEditorComponent: class {} },
    './chat-composer/chat-composer.component': { ChatComposerComponent: class {} }, './chatData': model
  });
  const progress = [];
  let report, fail;
  const data = { send: (_, __, callback) => { report = callback; return new Promise((_, reject) => fail = reject); } };
  const component = new ChatComponent({ paramMap: of() }, {}, data, {}, { run: fn => fn() }, {}, {}, { mode: 'text' });
  Object.assign(component, { chain: 'chat', signedIn: true, composer: { setUploadProgress: value => progress.push(value) } });
  const sending = component.send({ text: 'Image', image: {} });
  report(35); assert.deepEqual(progress, [35]); assert.equal(component.sending, true);
  component.chain = 'another'; report(60); assert.deepEqual(progress, [35]);
  component.chain = 'chat'; fail(Error('offline')); await sending;
  assert.equal(component.sending, false); assert.equal(progress.at(-1), null); assert.match(component.sendError, /couldn’t send/);
  component.ngOnDestroy();
});

test('transfer bubbles project clear parties, PRN amounts and references without exposing raw account data', () => {
  const record = { user: 'sender', name: 'Nico', verified: true, chain: 'chat', text: 'Sending 11.9 PRN to You',
    recipients: { receiver: { name: 'Alex' } }, transactionOut: { user: 'receiver', amount: 11.9, reference: 'Design work', code: 'PRN' },
    wallet: { balance: 900 }, emails: { auth: 'private@example.test' } };
  const message = model.bubbleMessage('out', record, 'sender');
  assert.deepEqual(message.transfers, [{ kind: 'outgoing', title: 'PRN transfer', amount: 11.9, from: 'You', to: 'Alex', reference: 'Design work', code: 'PRN', status: 'Recorded', activationId: '' }]);
  assert.equal(model.bubbleMessage('out', record, 'receiver').transfers[0].to, 'You');
  assert.equal(model.bubbleMessage('out', record, null).transfers[0].from, 'Nico');
  assert.equal(message.text, record.text); assert.equal('wallet' in message, false); assert.equal('emails' in message, false);
  assert.equal(model.bubbleMessage('out', { ...record, verified: undefined }, 'sender').transfers[0].status, 'Processing');
  assert.equal(model.bubbleMessage('out', { ...record, verified: false }, 'sender').transfers[0].status, 'Not verified');
});

test('receipts reuse only a matching loaded source and label automatic messages as transfer updates', () => {
  const source = { user: 'sender', name: 'Nico', chain: 'chat', transactionOut: { user: 'receiver', amount: 11.9, reference: 'Design work', code: 'PERRINN' } };
  const receipt = { user: 'receiver', name: 'Alex', chain: 'chat', verified: true, isBackendMessage: true,
    text: 'PRN tokens received (Backend message)', transactionIn: { user: 'sender', message: 'out', amount: 11.9 } };
  const message = model.bubbleMessage('receipt', receipt, 'receiver', source);
  assert.equal(message.author, 'Transfer update'); assert.equal(message.own, true);
  assert.deepEqual(message.transfers[0], { kind: 'incoming', title: 'PRN received', amount: 11.9, from: 'Nico', to: 'You', reference: 'Design work', code: 'PERRINN', status: 'Recorded', activationId: '' });
  for (const wrong of [undefined, { ...source, chain: 'another' }, { ...source, user: 'another' }, { ...source, transactionOut: { ...source.transactionOut, amount: 12 } }]) {
    const summary = model.bubbleMessage('receipt', receipt, null, wrong).transfers[0];
    assert.equal(summary.reference, ''); assert.equal(summary.code, '');
  }
  assert.equal(model.bubbleMessage('receipt', { ...receipt, transactionIn: { ...receipt.transactionIn, name: 'Nico' } }, null).transfers[0].from, 'Nico');
});

test('pending transfer messages distinguish processing, activation and existing activation links', () => {
  const record = { user: 'sender', name: 'Nico', transactionPending: { amount: 20, reference: 'Contribution', code: null } };
  assert.equal(model.bubbleMessage('pending', record, null).transfers[0].status, 'Processing');
  const ready = model.bubbleMessage('pending', { ...record, verified: true }, null).transfers[0];
  assert.equal(ready.status, 'Awaiting activation'); assert.equal(ready.activationId, 'pending'); assert.equal(ready.to, '');
  const activated = model.bubbleMessage('pending', { ...record, verified: true, transactionPending: { ...record.transactionPending, activated: true } }, null).transfers[0];
  assert.equal(activated.status, 'Activated'); assert.equal(activated.activationId, '');
});

test('normal messages stay normal, invalid amounts are ignored and transfer records break sender grouping', () => {
  const base = { user: 'sender', name: 'Nico', text: 'Normal note', serverTimestamp: 10000 };
  for (const amount of [undefined, null, 0, -1, NaN, Infinity, '20']) {
    assert.deepEqual(model.bubbleMessage('plain', { ...base, transactionOut: { amount } }, null).transfers, []);
  }
  const ordinary = model.bubbleMessage('plain', base, null);
  const transfer = model.bubbleMessage('out', { ...base, transactionOut: { user: 'receiver', amount: 20 } }, null);
  assert.equal(model.continuesMessageGroup(ordinary, transfer, ''), false);
  assert.equal(model.continuesMessageGroup(transfer, ordinary, ''), false);
  assert.equal(model.bubbleMessage('both', { ...base, verified: true, transactionOut: { amount: 20, user: 'sender' }, transactionIn: { amount: 20, user: 'sender' } }, 'sender').transfers.length, 2);
});


test('credit adjustments without a sender are not presented as a second incoming transfer', () => {
  const message = model.bubbleMessage('credit', { user: 'owner', name: 'Nico', verified: true, transactionIn: { amount: 20 } }, 'owner');
  assert.equal(message.transfers[0].title, 'PRN balance credit');
  assert.equal(message.transfers[0].from, '');
  assert.equal(message.transfers[0].to, 'You');
});

test('live history enriches receipt references from the loaded source without another query', async () => {
  const f = fixture();
  Object.assign(f.rows[0].payload.doc.data(), { transactionOut: { user: 'other', amount: 20, reference: 'Design' } });
  f.rows.push({ payload: { doc: { id: 'receipt', data: () => ({ chain: 'chat', user: 'other', name: 'Maya', verified: true, transactionIn: { user: 'owner', message: 'latest', amount: 20 } }) } } });
  const chat = await firstValueFrom(f.service.watch('chat', 30));
  assert.equal(chat.messages.find(message => message.id === 'receipt').transfers[0].reference, 'Design');
  assert.equal(f.queries.filter(query => query[0] === 'limit').length, 1);
});


test('production routes use the promoted component and old Bubbles URLs are redirects', () => {
  const source = readFileSync(new URL('../src/app/app-routing.module.ts', import.meta.url), 'utf8');
  const replacements = {};
  for (const match of source.matchAll(/from '([^']+)'/g)) if (match[1].startsWith('.')) replacements[match[1]] = new Proxy({}, { get: () => class {} });
  const ChatComponent = class {};
  let routes;
  replacements['./chat/chat.component'] = { ChatComponent };
  replacements['@angular/core'] = { NgModule: () => target => target };
  replacements['@angular/router'] = { RouterModule: { forRoot: value => { routes = value; return {}; } } };
  load('../src/app/app-routing.module.ts', replacements);
  for (const path of ['chat/:id', 'chat']) assert.equal(routes.find(route => route.path === path).component, ChatComponent);
  for (const [path, target] of [['prototypes/chat-bubbles/:id', 'chat/:id'], ['prototypes/chat-bubbles', 'chat']]) {
    const route = routes.find(route => route.path === path);
    assert.equal(route.redirectTo, target); assert.equal(route.pathMatch, 'full'); assert.equal(route.component, undefined);
  }
});


test('chat entry uses canonical navigation and preserves meaningful empty/error states', () => {
  const { ChatComponent } = load('../src/app/chat/chat.component.ts', {
    '@angular/core': { Component: () => target => target, ViewChild: () => () => {} },
    './chatRead.service': { ChatReadService: class {} },
    './chat-event/chat-event-editor.component': { ChatEventEditorComponent: class {} },
    './chat-fund/chat-fund-editor.component': { ChatFundEditorComponent: class {} },
    './chat-composer/chat-composer.component': { ChatComposerComponent: class {} }, './chatData': model
  });
  const zone = { run: fn => fn() }, reads = { reset() {} };
  const route = id => ({ paramMap: of({ get: () => id }), snapshot: { queryParamMap: { get: () => '' } } });
  for (const state of [{ status: 'ready', chain: 'latest' }, { status: 'ready', chain: '' }, { status: 'error', chain: '' }]) {
    const calls = [];
    const component = new ChatComponent(route(''), { navigate: (...args) => calls.push(args) }, {}, { latestHuman: of(state) }, zone, reads, undefined, { configure() {} });
    if (state.chain) assert.deepEqual(calls, [[['/chat', 'latest'], { replaceUrl: true }]]);
    else assert.equal(component.state, state.status === 'error' ? 'error' : 'empty');
    component.ngOnDestroy();
  }
  const broken = new ChatComponent(route('chat'), {}, { watch: () => throwError(() => Error('offline')) }, {}, zone, reads, undefined, { configure() {} });
  assert.equal(broken.state, 'error'); broken.ngOnDestroy();
});


test('time credits retain earned PRN and show the allowance remaining after each declaration', () => {
  const record = { user: 'owner', name: 'Nico', verified: true, text: '>> Contribution update', contract: {
    amount: 24.375, hoursValidated: 1.5, hoursDeclared: 2, hoursAvailable: 1.5, hoursTotal: 900, amountCummulate: 40000, message: 'private-signature'
  }, wallet: { balance: 999 } };
  const message = model.bubbleMessage('credit', record, 'owner');
  assert.deepEqual(message.timeCredits, { amount: 24.375, creditedHours: 1.5, declaredHours: 2, remainingHours: 0 });
  assert.equal(message.text, record.text); assert.equal('contract' in message, false); assert.equal('wallet' in message, false);
  assert.equal(model.bubbleMessage('credit', record, null).timeCredits.amount, 24.375);
  assert.equal(credits.creditDuration(1.5), '1h 30m'); assert.equal(credits.creditDuration(2), '2h');
});

test('remaining moving-window allowance uses the stored post-declaration result and supports older records', () => {
  const contract = { amount: 210, hoursValidated: 7, hoursAvailable: 10, hoursDeclared: 7 };
  const remaining = changes => credits.timeCredits({ verified: true, contract: { ...contract, ...changes } }).remainingHours;
  assert.equal(remaining({}), 3);
  assert.equal(remaining({ previousContractMessageHoursAvailable: 2.75 }), 2.75);
  assert.equal(remaining({ previousContractMessageHoursAvailable: 0 }), 0);
  for (const invalid of [undefined, null, -1, NaN, Infinity, '3']) assert.equal(remaining({ previousContractMessageHoursAvailable: invalid }), 3);
  assert.equal(remaining({ hoursAvailable: 6 }), 0);
  assert.equal(remaining({ hoursAvailable: undefined }), undefined);
  assert.equal(remaining({ hoursAvailable: undefined, previousContractMessageHoursAvailable: 0.5 }), 0.5);
});

test('time-credit amounts use the existing viewer-selected currency conversion and update with preferences', () => {
  const { UserInterfaceService } = load('../src/app/userInterface.service.ts', {
    '@angular/core': core, '../environments/environment': { environment: {} },
    '@angular/common': { formatNumber: (amount, locale, digits) => {
      const [, minimumFractionDigits, maximumFractionDigits] = digits.match(/\d+\.(\d+)-(\d+)/).map(Number);
      return new Intl.NumberFormat(locale, { minimumFractionDigits, maximumFractionDigits }).format(amount);
    } }
  });
  const UI = Object.create(UserInterfaceService.prototype);
  UI.PERRINNAdminLastMessageObj = { currencyList: { gbp: { toCOIN: 10, symbol: '£' }, usd: { toCOIN: 5, symbol: '$' } } };
  const service = new ChatDataService({}, {}, {}, {}, UI);
  UI.currentUserLastMessageObj = { userCurrency: 'gbp' };
  assert.equal(service.timeCreditAmount(210), 'PRN £21.00');
  UI.currentUserLastMessageObj = { userCurrency: 'usd' };
  assert.equal(service.timeCreditAmount(210), 'PRN $42.00');
  UI.currentUserLastMessageObj = null;
  assert.equal(service.timeCreditAmount(210), 'PRN $42.00');
});

test('time credit notes require confirmed positive awards and do not infer them from declaration text', () => {
  const valid = { verified: true, contract: { amount: 20, hoursValidated: 2, hoursDeclared: 2, hoursAvailable: 3 } };
  for (const verified of [undefined, false, 'true']) assert.equal(credits.timeCredits({ ...valid, verified }), null);
  for (const invalid of [undefined, null, 0, -1, NaN, Infinity, '20']) {
    assert.equal(credits.timeCredits({ ...valid, contract: { ...valid.contract, amount: invalid } }), null);
    assert.equal(credits.timeCredits({ ...valid, contract: { ...valid.contract, hoursValidated: invalid } }), null);
  }
  assert.equal(model.bubbleMessage('plain', { verified: true, text: '>>>> Four hours' }, null).timeCredits, null);
});

test('legacy missing window data is omitted and fractional credit durations stay readable', () => {
  assert.deepEqual(credits.timeCredits({ verified: true, contract: { amount: 0.00012, hoursValidated: 0.001 } }), { amount: 0.00012, creditedHours: 0.001 });
  assert.deepEqual(credits.timeCredits({ verified: true, contract: { amount: 20, hoursValidated: 2, hoursDeclared: NaN, hoursAvailable: -1 } }), { amount: 20, creditedHours: 2 });
  assert.equal(credits.creditDuration(0), '0m'); assert.equal(credits.creditDuration(0.001), '<1 min');
  assert.equal(credits.creditDuration(0.5), '30m'); assert.equal(credits.creditDuration(25), '25h');
});

test('live history projects time credits without adding reads or changing ordinary grouping', async () => {
  const f = fixture();
  Object.assign(f.rows[0].payload.doc.data(), { verified: true, contract: { amount: 20, hoursValidated: 2, hoursDeclared: 2, hoursAvailable: 3 } });
  const chat = await firstValueFrom(f.service.watch('chat', 30));
  assert.equal(chat.messages.find(message => message.id === 'latest').timeCredits.amount, 20);
  assert.equal(f.queries.filter(query => query[0] === 'limit').length, 1);
  const first = model.bubbleMessage('one', { user: 'owner', serverTimestamp: 10000, verified: true, contract: { amount: 20, hoursValidated: 2 } }, 'owner');
  assert.equal(model.continuesMessageGroup(first, { ...first, id: 'two', timestamp: 20000 }, ''), true);
});

test('raised draft conversion accepts zero and rejects blank, negative and unsafe amounts', () => {
  const currency = { code: 'usd', perGBP: 1.25 };
  assert.equal(funds.raisedFromDraft(125, currency), 100);
  assert.equal(funds.raisedFromDraft(0, currency), 0);
  for (const value of [null, undefined, '', '10', -1, NaN, Infinity, 1e20]) assert.throws(() => funds.raisedFromDraft(value, currency));
  assert.throws(() => funds.raisedFromDraft(1, { code: 'gbp', perGBP: 0 }));
});

test('fund service protects raised corrections and cancellations with the real matching Auth token', async () => {
  const f = fixture();
  for (const claims of [{ sub: 'owner' }, { sub: 'owner', perrinnAdmin: 'true' }, { sub: 'other', perrinnAdmin: true }]) {
    f.auth.currentUser = Promise.resolve({ uid: 'owner', getIdTokenResult: async () => ({ claims }) });
    await assert.rejects(f.service.saveFund('chat', { ...sampleFund, daysLeft: 12, amountGBPRaised: 0 }), /Admin permission/);
    await assert.rejects(f.service.cancelFund('chat', sampleFund), /Admin permission/);
    await assert.rejects(f.service.endFund('chat', sampleFund), /Admin permission/);
    // Ordinary fund edits remain available to signed-in participants.
    await f.service.saveFund('chat', { description: 'Testing', amountGBPTarget: 100, daysLeft: 30 });
    assert.equal(f.writes.at(-1).fund.amountGBPRaised, undefined);
  }
  f.auth.currentUser = Promise.resolve({ uid: 'owner', getIdTokenResult: async () => ({ claims: { sub: 'owner', perrinnAdmin: true } }) });
  for (const amountGBPRaised of [125.25, 0]) {
    await f.service.saveFund('chat', { ...sampleFund, daysLeft: 12, amountGBPRaised });
    assert.equal(f.writes.at(-1).fund.amountGBPRaised, amountGBPRaised);
    assert.match(f.writes.at(-1).text, new RegExp('Raised: GBP ' + amountGBPRaised.toFixed(2)));
  }
  const count = f.writes.length;
  await assert.rejects(f.service.saveFund('chat', { ...sampleFund, daysLeft: 12, amountGBPRaised: -1 }));
  assert.equal(f.writes.length, count);
});

test('admin fund editor converts corrections, preserves unchanged precision, and blocks role loss', async () => {
  const oldRAF = globalThis.requestAnimationFrame; globalThis.requestAnimationFrame = fn => fn();
  const calls = [], permissions = { current: { ready: true, isAdmin: true } };
  const data = { fundCurrency: { code: 'usd', perGBP: 1.2345 }, saveFund: async (...args) => calls.push(args), cancelFund: async () => calls.push('cancel') };
  const editor = new ChatFundEditorComponent(data, { run: fn => fn() }, permissions);
  Object.assign(editor, { chain: 'chat', signedIn: true, fund: { ...sampleFund, amountGBPRaised: 0.05 } });
  editor.ngOnChanges();
  try {
    editor.edit(); assert.equal(editor.draft.raised, 0.06);
    editor.draft.description = 'Updated'; await editor.save();
    assert.equal(Object.hasOwn(calls[0][1], 'amountGBPRaised'), false);
    editor.edit(); editor.draft.raised = 123.45; await editor.save(); assert.equal(calls[1][1].amountGBPRaised, 100);
    editor.edit(); editor.draft.raised = 0; await editor.save(); assert.equal(calls[2][1].amountGBPRaised, 0);
    editor.edit(); editor.draft.raised = null; await editor.save(); assert.match(editor.error, /zero or more/); assert.equal(calls.length, 3);
    editor.draft.raised = 10; permissions.current.isAdmin = false; await editor.save(); assert.match(editor.error, /Admin permission/);
    editor.dismiss(); editor.askCancel(); assert.equal(editor.confirmation, null);
    editor.confirmation = 'cancel'; await editor.cancel(); assert.equal(calls.length, 3);
    editor.edit(); assert.equal(editor.draft.raised, undefined); assert.equal(editor.isAdmin, false);
    permissions.current = { ready: false, isAdmin: true }; assert.equal(editor.isAdmin, false);
    permissions.current.ready = true; editor.signedIn = false; assert.equal(editor.isAdmin, false);
  } finally { editor.ngOnDestroy(); globalThis.requestAnimationFrame = oldRAF; }
});

test('fund editor preserves the exact deadline across display-day changes and blocks accidental reopening at expiry', async () => {
  const oldRAF=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=fn=>fn();
  const calls=[],data={fundCurrency:{code:'gbp',perGBP:1},saveFund:async(...args)=>calls.push(args)};
  const editor=new ChatFundEditorComponent(data,{run:fn=>fn()},{current:{ready:true,isAdmin:true}});
  Object.assign(editor,{chain:'chat',signedIn:true,fund:{...sampleFund}});editor.ngOnChanges();
  try {
    editor.edit();editor.draft.description='Updated';editor.fund={...editor.fund,daysLeft:10};await editor.save();
    assert.equal(calls.length,1);assert.equal(calls[0][3],sampleFund.closesAt);
    editor.edit();editor.draft.description='After expiry';editor.now=sampleFund.closesAt;await editor.save();
    assert.equal(calls.length,1);assert.match(editor.error,/ended/);
  } finally {editor.ngOnDestroy();globalThis.requestAnimationFrame=oldRAF;}
});

test('conversation avatar projection retains all sizes without substituting the latest author photo', async () => {
  const f = fixture();
  const latest = f.rows[0].payload.doc.data();
  Object.assign(latest, { chatProfileImageUrlThumb: 'broken-thumb', chatProfileImageUrlMedium: 'medium', chatProfileImageUrlOriginal: 'original', imageUrlThumbUser: 'author' });
  assert.deepEqual((await firstValueFrom(f.service.watch('chat', 30))).avatarSources, ['broken-thumb', 'medium', 'original']);
  latest.chatProfileImageUrlThumb = ''; latest.chatProfileImageUrlMedium = undefined;
  assert.deepEqual((await firstValueFrom(f.service.watch('chat', 30))).avatarSources, ['original']);
  latest.chatProfileImageUrlOriginal = undefined;
  assert.deepEqual((await firstValueFrom(f.service.watch('chat', 30))).avatarSources, []);
});


test('admin end-fund command changes only the deadline and rejects signed-out or already ended funds', async () => {
  const f=fixture();
  const before=Date.now();await f.service.endFund('chat',sampleFund);
  assert.deepEqual(Object.keys(f.writes[0].fund),['closesAt']);
  assert.ok(f.writes[0].fund.closesAt>=before-1&&f.writes[0].fund.closesAt<Date.now());
  assert.equal(f.writes[0].text,'Ended fund: Track testing');
  assert.equal(f.writes[0].chain,'chat');
  await assert.rejects(f.service.endFund('',sampleFund));
  await assert.rejects(f.service.endFund('chat',{...sampleFund,closesAt:Date.now()-1}));
  await assert.rejects(fixture(null).service.endFund('chat',sampleFund));
  assert.equal(f.writes.length,1);
});

test('end fund requires confirmation, blocks role loss and stale state, and retains a failed confirmation for retry', async () => {
  const oldRAF=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=fn=>fn();
  let fail=true;const calls=[],permissions={current:{ready:true,isAdmin:true}};
  const editor=new ChatFundEditorComponent({fundCurrency:{code:'gbp',perGBP:1},endFund:async(...args)=>{calls.push(args);if(fail)throw Error('offline');}},{run:fn=>fn()},permissions);
  Object.assign(editor,{chain:'chat',signedIn:true,fund:sampleFund});editor.ngOnChanges();
  try {
    await editor.end();assert.equal(calls.length,0);
    editor.askEnd();assert.equal(editor.confirmation,'end');
    permissions.current.isAdmin=false;await editor.end();assert.equal(calls.length,0);
    permissions.current.isAdmin=true;editor.fund={...sampleFund,amountGBPRaised:200};await editor.end();
    assert.equal(calls.length,0);assert.equal(editor.confirmation,null);
    editor.askEnd();await editor.end();assert.equal(calls.length,1);assert.equal(editor.confirmation,'end');assert.match(editor.error,/Try again/);
    fail=false;await editor.end();assert.equal(calls.length,2);assert.equal(editor.confirmation,null);assert.equal(editor.notice,'Fund ending sent');
    editor.askEnd();editor.fund={...editor.fund,closesAt:Date.now()-1};editor.ngOnChanges();await editor.end();assert.equal(calls.length,2);
    editor.fund=sampleFund;editor.ngOnChanges();editor.askEnd();editor.signedIn=false;editor.ngOnChanges();assert.equal(editor.confirmation,null);
  } finally {editor.ngOnDestroy();globalThis.requestAnimationFrame=oldRAF;}
});

test('input mode reads only verified loaded state and voice metadata remains on the individual message', async () => {
  const f = fixture();
  f.rows[0].payload.doc.data = () => ({ chain: 'chat', chatInputMode: 'text', lastMessage: true, verified: false, recipientList: ['intruder'] });
  f.rows[1].payload.doc.data = () => ({ chain: 'chat', chatInputMode: 'voice', verified: true, user: 'other', recipientList: ['owner', 'other'], voice: { eventId: 'known', durationMs: 1000, expiresAt: 123, transcription: 'completed' } });
  const chat = await firstValueFrom(f.service.watch('chat', 30));
  assert.equal(chat.inputMode, 'voice'); assert.deepEqual(chat.voiceRecipients, ['owner', 'other']);
  assert.equal(chat.messages[0].voice.eventId, 'known'); assert.equal(chat.messages[1].voice, undefined);
  assert.deepEqual(f.queries.filter(row => row[0] === 'limit'), [['limit', 30]]);
});
test('admin mode changes submit normal message-state commands, while nonadmins and switched accounts cannot write them', async () => {
  const f = fixture();
  await f.service.updateInputMode('chat', 'voice');
  assert.deepEqual(f.writes[0], { chain: 'chat', chatInputMode: 'voice', text: 'Enabled voice input' });
  f.auth.currentUser = Promise.resolve({ uid: 'owner', getIdTokenResult: async () => ({ claims: { sub: 'owner', perrinnAdmin: 'true' } }) });
  await assert.rejects(f.service.updateInputMode('chat', 'text'), /Admin permission/); assert.equal(f.writes.length, 1);
  f.auth.currentUser = Promise.resolve({ uid: 'other', getIdTokenResult: async () => ({ claims: { sub: 'other', perrinnAdmin: true } }) });
  await assert.rejects(f.service.updateInputMode('chat', 'text'), /Sign in/);
});

test('pending participant commands preserve the verified list without extra reads', async () => {
  const f = fixture();
  const previous = { ...f.rows[0].payload.doc.data(), verified: true };
  f.rows[1].payload.doc.data = () => previous;
  f.rows[0].payload.doc.data = () => ({ user: 'owner', text: 'Removed Maya', chain: 'chat', verified: false,
    participantChange: { action: 'remove', userId: 'other' }, serverTimestamp: { seconds: 40 } });
  const chat = await firstValueFrom(f.service.watch('chat', 30));
  assert.deepEqual(chat.members.map(person => person.id), ['owner', 'other']);
  assert.deepEqual(f.queries, [['where', 'chain', '==', 'chat'], ['orderBy', 'serverTimestamp', 'desc'], ['limit', 30]]);
  assert.equal(f.cursors.length, 1);
});
