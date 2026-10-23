const { VoiceInputError } = require('./voiceAudio');

// Pilot participants only. This allowlist does not grant an application admin role.
const VOICE_CONVERSATION = 'pilot';
const VOICE_ADMIN = 'QYm5NATKa6MGD87UpNZCTl6IolX2';
const VOICE_PARTICIPANT = 'xDfdZLLRHuObIUNEUj8SdClxZXf2';
const VOICE_PARTICIPANTS = [VOICE_PARTICIPANT, 'sks8zpXOy7ZBzhOIx1ISjtNgegh1'];

function authorizeVoiceConversation(auth, conversationId) {
  if (conversationId !== VOICE_CONVERSATION || !auth?.uid
    || !(VOICE_PARTICIPANTS.includes(auth.uid) || auth.uid === VOICE_ADMIN && auth.token?.perrinnAdmin === true)) {
    throw new VoiceInputError('permission-denied', 'This voice conversation is private.');
  }
}

function sharedVoiceMessage(event, transcript, createdAt) {
  // Validate trusted event routing too; never publish a legacy private event.
  if (event.conversationId !== VOICE_CONVERSATION || ![VOICE_ADMIN, ...VOICE_PARTICIPANTS].includes(event.userId)
    || typeof event.requestId !== 'string') throw new VoiceInputError('failed-precondition', 'Invalid voice conversation.');
  return { userId: event.userId, requestId: event.requestId, text: transcript, createdAt,
    ...(Number.isFinite(event.audioExpiresAt) ? { source: 'voice', audioExpiresAt: event.audioExpiresAt } : {}),
    authorName: event.authorName || (event.userId === VOICE_ADMIN ? 'Admin' : 'Participant') };
}

module.exports = { authorizeVoiceConversation, sharedVoiceMessage, VOICE_CONVERSATION, VOICE_ADMIN, VOICE_PARTICIPANT, VOICE_PARTICIPANTS };
