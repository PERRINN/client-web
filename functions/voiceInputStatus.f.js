const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { getVoiceInputStatus } = require('./utils/voiceInput');
const { VoiceInputError } = require('./utils/voiceAudio');

exports.voiceInputStatus = onCall({
  timeoutSeconds: 15, maxInstances: 2, concurrency: 2, memory: '256MiB', minInstances: 0
}, async request => {
  try {
    return await getVoiceInputStatus(admin.firestore(), request.auth, request.data);
  } catch (error) {
    if (error instanceof VoiceInputError) throw new HttpsError(error.code, error.message, error.details);
    throw new HttpsError('unavailable', 'Could not check the recording.');
  }
});
