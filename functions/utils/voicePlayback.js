const { VoiceInputError } = require('./voiceAudio');
const { voiceChatChain, currentVoiceChat } = require('./chatVoice');
const { authorizeVoiceConversation, VOICE_ADMIN, VOICE_PARTICIPANTS } = require('./voiceConversation');

// One known event, at most three transaction attempts, and one bounded object
// download. The pilot retains its single automatic claim; production recipients
// authorize independently on every request, without retaining a global claim.
async function voicePlayback(db, bucket, auth, data, now = Date.now()) {
  if (!auth?.uid) throw new VoiceInputError('unauthenticated', 'Sign in to listen.');
  if (!data || Object.keys(data).some(key => !['eventId', 'automatic'].includes(key))
    || !/^[a-f0-9]{64}$/.test(data.eventId || '') || typeof data.automatic !== 'boolean') {
    throw new VoiceInputError('invalid-argument', 'Invalid recording.');
  }
  const ref = db.doc('VoiceInputEvents/' + data.eventId);
  const event = await db.runTransaction(async tx => {
    const event = (await tx.get(ref)).data();
    const chain = voiceChatChain(event?.conversationId);
    if (chain) {
      const chat = await currentVoiceChat(db, chain, tx);
      if (!chat.recipientList?.includes(auth.uid)) throw new VoiceInputError('permission-denied', 'Recording unavailable.');
    } else authorizeVoiceConversation(auth, 'pilot');
    if (!event || (!chain && event.conversationId !== 'pilot') || (chain && (event.audioValidated !== true || event.status !== 'completed')) || !['queued', 'processing', 'completed'].includes(event.status)
      || !Number.isFinite(event.audioExpiresAt) || event.audioExpiresAt <= now
      || event.audioPath !== `voice-input/${event.userId}/${data.eventId}.wav`) {
      throw new VoiceInputError('not-found', 'Recording unavailable.');
    }
    // Validate author as well as current participant access.
    if (!chain && ![VOICE_ADMIN, ...VOICE_PARTICIPANTS].includes(event.userId)) throw new VoiceInputError('not-found', 'Recording unavailable.');
    if (data.automatic && chain && event.userId === auth.uid) return null;
    if (data.automatic && !chain) {
      if (event.userId === auth.uid || event.audioAutoClaimedAt) return null;
      tx.update(ref, { audioAutoClaimedAt: now });
    }
    return event;
  }, { maxAttempts: 3 });
  if (!event) return { skipped: true };
  const file = bucket.file(event.audioPath), [metadata] = await file.getMetadata();
  if (!Number.isSafeInteger(Number(metadata.size)) || Number(metadata.size) < 12844 || Number(metadata.size) > 960044) {
    throw new VoiceInputError('not-found', 'Recording unavailable.');
  }
  const [audio] = await file.download({ start: 0, end: 960044 });
  if (audio.length !== Number(metadata.size)) throw new VoiceInputError('not-found', 'Recording unavailable.');
  return { audio: audio.toString('base64'), expiresAt: event.audioExpiresAt };
}
module.exports = { voicePlayback };
