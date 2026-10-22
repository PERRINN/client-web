const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onTaskDispatched } = require('firebase-functions/v2/tasks');
const { defineSecret, defineString } = require('firebase-functions/params');
const { getFunctions } = require('firebase-admin/functions');
const admin = require('firebase-admin');
const { enqueueVoiceInput, processVoiceInbox, failExhaustedInbox } = require('./utils/voiceInbox');
const { VoiceInputError } = require('./utils/voiceAudio');
const { transcribe } = require('./utils/voiceTranscription');
const key = defineSecret('OPENAI_API_KEY');
const model = defineString('VOICE_TRANSCRIPTION_MODEL', { default: 'gpt-transcribe' });
const highLimitUid = defineString('VOICE_INPUT_HIGH_LIMIT_UID', { default: '' });
const timestamp = () => admin.firestore.FieldValue.serverTimestamp();

exports.voiceInputEnqueue = onCall({ timeoutSeconds: 60, maxInstances: 2, concurrency: 2, memory: '256MiB', minInstances: 0 }, async request => {
  try {
    return await enqueueVoiceInput(admin.firestore(), admin.storage().bucket(), request.auth, request.data, {
      model: model.value(), highLimitUid: highLimitUid.value(), timestamp,
      enqueue: (data, options) => getFunctions().taskQueue('locations/us-central1/functions/processVoiceInputInbox').enqueue(data, options)
    });
  } catch (error) {
    if (error instanceof VoiceInputError) throw new HttpsError(error.code, error.message, error.details);
    throw new HttpsError('unavailable', 'Could not confirm receipt of the recording.');
  }
});
exports.processVoiceInputInbox = onTaskDispatched({
  secrets: [key], timeoutSeconds: 60, maxInstances: 2, concurrency: 1, memory: '256MiB', minInstances: 0,
  invoker: 'private', rateLimits: { maxConcurrentDispatches: 2, maxDispatchesPerSecond: 2 },
  retryConfig: { maxAttempts: 8, maxRetrySeconds: 0, minBackoffSeconds: 300, maxBackoffSeconds: 3600, maxDoublings: 6 }
}, async request => {
  try {
    await processVoiceInbox(admin.firestore(), admin.storage().bucket(), request.data, {
      timestamp, retryCount: request.retryCount,
      transcribe: (audio, selectedModel) => transcribe(audio, { apiKey: key.value(), model: selectedModel || model.value() })
    });
  } catch {
    if (request.retryCount >= 7) await failExhaustedInbox(admin.firestore(), request.data?.eventId, timestamp);
    else throw new Error('Recording processing temporarily unavailable.');
  }
});
