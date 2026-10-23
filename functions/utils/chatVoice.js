const { VoiceInputError } = require('./voiceAudio');

function voiceChatChain(destination) {
  if (typeof destination !== 'string' || !destination.startsWith('chat:')) return null;
  const chain = destination.slice(5);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(chain)) throw new VoiceInputError('invalid-argument', 'Invalid chat.');
  return chain;
}

// One indexed, limit-one query. Never accept recipients supplied by the caller.
async function currentVoiceChat(db, chain, transaction) {
  const query = db.collection('PERRINNMessages').where('chain', '==', chain)
    .where('verified', '==', true).orderBy('serverTimestamp', 'desc').limit(1);
  const rows = await (transaction ? transaction.get(query) : query.get());
  if (rows.empty) throw new VoiceInputError('not-found', 'Chat unavailable.');
  return rows.docs[0].data();
}

async function validateChatInputMode(message, auth) {
  if (!Object.prototype.hasOwnProperty.call(message, 'chatInputMode')) return;
  if (!['text', 'voice'].includes(message.chatInputMode)) {
    throw new VoiceInputError('invalid-argument', 'Invalid chat input mode.');
  }
  const account = await auth.getUser(message.user);
  if (account.disabled || account.customClaims?.perrinnAdmin !== true) {
    throw new VoiceInputError('permission-denied', 'Admin permission is required to change chat input.');
  }
}

function publishChatVoice(tx, db, event, transcript, timestamp) {
  const chain = voiceChatChain(event.conversationId);
  if (!chain || event.audioValidated !== true || !Number.isFinite(event.audioExpiresAt)) return false;
  tx.create(db.doc('PERRINNMessages/voice-' + event.eventId), {
    user: event.userId, chain, text: transcript, serverTimestamp: timestamp(),
    voice: { eventId: event.eventId, durationMs: event.durationMs, expiresAt: event.audioExpiresAt,
      transcription: transcript ? 'completed' : 'unavailable' }
  });
  return true;
}

module.exports = { voiceChatChain, currentVoiceChat, validateChatInputMode, publishChatVoice };
