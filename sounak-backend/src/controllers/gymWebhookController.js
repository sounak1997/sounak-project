// src/controllers/gymWebhookController.js
//
// Receives payment events from the gateway. PUBLIC by necessity — a gateway
// cannot log in — so authentication is an HMAC signature over the raw request
// body, not a token.
//
// Three properties this handler must have, each of which has bitten real
// systems:
//
//   1. It verifies the signature over the EXACT bytes received. Re-serialising
//      parsed JSON changes whitespace and key order, so every signature fails.
//      server.js mounts express.raw() for this path ahead of express.json().
//   2. It is idempotent. Gateways deliver at-least-once and retry on any
//      non-2xx, so the same event WILL arrive repeatedly.
//   3. It answers 200 quickly and for almost everything — including events it
//      does not care about and duplicates it ignores. A non-2xx makes the
//      gateway retry, and retrying a payment we already recorded is pure noise.
//      The only 4xx returned is for a signature that does not verify.
const asyncHandler = require('express-async-handler');
const gateway = require('../services/gymGatewayService');
const checkout = require('../services/gymCheckoutService');

// @desc    Razorpay payment events
// @route   POST /api/gym/webhooks/razorpay
// @access  Public, authenticated by HMAC signature
exports.razorpay = asyncHandler(async (req, res) => {
  // express.raw() leaves a Buffer here. If some future middleware change turns
  // it back into a parsed object, the signature check below would silently
  // start failing, so this refuses loudly instead.
  if (!Buffer.isBuffer(req.body)) {
    res.status(500);
    throw new Error('Webhook body was parsed before reaching the handler — raw body is required.');
  }

  const rawBody = req.body.toString('utf8');
  const signature = req.headers['x-razorpay-signature'];

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    res.status(400);
    throw new Error('Webhook body was not valid JSON.');
  }

  const entity = payload?.payload?.payment?.entity;
  const notes = entity?.notes || {};
  const gymId = notes.gymId;
  const paymentId = notes.paymentId;

  // The notes we attached when creating the order are how an event arriving at
  // a URL shared by every gym is routed to the right tenant. Without them the
  // event cannot be attributed, and guessing by amount would be wrong the
  // moment two members owe the same fee.
  if (!gymId) {
    await gateway.recordWebhookEvent({
      provider: 'razorpay',
      eventId: eventIdFor(req, payload),
      eventType: payload.event,
      gymId: null,
      payload,
      signatureOk: false,
    });
    // 200 on purpose: this is not something a retry can fix.
    return res.status(200).json({ received: true, ignored: 'no gym in notes' });
  }

  const signatureOk = await gateway.verifyWebhookSignature({ gymId, rawBody, signature });

  const { isNew, id: eventRowId } = await gateway.recordWebhookEvent({
    provider: 'razorpay',
    eventId: eventIdFor(req, payload),
    eventType: payload.event,
    gymId,
    payload,
    signatureOk,
  });

  if (!signatureOk) {
    // The one case worth refusing: either the secret is misconfigured or
    // someone is forging events. Both need to be visible, and the stored row
    // above records the attempt.
    res.status(400);
    throw new Error('Webhook signature verification failed.');
  }

  // A replay. Already recorded, already acted on.
  if (!isNew) return res.status(200).json({ received: true, duplicate: true });

  try {
    if (payload.event === 'payment.captured' && paymentId) {
      await checkout.settle({
        paymentId,
        gatewayPaymentId: entity.id,
        source: 'webhook',
      });
    } else if (payload.event === 'payment.failed' && paymentId) {
      await checkout.markFailed({
        paymentId,
        reason: entity?.error_description || 'Payment failed',
      });
    }
    await gateway.markWebhookProcessed(eventRowId);
  } catch (processingError) {
    // Recorded against the stored event so it can be replayed, but still
    // acknowledged: a retry would hit the duplicate guard above and never get
    // any further than this attempt did.
    await gateway.markWebhookProcessed(eventRowId, processingError.message);
  }

  res.status(200).json({ received: true });
});

// Razorpay sends an event id header; fall back to a composite so the UNIQUE
// constraint still has something stable to deduplicate on.
const eventIdFor = (req, payload) => {
  const header = req.headers['x-razorpay-event-id'];
  if (header) return String(header);
  const entityId = payload?.payload?.payment?.entity?.id || 'unknown';
  return `${payload?.event || 'unknown'}:${entityId}`;
};
