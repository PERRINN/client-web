const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');

const REVOLUT_PROD_KEY      = defineSecret('REVOLUT_PROD_KEY');
const REVOLUT_SANDBOX_KEY   = defineSecret('REVOLUT_SANDBOX_KEY');
const REVOLUT_PROD_BASE     = defineString('REVOLUT_PROD_BASE');
const REVOLUT_SANDBOX_BASE  = defineString('REVOLUT_SANDBOX_BASE');
const REVOLUT_API_VERSION   = defineString('REVOLUT_API_VERSION'); // e.g. 2024-09-01

exports.createRevolutOrder = onRequest(
  { cors: true, secrets: [REVOLUT_PROD_KEY, REVOLUT_SANDBOX_KEY] },
  async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return res.status(204).send('');
      if (req.method !== 'POST') return res.status(405).send({ error: 'Method not allowed' });

      const { amount, currency, email, reference, description, mode } = req.body || {};

      // Basic validation
      if (!Number.isInteger(amount) || amount <= 0) return res.status(400).send({ error: 'Invalid amount (minor units)' });
      if (!currency) return res.status(400).send({ error: 'Missing currency' });
      if (!reference) return res.status(400).send({ error: 'Missing reference' });

      const useProd = mode === 'prod';
      const base = useProd ? REVOLUT_PROD_BASE.value() : REVOLUT_SANDBOX_BASE.value();
      const key  = useProd ? REVOLUT_PROD_KEY.value()  : REVOLUT_SANDBOX_KEY.value();
      const apiVersion = REVOLUT_API_VERSION.value() || '2024-09-01';

      // 🔍 Debug logs (masking secrets)
      console.log('--- createRevolutOrder DEBUG ---');
      console.log('Mode:', useProd ? 'PRODUCTION' : 'SANDBOX');
      console.log('Base URL:', base);
      console.log('API Key present:', !!key, key ? `...${key.slice(-6)}` : '(none)');
      console.log('API Version:', apiVersion);
      console.log('Request payload:', { amount, currency, email, reference, description });

      if (!base || !key) {
        console.error('❌ Missing base URL or API key.');
        return res.status(500).send({ error: 'Server config missing (Revolut)' });
      }

      const url = `${base}/api/orders`;
      const payload = {
        amount,
        currency: currency.toUpperCase(),
        reference,
        description,
        email,
      };

      console.log('Full Revolut request URL:', url);

      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
          'Revolut-Api-Version': apiVersion,
        },
        body: JSON.stringify(payload),
      });

      let data = {};
      try { data = await r.json(); } catch (e) {
        console.warn('⚠️ Could not parse Revolut JSON response', e);
      }

      if (!r.ok) {
        console.error('❌ Revolut API error', { status: r.status, payload, response: data });
        return res.status(r.status).send(data);
      }

      console.log('✅ Revolut order created successfully', data);

      return res.status(200).send({
        ...data,
        mode: useProd ? 'prod' : 'sandbox',
        checkout_url: data.checkout_url // <-- make sure this is included
      });
    } catch (err) {
      console.error('❌ createRevolutOrder fatal error:', err);
      return res.status(500).send({ error: 'Internal server error' });
    }
  }
);
