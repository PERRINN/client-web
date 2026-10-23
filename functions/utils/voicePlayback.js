const { VoiceInputError } = require('./voiceAudio');
const { voiceChatChain, currentVoiceChat } = require('./chatVoice');

// One known event, at most three transaction attempts, and one bounded object
// download. Recipients authorize on every request without a global claim.
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
    if (!chain) throw new VoiceInputError('not-found', 'Recording unavailable.');
    const chat = await currentVoiceChat(db, chain, tx);
    if (!chat.recipientList?.includes(auth.uid)) throw new VoiceInputError('permission-denied', 'Recording unavailable.');
    if (event.audioValidated !== true || event.status !== 'completed'
      || !Number.isFinite(event.audioExpiresAt) || event.audioExpiresAt <= now
      || event.audioPath !== `voice-input/${event.userId}/${data.eventId}.wav`) {
      throw new VoiceInputError('not-found', 'Recording unavailable.');
    }
    if (data.automatic && event.userId === auth.uid) return null;
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
