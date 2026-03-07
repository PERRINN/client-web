const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

try {
  admin.initializeApp();
} catch (e) {}

function extractOrder(payload) {
  if (!payload) return {};
  return payload.order || payload.data?.order || payload.resource || payload;
}

function extractUserFromReference(reference) {
  if (!reference || typeof reference !== 'string') return null;
  const match = reference.match(/^PRN-([A-Za-z0-9_-]+)-\d+$/);
  return match ? match[1] : null;
}

function normalizeStatus(status) {
  const value = String(status || '').toLowerCase();
  if (['succeeded', 'completed', 'paid', 'captured', 'authorised', 'authorized'].includes(value)) return 'succeeded';
  if (['failed', 'cancelled', 'canceled', 'declined'].includes(value)) return 'failed';
  if (['pending', 'processing', 'created'].includes(value)) return 'pending';
  return value || null;
}

exports.revolutWebhook = onRequest({ cors: true }, async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).send({ error: 'Method not allowed' });

    const body = req.body || {};
    const order = extractOrder(body);

    const orderId = order.id || order.order_id || body.order_id || body.id || null;
    const rawStatus = order.status || order.state || body.status || body.state || null;
    const status = normalizeStatus(rawStatus);
    const reference = order.reference || body.reference || null;
    const metadata = order.metadata || body.metadata || {};

    const user =
      metadata.user ||
      metadata.uid ||
      body.user ||
      extractUserFromReference(reference);

    if (!orderId) {
      return res.status(400).send({ error: 'Missing order id' });
    }

    if (!user) {
      console.warn('Revolut webhook: unable to resolve user', { orderId, reference, metadata });
      return res.status(202).send({ ok: true, ignored: 'missing user mapping' });
    }

    const amountCharge = Number(metadata.amountCharge || body.amountCharge || order.amount || 0);
    const amountSharesPurchased = Number(metadata.amountSharesPurchased || body.amountSharesPurchased || 0);
    const currency = String((metadata.currency || body.currency || order.currency || '')).toLowerCase();

    const ref = admin.firestore().doc(`PERRINNTeams/${user}/payments/${orderId}`);

    await ref.set(
      {
        provider: 'revolut',
        orderId,
        reference: reference || null,
        user,
        currency,
        amountCharge,
        amountSharesPurchased,
        status: status || null,
        source: {
          ...(order || {}),
          status: status || null,
          statusRaw: rawStatus || null,
          receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        updatedTimestamp: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return res.status(200).send({ ok: true, orderId, status });
  } catch (err) {
    console.error('revolutWebhook error', err);
    return res.status(500).send({ error: 'Internal server error' });
  }
});
