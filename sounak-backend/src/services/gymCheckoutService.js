// src/services/gymCheckoutService.js
//
// Online renewal: member starts a UPI payment on their own phone, and the
// subscription activates when the money is confirmed.
//
// THE CENTRAL IDEA — confirmation arrives by three independent routes, and all
// three land on the same function:
//
//   1. Checkout callback   the browser hands back a signed receipt. Fast
//                          (about a second), but lost if the member closes the
//                          tab or their network drops mid-redirect.
//   2. Webhook             the gateway calls us. Reliable in principle, but on
//                          Render's free tier the service may be ASLEEP and the
//                          delivery times out before the cold start finishes.
//   3. Reconciliation poll we ask the gateway about anything still pending.
//                          Slowest, but depends on nothing going right.
//
// No single one of these is trustworthy on this stack, which is why there are
// three. `settle()` is idempotent so whichever arrives first wins and the rest
// are no-ops — that property is what makes running all three safe.
const pgPool = require('../config/pg.config');
const { genId } = require('../utils/id');
const gateway = require('./gymGatewayService');

const err = (statusCode, message) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

// --- starting a payment ----------------------------------------------------

/**
 * Creates a pending subscription + payment, and the gateway order to pay it.
 *
 * The subscription is written now, as 'pending_payment', rather than only on
 * success: an abandoned checkout then leaves a visible row instead of
 * disappearing. It grants nothing — every access query filters on
 * status = 'active' — so the safe state is the default.
 */
// A membership taken against the gym's own UPI QR, with no gateway involved.
//
// Mirrors startRenewal's shape but stops short of a gateway order: there is no
// order to create and nothing to poll. The subscription is 'pending_payment' and
// the payment is 'pending_verification' — a claim awaiting a human, which is
// what the desk's 'Paid UPI' button resolves (gymService.settlePayment, which
// activates the subscription in the same transaction).
//
// Re-uses an existing unconfirmed claim for the same plan rather than stacking a
// new one up each time the member taps back and forth, for the same reason
// startRenewal does.
// The last six characters of the payment id, upper-cased: short enough to read
// out across a counter, and unique enough to pick one row out of a day's list.
const reference = (paymentId) => String(paymentId).slice(-6).toUpperCase();

exports.startQrClaim = async ({ gym, memberId, planId }) => {
  const member = (await pgPool.query(
    "SELECT * FROM gym_members WHERE id = $1 AND gym_id = $2 AND status = 'active'",
    [memberId, gym.id]
  )).rows[0];
  if (!member) throw err(404, 'We could not find your membership. Please ask at the gym desk.');

  const plan = (await pgPool.query(
    "SELECT * FROM gym_plans WHERE id = $1 AND gym_id = $2 AND active = true",
    [planId, gym.id]
  )).rows[0];
  if (!plan) throw err(404, 'That plan is no longer available.');

  const existing = (await pgPool.query(
    `SELECT p.id AS payment_id, p.amount
       FROM gym_subscriptions s
       JOIN gym_payments p ON p.subscription_id = s.id
      WHERE s.member_id = $1 AND s.plan_id = $2
        AND s.status = 'pending_payment'
        AND p.status IN ('pending', 'pending_verification')
      ORDER BY s.created_at DESC LIMIT 1`,
    [memberId, planId]
  )).rows[0];

  if (existing) {
    await pgPool.query(
      `UPDATE gym_payments
          SET status = 'pending_verification', method = 'qr', updated_at = now()
        WHERE id = $1`,
      [existing.payment_id]
    );
    return {
      paymentId: existing.payment_id,
      amount: existing.amount,
      planName: plan.name,
      reference: reference(existing.payment_id),
    };
  }

  const client = await pgPool.pool.connect();
  try {
    await client.query('BEGIN');

    // Start date is today in the GYM's timezone, and the end date is derived
    // from it — the same arithmetic the rest of the app uses, so a membership
    // bought at 11pm does not lose a day.
    const subscriptionId = genId('SUB');
    // Same rule as a desk renewal and as the gateway path: paying early extends
    // from the existing end date rather than throwing away days already paid
    // for. Getting this wrong silently shortens a membership.
    const currentEnd = (await client.query(
      `SELECT end_date FROM gym_subscriptions
        WHERE member_id = $1 AND status = 'active'
        ORDER BY end_date DESC LIMIT 1`,
      [memberId]
    )).rows[0]?.end_date ?? null;

    const startDate = (await client.query(
      `SELECT CASE
                WHEN $1::date IS NOT NULL
                 AND $1::date >= (now() AT TIME ZONE $2)::date
                THEN $1::date + 1
                ELSE (now() AT TIME ZONE $2)::date
              END AS start_date`,
      [currentEnd, gym.timezone]
    )).rows[0].start_date;

    await client.query(
      `INSERT INTO gym_subscriptions
         (id, gym_id, member_id, plan_id, plan_name, start_date, end_date, amount, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::date, $6::date + ($7::int - 1), $8, 'pending_payment', $9)`,
      [
        subscriptionId,
        gym.id,
        memberId,
        plan.id,
        plan.name,
        startDate,
        plan.duration_days,
        plan.price,
        // Who created it, in the same form the gateway path uses: the member did
        // this themselves, on their own phone, with no staff involved.
        `member:${memberId}`,
      ]
    );

    const paymentId = genId('PAY');
    await client.query(
      `INSERT INTO gym_payments
         (id, gym_id, subscription_id, member_id, amount, method, status)
       VALUES ($1, $2, $3, $4, $5, 'qr', 'pending_verification')`,
      [paymentId, gym.id, subscriptionId, memberId, plan.price]
    );

    await client.query('COMMIT');
    return {
      paymentId,
      amount: plan.price,
      planName: plan.name,
      reference: reference(paymentId),
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

exports.startRenewal = async ({ gym, memberId, planId }) => {
  const memberResult = await pgPool.query(
    "SELECT * FROM gym_members WHERE id = $1 AND gym_id = $2 AND status = 'active'",
    [memberId, gym.id]
  );
  const member = memberResult.rows[0];
  if (!member) throw err(404, 'We could not find your membership. Please ask at the gym desk.');

  const planResult = await pgPool.query(
    "SELECT * FROM gym_plans WHERE id = $1 AND gym_id = $2 AND active = true",
    [planId, gym.id]
  );
  const plan = planResult.rows[0];
  if (!plan) throw err(404, 'That plan is no longer available.');

  // Reuse an unpaid attempt for the same plan instead of stacking up a new
  // subscription every time the member taps Pay and changes their mind. The
  // gateway order is recreated because Razorpay orders can expire.
  const existing = await pgPool.query(
    `SELECT s.id AS subscription_id, p.id AS payment_id
       FROM gym_subscriptions s
       JOIN gym_payments p ON p.subscription_id = s.id
      WHERE s.member_id = $1 AND s.plan_id = $2
        AND s.status = 'pending_payment' AND p.status = 'pending'
      ORDER BY s.created_at DESC LIMIT 1`,
    [memberId, planId]
  );

  const client = await pgPool.pool.connect();
  let subscriptionId;
  let paymentId;
  try {
    await client.query('BEGIN');

    if (existing.rows[0]) {
      subscriptionId = existing.rows[0].subscription_id;
      paymentId = existing.rows[0].payment_id;
    } else {
      const currentResult = await client.query(
        `SELECT end_date FROM gym_subscriptions
          WHERE member_id = $1 AND status = 'active'
          ORDER BY end_date DESC LIMIT 1`,
        [memberId]
      );
      const currentEnd = currentResult.rows[0] ? currentResult.rows[0].end_date : null;

      // Same rule as a desk renewal: paying early extends from the existing end
      // date rather than discarding the days already paid for.
      const startResult = await client.query(
        `SELECT CASE
                  WHEN $1::date IS NOT NULL
                   AND $1::date >= (now() AT TIME ZONE $2)::date
                  THEN $1::date + 1
                  ELSE (now() AT TIME ZONE $2)::date
                END AS start_date`,
        [currentEnd, gym.timezone]
      );
      const startDate = startResult.rows[0].start_date;

      subscriptionId = genId('SUB');
      await client.query(
        `INSERT INTO gym_subscriptions
           (id, gym_id, member_id, plan_id, plan_name, start_date, end_date, amount, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6::date, $6::date + ($7::int - 1), $8, 'pending_payment', $9)`,
        [
          subscriptionId, gym.id, memberId, plan.id, plan.name,
          startDate, plan.duration_days, plan.price, `member:${memberId}`,
        ]
      );

      paymentId = genId('PAY');
      await client.query(
        `INSERT INTO gym_payments
           (id, gym_id, subscription_id, member_id, amount, method, status)
         VALUES ($1, $2, $3, $4, $5, 'gateway', 'pending')`,
        [paymentId, gym.id, subscriptionId, memberId, plan.price]
      );
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // Outside the transaction on purpose: this is a network call to a third
  // party, and holding a database transaction open across it would pin a
  // connection for as long as the gateway takes to answer.
  const { order, keyId } = await gateway.createOrder({
    gymId: gym.id,
    amount: plan.price,
    receipt: paymentId,
    // Comes back verbatim on every webhook — this is how an event arriving at a
    // URL shared by 100 gyms is matched to the right one.
    notes: { gymId: gym.id, paymentId, subscriptionId, memberId },
  });

  await pgPool.query('UPDATE gym_payments SET gateway_order_id = $1, updated_at = now() WHERE id = $2', [
    order.id,
    paymentId,
  ]);

  return {
    paymentId,
    // Everything the browser needs to open Checkout. keyId is public by design.
    checkout: {
      keyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      gymName: gym.name,
      planName: plan.name,
      memberName: member.full_name,
      memberPhone: member.phone,
    },
  };
};

// --- settling --------------------------------------------------------------

/**
 * Marks a payment captured and activates its subscription. IDEMPOTENT.
 *
 * Every route into this function — checkout callback, webhook, reconciliation —
 * may arrive more than once and in any order. The guard is the UPDATE's
 * `status = 'pending'` predicate plus the partial UNIQUE index on
 * gateway_payment_id: a second attempt updates zero rows and returns the
 * existing state rather than activating the membership twice.
 */
exports.settle = async ({ paymentId, gatewayPaymentId, source }) => {
  const client = await pgPool.pool.connect();
  try {
    await client.query('BEGIN');

    const paymentResult = await client.query(
      'SELECT * FROM gym_payments WHERE id = $1 FOR UPDATE',
      [paymentId]
    );
    const payment = paymentResult.rows[0];
    if (!payment) throw err(404, 'Payment not found.');

    if (payment.status === 'verified') {
      await client.query('COMMIT');
      return { alreadySettled: true, payment };
    }

    const updated = await client.query(
      `UPDATE gym_payments
          SET status             = 'verified',
              gateway_payment_id = COALESCE($1, gateway_payment_id),
              verified_by        = $2,
              verified_at        = now(),
              updated_at         = now()
        WHERE id = $3 AND status IN ('pending', 'failed')
        RETURNING *`,
      [gatewayPaymentId || null, `gateway:${source}`, paymentId]
    );

    if (updated.rows.length === 0) {
      await client.query('COMMIT');
      return { alreadySettled: true, payment };
    }

    const subscription = await client.query(
      `UPDATE gym_subscriptions
          SET status = 'active', updated_at = now()
        WHERE id = $1 AND status = 'pending_payment'
        RETURNING *`,
      [payment.subscription_id]
    );

    await client.query('COMMIT');
    return {
      alreadySettled: false,
      payment: updated.rows[0],
      subscription: subscription.rows[0] || null,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

exports.markFailed = async ({ paymentId, reason }) => {
  await pgPool.query(
    `UPDATE gym_payments SET status = 'failed', reference = COALESCE(reference, $1), updated_at = now()
      WHERE id = $2 AND status = 'pending'`,
    [reason ? String(reason).slice(0, 200) : null, paymentId]
  );
};

// --- route 1: the browser's signed receipt --------------------------------

exports.confirmFromCheckout = async ({ gym, paymentId, orderId, gatewayPaymentId, signature }) => {
  const result = await pgPool.query(
    'SELECT * FROM gym_payments WHERE id = $1 AND gym_id = $2',
    [paymentId, gym.id]
  );
  const payment = result.rows[0];
  if (!payment) throw err(404, 'Payment not found.');

  // The signature is what makes this trustworthy: it is computed with the gym's
  // key secret, which the browser never sees, so a client cannot forge a
  // "paid" claim by calling this endpoint directly.
  const ok = await gateway.verifyCheckoutSignature({
    gymId: gym.id,
    orderId,
    paymentId: gatewayPaymentId,
    signature,
  });
  if (!ok) throw err(400, 'That payment could not be verified. If money has left your account, it will be confirmed shortly.');

  if (payment.gateway_order_id && payment.gateway_order_id !== orderId) {
    throw err(400, 'That payment does not match this order.');
  }

  return exports.settle({ paymentId, gatewayPaymentId, source: 'checkout' });
};

// --- route 3: reconciliation ----------------------------------------------

/**
 * Asks the gateway what actually happened to payments still sitting pending.
 *
 * This exists because neither of the faster routes is dependable here: the
 * browser can vanish mid-redirect, and a webhook sent to a sleeping free-tier
 * service times out before it wakes. Run on the owner opening their payments
 * screen and when a member returns to the check-in page, so it costs nothing
 * when there is nothing outstanding.
 */
exports.reconcile = async ({ gymId, paymentId = null, maxAgeMinutes = 2880 }) => {
  const pending = await pgPool.query(
    `SELECT * FROM gym_payments
      WHERE gym_id = $1
        AND status = 'pending'
        AND method = 'gateway'
        AND gateway_order_id IS NOT NULL
        AND created_at > now() - ($2::int * interval '1 minute')
        AND ($3::text IS NULL OR id = $3)
      ORDER BY created_at DESC
      LIMIT 25`,
    [gymId, maxAgeMinutes, paymentId]
  );

  const settled = [];
  for (const payment of pending.rows) {
    try {
      const attempts = await gateway.fetchOrderPayments({
        gymId,
        orderId: payment.gateway_order_id,
      });
      const captured = attempts.find((a) => a.status === 'captured');
      if (captured) {
        await exports.settle({
          paymentId: payment.id,
          gatewayPaymentId: captured.id,
          source: 'reconcile',
        });
        settled.push(payment.id);
      }
    } catch {
      // One unreachable order must not stop the rest being reconciled; it will
      // be picked up on the next pass.
    }
  }
  return { checked: pending.rows.length, settled };
};

exports.getPaymentStatus = async ({ gymId, paymentId }) => {
  const result = await pgPool.query(
    `SELECT p.id, p.status, p.amount, p.method, s.plan_name, s.start_date, s.end_date, s.status AS subscription_status
       FROM gym_payments p
       JOIN gym_subscriptions s ON s.id = p.subscription_id
      WHERE p.id = $1 AND p.gym_id = $2`,
    [paymentId, gymId]
  );
  if (!result.rows[0]) throw err(404, 'Payment not found.');
  return result.rows[0];
};
