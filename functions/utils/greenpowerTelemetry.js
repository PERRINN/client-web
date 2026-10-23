const { randomUUID, createHash, timingSafeEqual } = require('node:crypto');
const { emptyDay } = require('./greenpowerDayMetadata');

const MAX_PAYLOAD_BYTES = 16 * 1024;
const MAX_CHUNK_BYTES = 128 * 1024;
const MAX_CHUNK_SAMPLES = 32;
const FROZEN_AFTER_MS = 60_000;
const INGESTION_STATE_PATH = 'GreenpowerTelemetry/424/ingestion/state';
// Only board readings establish activity. Phone location, clocks, lap counters
// and other derived fields can keep changing after Bluetooth disconnects.
const SENSOR_NAMES = new Set(['vt', 'v1', 'a', 'rpm', 'spd', 'thrtl', 'tmp1', 'tmp2', 'ah', 'brk', 'actualthrtl', 'inputthrtl']);
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });

function sensorFingerprint(raw) {
  const entries = Object.entries(JSON.parse(raw)).filter(([key]) => SENSOR_NAMES.has(key.toLowerCase()));
  if (!entries.length) return null;
  const readings = [];
  for (const [key, reading] of entries) {
    const envelope = reading && typeof reading === 'object' && !Array.isArray(reading);
    const value = envelope ? reading.value : reading;
    // Unsupported/missing sensor values must not silently suppress recordings.
    if (typeof value !== 'number' || !Number.isFinite(value) || envelope && typeof reading.unit !== 'string') return null;
    readings.push([key, value, envelope ? reading.unit : null]);
  }
  readings.sort((a, b) => a[0].localeCompare(b[0], 'en'));
  return createHash('sha256').update(JSON.stringify(readings)).digest('hex');
}

function validIngestionState(state) {
  return state?.schemaVersion === 1 && (state.sensorFingerprint === null || /^[a-f0-9]{64}$/.test(state.sensorFingerprint))
    && Number.isSafeInteger(state.unchangedSince) && Number.isSafeInteger(state.lastAcceptedAt)
    && state.unchangedSince >= 0 && state.lastAcceptedAt >= state.unchangedSince;
}

function londonDay(time) {
  const parts = Object.fromEntries(dayFormat.formatToParts(time).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function validatePayload(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_PAYLOAD_BYTES) throw new Error('Invalid payload size');
  const data = JSON.parse(raw);
  if (!data || Array.isArray(data) || typeof data !== 'object' || !Object.keys(data).length) throw new Error('Expected a JSON object');
  let leaves = 0;
  function visit(value, depth) {
    if (depth > 8) throw new Error('Payload nesting exceeds limit');
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (key.length > 128) throw new Error('Field name exceeds limit');
        visit(item, depth + 1);
      }
    } else {
      if (++leaves > 512 || typeof value === 'number' && !Number.isFinite(value)) throw new Error('Invalid channel value');
    }
  }
  visit(data, 0);
  return raw;
}

function authorized(header, password) {
  if (typeof password !== 'string' || password.length < 32 || typeof header !== 'string' || header.length > 1024) return false;
  const match = /^Basic ([A-Za-z0-9+/]+=*)$/i.exec(header);
  if (!match) return false;
  const supplied = Buffer.from(match[1], 'base64').toString('utf8');
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(supplied), digest(`424:${password}`));
}

// Raw JSON is a string: nested arrays, unusual channel keys and unknown fields
// survive unchanged without Firestore map/index or nested-array restrictions.
async function storeSample(db, raw, now = Date.now(), id = randomUUID(), timestamp = () => new Date()) {
  const day = londonDay(now);
  const dayRef = db.doc(`GreenpowerTelemetry/424/days/${day}`);
  const sample = { id, receivedAt: now, source: '424-phone', raw };
  const bytes = Buffer.byteLength(JSON.stringify(sample));
  const fingerprint = sensorFingerprint(raw);
  const recorded = await db.runTransaction(async transaction => {
    const ingestionRef = db.doc(INGESTION_STATE_PATH);
    const ingestion = (await transaction.get(ingestionRef)).data();
    const validState = validIngestionState(ingestion);
    const ordered = !validState || now >= ingestion.lastAcceptedAt;
    const unchanged = fingerprint !== null && validState && ingestion.sensorFingerprint === fingerprint;
    if (ordered && unchanged && now - ingestion.unchangedSince >= FROZEN_AFTER_MS) return false;
    const liveRef = db.doc(dayRef.path + '/live/latest');
    const live = (await transaction.get(liveRef)).data();
    const parent = live ? undefined : (await transaction.get(dayRef)).data();
    if (!live && parent?.schemaVersion === 2) throw new Error('Missing live state');
    const previous = live || parent;
    const modern = !!live || !parent;
    let index = previous?.activeChunk ?? 0;
    let chunkRef = dayRef.collection('chunks').doc(String(index).padStart(10, '0'));
    const chunkSnapshot = await transaction.get(chunkRef);
    let chunk = chunkSnapshot.data() || { samples: [], bytes: 0 };
    if (chunk.samples.length >= MAX_CHUNK_SAMPLES || chunk.bytes + bytes > MAX_CHUNK_BYTES) {
      index++;
      chunkRef = dayRef.collection('chunks').doc(String(index).padStart(10, '0'));
      chunk = { samples: [], bytes: 0 };
    }
    const latest = !previous?.latest || previous.latest.receivedAt <= now ? sample : previous.latest;
    transaction.set(chunkRef, { samples: [...chunk.samples, sample], bytes: chunk.bytes + bytes });
    const state = { date: day, activeChunk: index, count: (previous?.count || 0) + 1, latest, updatedAt: timestamp() };
    if (modern) {
      transaction.set(liveRef, state);
      if (!live) transaction.set(dayRef, emptyDay(day, timestamp));
    } else transaction.set(dayRef, { ...parent, ...state });
    if (ordered) transaction.set(ingestionRef, {
      schemaVersion: 1, sensorFingerprint: fingerprint,
      unchangedSince: unchanged ? ingestion.unchangedSince : now, lastAcceptedAt: now,
    });
    return true;
  }, { maxAttempts: 3 });
  return { day, id, recorded };
}

function createHandler({ db, password, timestamp, now = Date.now }) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).set('Allow', 'GET, POST').send('Method not allowed');
    if (!authorized(req.get('authorization'), password())) return res.status(401).set('WWW-Authenticate', 'Basic realm="424 telemetry"').send('Unauthorized');
    let raw;
    try {
      if (req.method === 'POST') {
        if (!/^application\/json(?:;|$)/i.test(req.get('content-type') || '')) return res.status(415).send('Expected application/json');
        if (!Buffer.isBuffer(req.rawBody) || req.rawBody.length > MAX_PAYLOAD_BYTES || !['', '/'].includes(req.path) || Object.keys(req.query || {}).length) throw new Error('Invalid body');
        raw = new TextDecoder('utf-8', { fatal: true }).decode(req.rawBody);
      } else {
        // eChook documents JSON appended as a URL path; OMNI must be verified
        // on the actual installed version. Never accept credentials in the URL.
        if (req.path.length > MAX_PAYLOAD_BYTES * 6 + 1 || Object.keys(req.query || {}).length) throw new Error('Invalid path');
        raw = decodeURIComponent(req.path.replace(/^\//, ''));
      }
      validatePayload(raw);
    } catch {
      return res.status(400).send('Invalid telemetry payload');
    }
    try {
      await storeSample(db, raw, now(), randomUUID(), timestamp);
      return res.status(204).send('');
    } catch {
      // Do not log URLs, payloads, Authorization headers or storage errors.
      return res.status(503).set('Retry-After', '3').send('Telemetry temporarily unavailable');
    }
  };
}

module.exports = { MAX_PAYLOAD_BYTES, MAX_CHUNK_BYTES, MAX_CHUNK_SAMPLES, FROZEN_AFTER_MS, INGESTION_STATE_PATH, sensorFingerprint, londonDay, validatePayload, authorized, storeSample, createHandler };
