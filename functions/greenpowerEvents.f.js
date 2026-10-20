const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { editMetadata, MetadataError } = require('./utils/greenpowerEvents');
const { editDayMetadata } = require('./utils/greenpowerDayMetadata');

exports.greenpowerEventEdit = onCall({
  timeoutSeconds: 30, maxInstances: 2, concurrency: 10, memory: '256MiB',
}, async request => {
  try {
    return await (request.data?.schemaVersion === 2 ? editDayMetadata : editMetadata)(admin.firestore(), request.auth, request.data, {
      timestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    // Provider errors, drafts and raw samples must not appear in logs/responses.
    if (error instanceof MetadataError) throw new HttpsError(error.code, error.message);
    throw new HttpsError('internal', 'Could not save telemetry metadata. Retry with the same request ID.');
  }
});
