const { createHash, randomUUID } = require('node:crypto');
const { VoiceInputError, validateInput } = require('./voiceAudio');
const { authorizeVoiceConversation, sharedVoiceMessage, VOICE_PARTICIPANT } = require('./voiceConversation');

const eventIdFor = (uid, requestId) => createHash('sha256').update(uid + ':' + requestId).digest('hex');
const fail = (code, message, details) => { throw new VoiceInputError(code, message, details); };
const receipt = event => ({ eventId: event.eventId, status: event.status, ...(event.status === 'completed' ? { transcript: event.transcript } : {}) });
const stale = (event, now) => now - (event.createdAt?.toMillis?.() || 0) >= 120000;

async function enqueueVoiceInput(db, bucket, auth, data, options) {
  if (!auth?.uid) fail('unauthenticated', 'Sign in to record.');
  if (!data || data.owner !== auth.uid) fail('permission-denied', 'Recording owner changed.');
  const { owner, conversationId, ...recording } = data;
  if (conversationId !== undefined) authorizeVoiceConversation(auth, conversationId);
  const input = validateInput(recording), now = options.now?.() ?? Date.now();
  const eventId = eventIdFor(auth.uid, data.requestId), ref = db.doc('VoiceInputEvents/' + eventId);
  const audioPath = `voice-input/${auth.uid}/${eventId}.wav`;
  const event = await db.runTransaction(async tx => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      const saved = existing.data();
      if (saved.userId !== auth.uid || saved.fingerprint !== input.fingerprint || saved.conversationId !== conversationId) fail('invalid-argument', 'Recording ID already used.');
      if (saved.status === 'completed' || (saved.inboxVersion === 1 && saved.status === 'failed')) return saved;
      if (saved.inboxVersion !== 1 && saved.status === 'processing' && !stale(saved, now)) {
        fail('aborted', 'Recording is still processing.');
      }
      if (saved.inboxVersion === 1) return saved;
      // Adopt an old failed/stalled request without changing its identity or
      // charging another accepted-input allowance. Its old attempt counts too.
      const adopted = { ...saved, inboxVersion: 1, audioPath, status: 'receiving', attempts: 1 };
      tx.update(ref, { inboxVersion: 1, audioPath, status: 'receiving', attempts: 1 });
      return adopted;
    }
    const limitRef = db.doc('VoiceInputLimits/' + auth.uid), limit = (await tx.get(limitRef)).data() || {};
    const day = new Date(now).toISOString().slice(0, 10), count = limit.day === day ? limit.count || 0 : 0;
    const dailyLimit = auth.uid === VOICE_PARTICIPANT
      || auth.uid === options.highLimitUid && auth.token?.perrinnAdmin === true ? 1000 : 20;
    if (count >= dailyLimit) fail('resource-exhausted', 'Daily recording limit reached.', { reason: 'daily-limit', dailyLimit });
    const created = { eventId, userId: auth.uid, sourcePage: data.sourcePage, createdAt: options.timestamp(),
      ...(conversationId ? { conversationId, requestId: data.requestId, authorName: typeof auth.token?.name === 'string' ? auth.token.name.slice(0, 100) : '' } : {}),
      status: 'receiving', inboxVersion: 1, audioPath, durationMs: input.durationMs, fingerprint: input.fingerprint,
      provider: 'openai', model: options.model, attempts: 0 };
    tx.create(ref, created);
    tx.set(limitRef, { ...limit, day, count: count + 1 });
    return created;
  }, { maxAttempts: 3 });
  if (event.status === 'completed' || event.status === 'failed') return receipt(event);
  // Only the trusted server can write/read this prefix. Never create download
  // tokens or signed URLs. Generation preconditions make retries immutable.
  const file = bucket.file(audioPath);
  try {
    await file.save(input.audio, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType: 'audio/wav', metadata: { fingerprint: input.fingerprint } } });
  } catch (error) {
    if (Number(error.code) !== 412) throw error;
    const [metadata] = await file.getMetadata();
    if (metadata.metadata?.fingerprint !== input.fingerprint) fail('failed-precondition', 'Recording storage mismatch.');
  }
  const saved = await db.runTransaction(async tx => {
    const saved = (await tx.get(ref)).data();
    if (saved?.status === 'receiving') tx.update(ref, { status: 'queued', receivedAt: options.timestamp() });
    return saved;
  }, { maxAttempts: 3 });
  if (saved?.status === 'completed') {
    try { await file.delete({ ignoreNotFound: true }); } catch { /* Lifecycle fallback. */ }
    return receipt(saved);
  }
  try { await options.enqueue({ eventId }, { id: eventId, dispatchDeadlineSeconds: 90 }); }
  catch (error) { if (error.code !== 'functions/task-already-exists') throw error; }
  // Acknowledge only AFTER durable audio, metadata AND the task exist. If any
  // acknowledgement is lost, the phone keeps its copy and repeats this ID.
  return { eventId, status: 'queued' };
}

async function processVoiceInbox(db, bucket, data, options) {
  if (!data || Object.keys(data).length !== 1 || typeof data.eventId !== 'string' || !/^[a-f0-9]{64}$/.test(data.eventId)) {
    fail('invalid-argument', 'Invalid inbox task.');
  }
  const now = options.now?.() ?? Date.now(), ref = db.doc('VoiceInputEvents/' + data.eventId), attemptId = randomUUID();
  const reserved = await db.runTransaction(async tx => {
    const event = (await tx.get(ref)).data();
    if (!event || event.inboxVersion !== 1 || ['completed', 'failed'].includes(event.status)) return null;
    if (event.status === 'receiving' || event.processingUntil > now) throw new Error('Recording is not ready.');
    const limitRef = db.doc('VoiceInputLimits/' + event.userId), limit = (await tx.get(limitRef)).data() || {};
    if (limit.activeUntil > now) throw new Error('Another recording is processing.');
    if ((event.attempts || 0) >= 3) {
      tx.update(ref, { status: 'failed', failureCode: 'attempt-limit', completedAt: options.timestamp() }); return null;
    }
    tx.update(ref, { status: 'processing', attempts: (event.attempts || 0) + 1, processingAttempt: attemptId, processingUntil: now + 90000 });
    tx.set(limitRef, { ...limit, activeEvent: event.eventId, activeAttempt: attemptId, activeUntil: now + 90000 });
    return { ...event, attempts: (event.attempts || 0) + 1 };
  }, { maxAttempts: 3 });
  if (!reserved) return;
  const limitRef = db.doc('VoiceInputLimits/' + reserved.userId);
  let retry = false;
  try {
    const expectedPath = `voice-input/${reserved.userId}/${data.eventId}.wav`;
    if (reserved.audioPath !== expectedPath) fail('failed-precondition', 'Invalid recording storage.');
    const file = bucket.file(expectedPath), [metadata] = await file.getMetadata();
    if (!Number.isSafeInteger(Number(metadata.size)) || Number(metadata.size) > 960044 || Number(metadata.size) < 12844) fail('failed-precondition', 'Invalid recording size.');
    const [audio] = await file.download({ start: 0, end: 960044 });
    const input = validateInput({ requestId: '00000000-0000-0000-0000-000000000000', sourcePage: '/prototypes/voice-input', audio: audio.toString('base64') });
    if (input.fingerprint !== reserved.fingerprint) fail('failed-precondition', 'Invalid recording fingerprint.');
    const transcript = await options.transcribe(input.audio, reserved.model);
    if (typeof transcript !== 'string' || !transcript.trim() || transcript.length > 20000) fail('failed-precondition', 'No transcript returned.');
    const completed = await db.runTransaction(async tx => {
      const event = (await tx.get(ref)).data();
      if (event?.processingAttempt === attemptId && event.status === 'processing') {
        tx.update(ref, { status: 'completed', transcript, completedAt: options.timestamp(), processingUntil: 0 });
        if (event.conversationId) {
          const message = sharedVoiceMessage(event, transcript, options.timestamp());
          tx.create(db.doc(`VoiceConversations/${event.conversationId}/messages/${event.eventId}`), message);
        }
        return true;
      }
      return event?.status === 'completed';
    }, { maxAttempts: 3 });
    // Failure to delete must never undo a saved transcript or cause another
    // transcription. Prefix-scoped bucket lifecycle is the cleanup fallback.
    if (completed) try { await file.delete({ ignoreNotFound: true }); } catch { /* Lifecycle fallback. */ }
  } catch (error) {
    const permanent = error instanceof VoiceInputError && ['invalid-argument', 'failed-precondition'].includes(error.code);
    retry = !permanent && reserved.attempts < 3 && (options.retryCount || 0) < 7;
    await db.runTransaction(async tx => {
      const event = (await tx.get(ref)).data();
      // A success write can commit even if its acknowledgement is lost.
      if (event?.processingAttempt === attemptId && event.status === 'processing') {
        tx.update(ref, { status: retry ? 'queued' : 'failed', processingUntil: 0,
          ...(retry ? {} : { failureCode: 'transcription-unavailable', completedAt: options.timestamp() }) });
      } else if (event?.status === 'completed') retry = false;
    }, { maxAttempts: 3 });
  } finally {
    await db.runTransaction(async tx => {
      const limit = (await tx.get(limitRef)).data();
      if (limit?.activeAttempt === attemptId) tx.update(limitRef, { activeUntil: 0 });
    }, { maxAttempts: 3 });
  }
  if (retry) throw new Error('Transcription temporarily unavailable.');
}

// Final Cloud Tasks delivery must leave a terminal result even if preparation,
// storage or contention failed before a provider attempt could be reserved.
async function failExhaustedInbox(db, eventId, timestamp) {
  if (typeof eventId !== 'string' || !/^[a-f0-9]{64}$/.test(eventId)) return;
  const ref = db.doc('VoiceInputEvents/' + eventId);
  await db.runTransaction(async tx => {
    const event = (await tx.get(ref)).data();
    if (event?.inboxVersion === 1 && !['completed', 'failed'].includes(event.status)) {
      tx.update(ref, { status: 'failed', failureCode: 'delivery-limit', completedAt: timestamp() });
    }
  }, { maxAttempts: 3 });
}
module.exports = { enqueueVoiceInput, processVoiceInbox, failExhaustedInbox, eventIdFor };
