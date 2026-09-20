// src/services/gymGatewayService.js
//
// Talks to the payment gateway, and holds each gym's credentials for doing so.
//
// Razorpay's REST API is used directly over fetch rather than through their SDK.
// Two reasons: the SDK is a singleton configured with one key pair, which is
// exactly wrong here (every gym has its own keys, chosen per request), and
// keeping the provider behind these few functions means a second provider is a
// new module rather than a rewrite.
const crypto = require('crypto');
const pgPool = require('../config/pg.config');
const { genId } = require('../utils/id');
const secretBox = require('../utils/secretBox');

const RAZORPAY_API = 'https://api.razorpay.com/v1';

const err = (statusCode, message) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

// --- per-gym credentials ---------------------------------------------------

// Never returns the secrets. The owner's console shows whether online payment
// is switched on and which key id is in use; there is no reason for a secret to
// travel back out of the server once it has been stored.
exports.getProviderPublic = async (gymId) => {
  const result = await pgPool.query(
    `SELECT provider, key_id, enabled, updated_at,
            (webhook_secret_enc IS NOT NULL) AS webhook_configured
       FROM gym_payment_providers WHERE gym_id = $1`,
    [gymId]
  );
  return result.rows[0] || null;
};

exports.saveProvider = async ({ gymId, keyId, keySecret, webhookSecret, enabled, updatedBy }) => {
  if (!keyId || !keySecret) throw err(400, 'Both the Key ID and Key Secret are required.');
  if (!/^rzp_(test|live)_/.test(keyId)) {
    throw err(400, 'That does not look like a Razorpay Key ID (it should start with rzp_test_ or rzp_live_).');
  }

  const result = await pgPool.query(
    `INSERT INTO gym_payment_providers
       (gym_id, provider, key_id, key_secret_enc, webhook_secret_enc, enabled, updated_by)
     VALUES ($1, 'razorpay', $2, $3, $4, COALESCE($5, true), $6)
     ON CONFLICT (gym_id) DO UPDATE SET
       key_id             = EXCLUDED.key_id,
       key_secret_enc     = EXCLUDED.key_secret_enc,
       -- Left alone when not supplied, so re-saving the API keys does not
       -- silently wipe a working webhook secret.
       webhook_secret_enc = COALESCE(EXCLUDED.webhook_secret_enc, gym_payment_providers.webhook_secret_enc),
       enabled            = EXCLUDED.enabled,
       updated_by         = EXCLUDED.updated_by,
       updated_at         = now()
     RETURNING gym_id`,
    [
      gymId,
      keyId,
      secretBox.seal(keySecret),
      secretBox.seal(webhookSecret),
      enabled === undefined ? null : !!enabled,
      updatedBy,
    ]
  );
  return exports.getProviderPublic(result.rows[0].gym_id);
};

// Internal only — decrypts. Everything that calls this is server-side.
const credentialsFor = async (gymId) => {
  const result = await pgPool.query(
    'SELECT * FROM gym_payment_providers WHERE gym_id = $1',
    [gymId]
  );
  const row = result.rows[0];
  if (!row || !row.enabled) {
    throw err(400, 'Online payment is not set up for this gym yet. Please pay at the desk.');
  }
  return {
    keyId: row.key_id,
    keySecret: secretBox.open(row.key_secret_enc),
    webhookSecret: secretBox.open(row.webhook_secret_enc),
  };
};

exports.credentialsFor = credentialsFor;

// --- Razorpay REST ---------------------------------------------------------

const call = async (creds, path, { method = 'GET', body } = {}) => {
  const auth = Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString('base64');

  // The gym is waiting on this request with a phone in their hand; a gateway
  // that has gone quiet must surface as an error rather than a hang.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  let response;
  try {
    response = await fetch(`${RAZORPAY_API}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    throw err(502, 'Could not reach the payment provider. Please try again.');
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw err(502, 'The payment provider returned something unreadable.');
  }

  if (!response.ok) {
    const description = payload?.error?.description || 'The payment provider rejected that request.';
    // 401 from Razorpay means the gym's keys are wrong — report that as a
    // configuration problem, not as the member having done something wrong.
    if (response.status === 401) {
      throw err(400, "This gym's payment keys were rejected. The owner needs to check them.");
    }
    throw err(response.status >= 500 ? 502 : 400, description);
  }
  return payload;
};

/**
 * Creates the order the member will pay against.
 *
 * `notes` is what makes the webhook usable later: it comes back verbatim on
 * every event, so it is where the gym and payment ids are carried. Without it,
 * a webhook arriving at a URL shared by 100 gyms could only be matched by
 * amount, which is ambiguous the moment two members owe the same fee.
 */
exports.createOrder = async ({ gymId, amount, receipt, notes }) => {
  const creds = await credentialsFor(gymId);
  const order = await call(creds, '/orders', {
    method: 'POST',
    body: {
      // Razorpay works in paise. Rounding here rather than trusting a float:
      // 1000.1 * 100 is 100009.99999 in IEEE754, which would be rejected.
      amount: Math.round(Number(amount) * 100),
      currency: 'INR',
      receipt,
      notes,
    },
  });
  return { order, keyId: creds.keyId };
};

exports.fetchPayment = async ({ gymId, paymentId }) => {
  const creds = await credentialsFor(gymId);
  return call(creds, `/payments/${paymentId}`);
};

/** Used by reconciliation: asks what actually happened to an order. */
exports.fetchOrderPayments = async ({ gymId, orderId }) => {
  const creds = await credentialsFor(gymId);
  const result = await call(creds, `/orders/${orderId}/payments`);
  return result.items || [];
};

// --- signatures ------------------------------------------------------------

// Constant-time compare so a mismatch cannot be found a byte at a time by
// timing the response.
const safeEqual = (a, b) => {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Verifies the handshake Checkout hands back to the browser.
 *
 * This is the FAST path — it confirms the payment within a second of the member
 * tapping, so the screen can say "paid". It is not the only path: the browser
 * can be closed mid-redirect, so the webhook and the reconciliation poll both
 * reach the same conclusion independently.
 */
exports.verifyCheckoutSignature = async ({ gymId, orderId, paymentId, signature }) => {
  const creds = await credentialsFor(gymId);
  const expected = crypto
    .createHmac('sha256', creds.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return safeEqual(expected, signature);
};

/**
 * Verifies a webhook against the RAW request body.
 *
 * It must be the exact bytes received: re-serialising the parsed JSON produces
 * different whitespace and key order, and every signature then fails. See the
 * express.raw() mount in server.js.
 */
exports.verifyWebhookSignature = async ({ gymId, rawBody, signature }) => {
  const creds = await credentialsFor(gymId);
  if (!creds.webhookSecret) return false;
  const expected = crypto
    .createHmac('sha256', creds.webhookSecret)
    .update(rawBody)
    .digest('hex');
  return safeEqual(expected, signature);
};

// --- webhook audit log -----------------------------------------------------

/**
 * Records the event and tells the caller whether it is new.
 *
 * The UNIQUE on event_id is the outermost idempotency guard: a duplicate
 * delivery is rejected here, before any money logic runs. Returns
 * { isNew: false } for a replay, which the caller acknowledges and ignores.
 */
exports.recordWebhookEvent = async ({ provider, eventId, eventType, gymId, payload, signatureOk }) => {
  const result = await pgPool.query(
    `INSERT INTO gym_webhook_events (id, provider, event_id, event_type, gym_id, payload, signature_ok)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING id`,
    [genId('WHE'), provider, eventId, eventType || null, gymId || null, payload, signatureOk]
  );
  return { isNew: result.rows.length > 0, id: result.rows[0]?.id ?? null };
};

exports.markWebhookProcessed = async (id, error = null) => {
  if (!id) return;
  await pgPool.query(
    'UPDATE gym_webhook_events SET processed_at = now(), error = $1 WHERE id = $2',
    [error, id]
  );
};

/**
 * Verifies a gym's saved keys actually work, before anyone tries to pay.
 *
 * Without this the first sign that a key was mistyped is a member standing at
 * the door with a failed payment. A read-only call is enough: Razorpay answers
 * 401 for bad credentials and 200 for good ones, and listing payments moves no
 * money and creates nothing.
 */
exports.testConnection = async (gymId) => {
  const creds = await credentialsFor(gymId);
  await call(creds, '/payments?count=1');
  return {
    ok: true,
    keyId: creds.keyId,
    // rzp_test_ keys cannot touch real money, which is exactly what you want
    // while setting this up — worth saying out loud so nobody assumes they are
    // live, or panics that they are.
    mode: creds.keyId.startsWith('rzp_live_') ? 'live' : 'test',
    webhookConfigured: !!creds.webhookSecret,
  };
};
