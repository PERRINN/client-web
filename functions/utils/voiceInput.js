const { createHash } = require('node:crypto');
const { VoiceInputError } = require('./voiceAudio');

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


module.exports = { getVoiceInputStatus };
