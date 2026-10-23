const { createHash } = require('node:crypto');
const { VoiceInputError, validateInput } = require('./voiceAudio');
const { VOICE_PARTICIPANT } = require('./voiceConversation');

const fail = (code, message, details) => { throw new VoiceInputError(code, message, details); };
const result = event => ({ eventId: event.eventId, transcript: event.transcript });

// Lookup is deliberately read-only: an uncertain provider attempt must never be
// restarted by recovery. Derive the path from auth, never from a caller's UID.
async function getVoiceInputStatus(db, auth, data, now = Date.now()) {
  if (!auth?.uid) fail('unauthenticated', 'Sign in to check your recording.');
  if (!data || Object.keys(data).length !== 1 || typeof data.requestId !== 'string'
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(data.requestId || '')) {
    fail('invalid-argument', 'Invalid recording ID.');
  }
  const eventId = createHash('sha256').update(auth.uid + ':' + data.requestId).digest('hex');
  const snapshot = await db.doc('VoiceInputEvents/' + eventId).get();
  if (!snapshot.exists) return { status: 'missing' };
  const event = snapshot.data();
  if (event.userId !== auth.uid) fail('permission-denied', 'Recording unavailable.');
  if (event.status === 'completed' && typeof event.transcript === 'string') return { status: 'completed', ...result(event) };
  if (event.inboxVersion === 1 && ['receiving', 'queued', 'processing'].includes(event.status)) return { status: 'processing' };
  if (event.status === 'processing') {
    const createdAt = event.createdAt?.toMillis?.();
    return { status: Number.isFinite(createdAt) && now - createdAt < 120000 ? 'processing' : 'stalled' };
  }
  return { status: 'failed' };
}

async function processVoiceInput(db, auth, data, options) {
  if (!auth?.uid) fail('unauthenticated', 'Sign in to use voice input.');
  const input = validateInput(data);
  const now = options.now?.() ?? Date.now();
  const eventId = createHash('sha256').update(auth.uid + ':' + data.requestId).digest('hex');
  const eventRef = db.doc('VoiceInputEvents/' + eventId);
  const limitRef = db.doc('VoiceInputLimits/' + auth.uid);
  const day = new Date(now).toISOString().slice(0, 10);
  // The pilot participant shares the configured admin's allowance, not their role.
  const dailyLimit = auth.uid === VOICE_PARTICIPANT
    || auth.uid === options.highLimitUid && auth.token?.perrinnAdmin === true ? 1000 : 20;
  const event = {
    eventId, userId: auth.uid, sourcePage: data.sourcePage, status: 'processing',
    createdAt: options.timestamp(), durationMs: input.durationMs, fingerprint: input.fingerprint,
    provider: 'openai', model: options.model
  };
  const replay = await db.runTransaction(async tx => {
    const existing = await tx.get(eventRef);
    if (existing.exists) {
      const saved = existing.data();
      if (saved.fingerprint !== input.fingerprint || saved.userId !== auth.uid) fail('invalid-argument', 'Recording ID already used.');
      if (saved.status === 'completed') return result(saved);
      if (saved.status === 'processing') fail('aborted', 'Recording is still processing. Check again shortly.');
      fail('failed-precondition', 'This recording failed. Record again.');
    }
    const limit = (await tx.get(limitRef)).data() || {};
    if (limit.activeUntil > now) fail('resource-exhausted', 'A recording is still processing. Try later.', { reason: 'recording-processing' });
    const count = limit.day === day ? limit.count : 0;
    if (count >= dailyLimit) fail('resource-exhausted', 'Daily recording limit reached. Your allowance resets at midnight UTC.',
      { reason: 'daily-limit', dailyLimit });
    tx.create(eventRef, event);
    tx.set(limitRef, { day, count: count + 1, activeEvent: eventId, activeUntil: now + 90000 });
    return null;
  }, { maxAttempts: 3 });
  if (replay) return replay;

  let transcript;
  try {
    transcript = await options.transcribe(input.audio);
    // Persist before returning; a failed save must never appear as success.
    await eventRef.update({ status: 'completed', transcript, completedAt: options.timestamp() });
  } catch (error) {
    try {
      await db.runTransaction(async tx => {
        const saved = (await tx.get(eventRef)).data();
        // The success write may have committed even if its acknowledgement was lost.
        if (saved?.status === 'processing') tx.update(eventRef, { status: 'failed', completedAt: options.timestamp() });
      }, { maxAttempts: 3 });
    } catch { /* Leave a replay-safe processing marker. */ }
    if (error instanceof VoiceInputError) throw error;
    throw new VoiceInputError('internal', 'Could not save the transcript. Check this recording before recording again.');
  } finally {
    // Compare the lease identity so late cleanup cannot unlock a newer request.
    try {
      await db.runTransaction(async tx => {
        const lease = (await tx.get(limitRef)).data();
        if (lease?.activeEvent === eventId) tx.update(limitRef, { activeUntil: 0 });
      }, { maxAttempts: 3 });
    } catch { /* The 90-second lease expires without a cleanup job. */ }
  }
  return { eventId, transcript };
}

module.exports = { processVoiceInput, getVoiceInputStatus };
