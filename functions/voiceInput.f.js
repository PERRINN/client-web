const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { processVoiceInput } = require('./utils/voiceInput');
const { VoiceInputError } = require('./utils/voiceAudio');
const { transcribe } = require('./utils/voiceTranscription');

const apiKey = defineSecret('OPENAI_API_KEY');
const model = defineString('VOICE_TRANSCRIPTION_MODEL', { default: 'gpt-transcribe' });

exports.voiceInput = onCall({
  secrets: [apiKey], timeoutSeconds: 60, maxInstances: 2, concurrency: 2,
  memory: '256MiB', minInstances: 0
}, async request => {
  try {
    return await processVoiceInput(admin.firestore(), request.auth, request.data, {
      model: model.value(), timestamp: () => admin.firestore.FieldValue.serverTimestamp(),
      transcribe: audio => transcribe(audio, { apiKey: apiKey.value(), model: model.value() })
    });
  } catch (error) {
    if (error instanceof VoiceInputError) throw new HttpsError(error.code, error.message);
    throw new HttpsError('internal', 'Could not process the recording. Check it before recording again.');
  }
});
