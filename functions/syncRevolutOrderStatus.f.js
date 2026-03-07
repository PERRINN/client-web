const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');

try {
  admin.initializeApp();
} catch (e) {}

const REVOLUT_PROD_KEY = defineSecret('REVOLUT_PROD_KEY');
const REVOLUT_SANDBOX_KEY = defineSecret('REVOLUT_SANDBOX_KEY');
const REVOLUT_PROD_BASE = defineString('REVOLUT_PROD_BASE');
const REVOLUT_SANDBOX_BASE = defineString('REVOLUT_SANDBOX_BASE');
const REVOLUT_API_VERSION = defineString('REVOLUT_API_VERSION');

function normalizeStatus(status) {
  const value = String(status || '').toLowerCase();
  if (['succeeded', 'completed', 'paid', 'captured', 'authorised', 'authorized'].includes(value)) return 'succeeded';
  if (['failed', 'cancelled', 'canceled', 'declined'].includes(value)) return 'failed';
  if (['pending', 'processing', 'created'].includes(value)) return 'pending';
  return value || null;
}

exports.syncRevolutOrderStatus = onRequest(
  { cors: true, secrets: [REVOLUT_PROD_KEY, REVOLUT_SANDBOX_KEY] },
  async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return res.status(204).send('');
      if (req.method !== 'POST') return res.status(405).send({ error: 'Method not allowed' });

      const { orderId, mode, user, reference } = req.body || {};
      if (!orderId || !user) return res.status(400).send({ error: 'Missing orderId or user' });

      const useProd = mode === 'prod';
      const base = useProd ? REVOLUT_PROD_BASE.value() : REVOLUT_SANDBOX_BASE.value();
      const key = useProd ? REVOLUT_PROD_KEY.value() : REVOLUT_SANDBOX_KEY.value();
      const apiVersion = REVOLUT_API_VERSION.value() || '2024-09-01';
      if (!base || !key) return res.status(500).send({ error: 'Server config missing (Revolut)' });

      const url = `${base}/api/orders/${orderId}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${key}`,
          'Revolut-Api-Version': apiVersion,
        },
      });

      let order = {};
      try {
        order = await response.json();
      } catch (e) {
        order = {};
      }

      if (!response.ok) {
        return res.status(response.status).send(order || { error: 'Unable to fetch Revolut order' });
      }

      const rawStatus = order.status || order.state || null;
      const status = normalizeStatus(rawStatus);
      const metadata = order.metadata || {};

      const amountCharge = Number(metadata.amountCharge || order.amount || 0);
      const amountSharesPurchased = Number(metadata.amountSharesPurchased || 0);
      const currency = String((metadata.currency || order.currency || '')).toLowerCase();

      await admin
        .firestore()
        .doc(`PERRINNTeams/${user}/payments/${orderId}`)
        .set(
          {
            provider: 'revolut',
            orderId,
            user,
            reference: reference || order.reference || null,
            currency,
            amountCharge,
            amountSharesPurchased,
            status: status || null,
            source: {
              ...(order || {}),
              status: status || null,
              statusRaw: rawStatus || null,
              syncedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            updatedTimestamp: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

      return res.status(200).send({ ok: true, orderId, status, statusRaw: rawStatus || null });
    } catch (err) {
      console.error('syncRevolutOrderStatus error', err);
      return res.status(500).send({ error: 'Internal server error' });
    }
  }
);
