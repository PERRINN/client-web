const { VoiceInputError } = require('./voiceAudio');
const { authorizeVoiceConversation, VOICE_ADMIN, VOICE_PARTICIPANTS } = require('./voiceConversation');

// One known event, at most three transaction attempts, and one bounded object
// download. Automatic delivery is claimed once; manual replay remains available.
async function voicePlayback(db, bucket, auth, data, now = Date.now()) {
  authorizeVoiceConversation(auth, 'pilot');
  if (!data || Object.keys(data).some(key => !['eventId', 'automatic'].includes(key))
    || !/^[a-f0-9]{64}$/.test(data.eventId || '') || typeof data.automatic !== 'boolean') {
    throw new VoiceInputError('invalid-argument', 'Invalid recording.');
  }
  const ref = db.doc('VoiceInputEvents/' + data.eventId);
  const event = await db.runTransaction(async tx => {
    const event = (await tx.get(ref)).data();
    if (!event || event.conversationId !== 'pilot' || !['queued', 'processing', 'completed'].includes(event.status)
      || !Number.isFinite(event.audioExpiresAt) || event.audioExpiresAt <= now
      || event.audioPath !== `voice-input/${event.userId}/${data.eventId}.wav`) {
      throw new VoiceInputError('not-found', 'Recording unavailable.');
    }
    // Validate author as well as current participant access.
    if (![VOICE_ADMIN, ...VOICE_PARTICIPANTS].includes(event.userId)) throw new VoiceInputError('not-found', 'Recording unavailable.');
    if (data.automatic) {
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
