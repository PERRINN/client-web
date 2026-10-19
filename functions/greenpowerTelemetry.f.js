const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { createHandler } = require('./utils/greenpowerTelemetry');

const password = defineSecret('GREENPOWER_TELEMETRY_PASSWORD');

exports.greenpowerTelemetry = onRequest({
  secrets: [password], cors: false, timeoutSeconds: 15,
  maxInstances: 2, concurrency: 10, memory: '256MiB',
}, (req, res) => createHandler({
  db: admin.firestore(), password: () => password.value(),
  timestamp: () => admin.firestore.FieldValue.serverTimestamp(),
})(req, res));
