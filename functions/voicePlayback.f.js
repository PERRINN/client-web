const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { voicePlayback } = require('./utils/voicePlayback');
const { VoiceInputError } = require('./utils/voiceAudio');

exports.voicePlayback = onCall({ timeoutSeconds: 30, maxInstances: 2, concurrency: 4, memory: '256MiB', minInstances: 0 }, async request => {
  try {
    return await voicePlayback(admin.firestore(), admin.storage().bucket(), request.auth, request.data);
  } catch (error) {
    if (error instanceof VoiceInputError) throw new HttpsError(error.code, error.message);
    throw new HttpsError('unavailable', 'Recording unavailable. Try again.');
  }
});
