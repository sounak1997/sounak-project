// src/services/gymService.js
//
// The owner's side of one gym: its settings, plans, members, subscriptions,
// payments and expiry worklist. Attendance lives in gymAttendanceService.js;
// accounts, logins and gym/staff administration live in gymAuthService.js.
//
// EVERY function here takes a gymId and filters on it. That is not politeness
// about data hygiene — with ~100 gyms sharing these tables, a query that
// forgets its gym_id hands one owner another's members. Callers get gymId from
// req.gym.id, which requireGymAccess has already verified they may use.
//
// Nothing in this file touches the Mongo `users` collection or any table
// belonging to the grocery or doctors portals. Members are rows here, not
// accounts elsewhere: an owner adds a walk-in with a name and a phone number.
const crypto = require('crypto');
const pgPool = require('../config/pg.config');
const { genId } = require('../utils/id');

const notFound = (message) => {
  const err = new Error(message);
  err.statusCode = 404;
  return err;
};

const badRequest = (message) => {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
};

const newGymCode = () => crypto.randomBytes(9).toString('base64url');
const newMemberCode = () => crypto.randomBytes(6).toString('base64url');

// --- this gym's settings ---------------------------------------------------

exports.updateGym = async ({ gymId, name, address, phone, timezone, closedWeekdays, rescanGraceSeconds, paymentQrUrl }) => {
  if (closedWeekdays !== undefined) {
    const ok = Array.isArray(closedWeekdays)
      && closedWeekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (!ok) throw badRequest('closedWeekdays must be an array of weekday numbers, 0 (Sunday) to 6.');
  }

  const result = await pgPool.query(
    `UPDATE gyms
        SET name                 = COALESCE($1, name),
            address              = COALESCE($2, address),
            phone                = COALESCE($3, phone),
            timezone             = COALESCE($4, timezone),
            closed_weekdays      = COALESCE($5::jsonb, closed_weekdays),
            rescan_grace_seconds = COALESCE($6, rescan_grace_seconds),
            payment_qr_url       = COALESCE($7, payment_qr_url),
            updated_at           = now()
      WHERE id = $8
      RETURNING *`,
    [
      name ?? null,
      address ?? null,
      phone ?? null,
      timezone ?? null,
      closedWeekdays === undefined ? null : JSON.stringify(closedWeekdays),
      rescanGraceSeconds ?? null,
      paymentQrUrl ?? null,
      gymId,
    ]
  );
  if (!result.rows[0]) throw notFound('Gym not found.');
  return result.rows[0];
};

// Reissuing the code invalidates every printed copy of this gym's poster, which
// is the point — so it is a separate, explicit action rather than something an
// ordinary settings save can trigger by accident.
exports.regenerateGymCode = async (gymId) => {
  const result = await pgPool.query(
    'UPDATE gyms SET gym_code = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [newGymCode(), gymId]
  );
  if (!result.rows[0]) throw notFound('Gym not found.');
  return result.rows[0];
};

// --- plans -----------------------------------------------------------------

exports.listPlans = async ({ gymId, includeInactive = false }) => {
  const result = await pgPool.query(
    `SELECT * FROM gym_plans
      WHERE gym_id = $1 ${includeInactive ? '' : 'AND active = true'}
      ORDER BY duration_days ASC`,
    [gymId]
  );
  return result.rows;
};

exports.createPlan = async ({ gymId, name, durationDays, price, description }) => {
  if (!name) throw badRequest('name is required.');
  if (!Number.isInteger(durationDays) || durationDays <= 0) {
    throw badRequest('durationDays must be a positive whole number of days.');
  }
  if (!(Number(price) >= 0)) throw badRequest('price must be zero or more.');

  const result = await pgPool.query(
    `INSERT INTO gym_plans (id, gym_id, name, duration_days, price, description)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [genId('PLN'), gymId, name, durationDays, price, description || null]
  );
  return result.rows[0];
};

// Deactivated rather than deleted: past subscriptions reference the plan, and
// their history must not change because the owner stopped selling it.
exports.setPlanActive = async ({ gymId, planId, active }) => {
  const result = await pgPool.query(
    `UPDATE gym_plans SET active = $1, updated_at = now()
      WHERE id = $2 AND gym_id = $3 RETURNING *`,
    [active, planId, gymId]
  );
  if (!result.rows[0]) throw notFound(`Plan '${planId}' not found.`);
  return result.rows[0];
};

// --- members ---------------------------------------------------------------

// Registers an athlete at this gym. Name and phone are all that is needed —
// members do not log in, they are recognised at the door by their device.
//
// The phone number is not cosmetic: it is how a member identifies themselves on
// a new phone, and how the owner calls them about a renewal. So it is required.
exports.createMember = async ({ gymId, fullName, phone, emergencyContact, notes, joinedOn }) => {
  if (!fullName) throw badRequest('fullName is required.');
  if (!phone) {
    throw badRequest('phone is required — it is how members identify themselves at check-in.');
  }

  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 10) throw badRequest('Enter a full 10-digit mobile number.');

  // Warn rather than block: two members legitimately sharing a number is rare
  // but real (a parent and child), and the check-in screen already handles it
  // by asking which of them is scanning. Blocking it would be wrong.
  const duplicate = await pgPool.query(
    `SELECT id, full_name FROM gym_members
      WHERE gym_id = $1 AND right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $2`,
    [gymId, digits.slice(-10)]
  );

  const result = await pgPool.query(
    `INSERT INTO gym_members
       (id, gym_id, member_code, full_name, phone, emergency_contact, notes, joined_on)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::date, CURRENT_DATE))
     RETURNING *`,
    [
      genId('MEM'),
      gymId,
      newMemberCode(),
      fullName,
      phone,
      emergencyContact || null,
      notes || null,
      joinedOn || null,
    ]
  );
  return {
    member: result.rows[0],
    sharesPhoneWith: duplicate.rows.map((r) => r.full_name),
  };
};

exports.updateMember = async ({ gymId, memberId, fullName, phone, emergencyContact, notes, status }) => {
  if (status !== undefined && !['active', 'inactive'].includes(status)) {
    throw badRequest("status must be 'active' or 'inactive'.");
  }
  const result = await pgPool.query(
    `UPDATE gym_members
        SET full_name         = COALESCE($1, full_name),
            phone             = COALESCE($2, phone),
            emergency_contact = COALESCE($3, emergency_contact),
            notes             = COALESCE($4, notes),
            status            = COALESCE($5, status),
            updated_at        = now()
      WHERE id = $6 AND gym_id = $7
      RETURNING *`,
    [
      fullName ?? null,
      phone ?? null,
      emergencyContact ?? null,
      notes ?? null,
      status ?? null,
      memberId,
      gymId,
    ]
  );
  if (!result.rows[0]) throw notFound(`Member '${memberId}' not found.`);
  return result.rows[0];
};

// The owner's member list. Every row carries its current subscription and
// derived expiry state, because that is what the list is for — a name with no
// membership status beside it answers nothing.
//
// `expiry` is one of none / expired / expiring / active, computed from end_date
// against this gym's own timezone. Never read from a stored flag.
exports.listMembers = async ({ gymId, search, status, expiry, expiringWithinDays = 7, limit = 200, offset = 0 }) => {
  const result = await pgPool.query(
    `WITH tz AS (SELECT timezone FROM gyms WHERE id = $1),
     today AS (SELECT (now() AT TIME ZONE (SELECT timezone FROM tz))::date AS d),
     current_sub AS (
       SELECT DISTINCT ON (member_id)
              member_id, id AS subscription_id, plan_name, start_date, end_date, amount
         FROM gym_subscriptions
        WHERE gym_id = $1 AND status = 'active'
        ORDER BY member_id, end_date DESC
     )
     SELECT m.*,
            s.subscription_id, s.plan_name, s.start_date, s.end_date,
            (s.end_date - t.d) AS days_remaining,
            CASE
              WHEN s.end_date IS NULL            THEN 'none'
              WHEN s.end_date <  t.d             THEN 'expired'
              WHEN s.end_date <= t.d + $2::int   THEN 'expiring'
              ELSE 'active'
            END AS expiry,
            (SELECT COUNT(*)::int FROM gym_device_tokens d
              WHERE d.member_id = m.id AND d.revoked = false) AS device_count
       FROM gym_members m
       CROSS JOIN today t
       LEFT JOIN current_sub s ON s.member_id = m.id
      WHERE m.gym_id = $1
        AND ($3::text IS NULL OR m.full_name ILIKE '%' || $3 || '%'
                              OR m.phone     ILIKE '%' || $3 || '%')
        AND ($4::text IS NULL OR m.status = $4)
      ORDER BY m.full_name ASC
      LIMIT $5 OFFSET $6`,
    [gymId, expiringWithinDays, search || null, status || null, limit, offset]
  );

  // Filtered in Node rather than SQL because `expiry` is a derived column and
  // referencing it in the same query's WHERE would mean repeating the whole
  // CASE expression. The page size is already bounded by LIMIT.
  return expiry ? result.rows.filter((r) => r.expiry === expiry) : result.rows;
};

exports.getMember = async ({ gymId, memberId }) => {
  const result = await pgPool.query('SELECT * FROM gym_members WHERE id = $1 AND gym_id = $2', [
    memberId,
    gymId,
  ]);
  if (!result.rows[0]) throw notFound(`Member '${memberId}' not found.`);
  return result.rows[0];
};

// Revoking devices is the fix for a member's lost or replaced phone, and the
// only reason an owner ever needs to know device tokens exist. Their next scan
// simply asks for their number again.
exports.revokeMemberDevices = async ({ gymId, memberId }) => {
  await exports.getMember({ gymId, memberId });
  const result = await pgPool.query(
    'UPDATE gym_device_tokens SET revoked = true WHERE member_id = $1 AND revoked = false',
    [memberId]
  );
  return { revoked: result.rowCount };
};

// --- subscriptions + payments ---------------------------------------------

// Assign or renew a plan. A renewal is always a NEW row, so payment history
// stays intact and "when did they last renew" remains answerable.
//
// A renewal bought before the current membership runs out starts the day AFTER
// it ends, not today — otherwise renewing early would silently throw away the
// days the member had already paid for.
exports.createSubscription = async ({ gymId, memberId, planId, startDate, amount, payment, recordedBy }) => {
  const member = await exports.getMember({ gymId, memberId });

  const planResult = await pgPool.query('SELECT * FROM gym_plans WHERE id = $1 AND gym_id = $2', [
    planId,
    gymId,
  ]);
  const plan = planResult.rows[0];
  if (!plan) throw notFound(`Plan '${planId}' not found.`);

  const method = (payment && payment.method) || 'cash';
  if (!['cash', 'qr', 'gateway'].includes(method)) {
    throw badRequest("payment.method must be 'cash', 'qr' or 'gateway'.");
  }
  // Cash handed over at the desk is money already in the drawer, so it is
  // recorded as collected. A QR payment has no gateway callback to trust, so it
  // waits for the owner to confirm it — the same manual model the grocery
  // portal uses.
  const status = (payment && payment.status) || (method === 'cash' ? 'collected' : 'pending_verification');

  const client = await pgPool.pool.connect();
  try {
    await client.query('BEGIN');

    const tzResult = await client.query('SELECT timezone FROM gyms WHERE id = $1', [gymId]);
    const gymTimezone = tzResult.rows[0].timezone;

    const currentResult = await client.query(
      `SELECT end_date FROM gym_subscriptions
        WHERE member_id = $1 AND status = 'active'
        ORDER BY end_date DESC LIMIT 1`,
      [memberId]
    );
    const currentEnd = currentResult.rows[0] ? currentResult.rows[0].end_date : null;

    // Resolved in its own statement rather than inside the INSERT. The CTE
    // version could not have its parameter types inferred (Postgres reports
    // "inconsistent types deduced" when a placeholder feeds both a CTE
    // predicate and an INSERT target list), and spelling out a cast per
    // placeholder to satisfy it made the date rule unreadable. Still one
    // transaction, so it is equally atomic.
    const startResult = await client.query(
      `SELECT COALESCE(
                $1::date,
                CASE
                  WHEN $2::date IS NOT NULL
                   AND $2::date >= (now() AT TIME ZONE $3)::date
                  THEN $2::date + 1
                  ELSE (now() AT TIME ZONE $3)::date
                END
              ) AS start_date`,
      [startDate || null, currentEnd, gymTimezone]
    );
    const resolvedStart = startResult.rows[0].start_date;

    const subscriptionId = genId('SUB');
    const subResult = await client.query(
      `INSERT INTO gym_subscriptions
         (id, gym_id, member_id, plan_id, plan_name, start_date, end_date, amount, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::date, $6::date + ($7::int - 1), $8, $9)
       RETURNING *`,
      [
        subscriptionId,
        gymId,
        memberId,
        plan.id,
        plan.name,
        resolvedStart,
        plan.duration_days,
        amount ?? plan.price,
        recordedBy,
      ]
    );

    // Every subscription gets a payment row, even an unpaid one, so "who owes
    // money" is a query over payments rather than an absence of data.
    // `settled` is decided here rather than with a CASE over the status
    // placeholder inside the INSERT: a parameter that feeds both a varchar
    // column and an IN comparison leaves Postgres unable to deduce its type,
    // and the audit columns read far more plainly as two values than as two
    // conditionals in SQL.
    const settled = ['verified', 'collected'].includes(status);

    const payResult = await client.query(
      `INSERT INTO gym_payments
         (id, gym_id, subscription_id, member_id, amount, method, status, reference,
          recorded_by, verified_by, verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        genId('PAY'),
        gymId,
        subscriptionId,
        memberId,
        (payment && payment.amount) ?? amount ?? plan.price,
        method,
        status,
        (payment && payment.reference) || null,
        recordedBy,
        settled ? recordedBy : null,
        settled ? new Date() : null,
      ]
    );

    await client.query('COMMIT');
    return { member, subscription: subResult.rows[0], payment: payResult.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// Cash taken at the desk, or a QR payment the owner has confirmed. There is no
// gateway callback to trust in v1, so a human says so and is recorded as having
// said it.
//
// `method` is settable here, not just at creation. What a payment was BOOKED as
// is a guess — a renewal entered as cash may be paid by UPI when the member
// actually reaches the desk — and the method is what decides where the money
// ends up: cash stays with whoever took it, UPI lands in the gym's bank. So the
// person marking it paid says how it was paid, and that is the figure the
// owner's cash position is built from.
exports.settlePayment = async ({ gymId, paymentId, status, reference, recordedBy, method }) => {
  if (!['verified', 'collected'].includes(status)) {
    throw badRequest("status must be 'verified' (QR confirmed) or 'collected' (cash taken).");
  }
  if (method && !['cash', 'qr'].includes(method)) {
    throw badRequest("method must be 'cash' or 'qr'.");
  }
  // The two must agree, or the money would be filed in one place and counted in
  // another: 'collected' means notes changed hands, 'verified' means a transfer
  // was confirmed. A mismatch is a caller bug, not something to reconcile later.
  if (method === 'cash' && status !== 'collected') {
    throw badRequest("A cash payment settles as 'collected'.");
  }
  if (method === 'qr' && status !== 'verified') {
    throw badRequest("A UPI payment settles as 'verified'.");
  }
  // Settling must also let the member IN. A payment started at the door leaves
  // its subscription 'pending_payment' until the money is confirmed — the
  // gateway path does that in gymCheckoutService.settle, and this is the manual
  // equivalent. Without it, staff would mark a QR or cash payment as paid and
  // the member would still be refused at the scanner, which is the worst
  // possible outcome: they have paid and the door says no.
  //
  // One transaction, because a confirmed payment with a subscription still
  // pending is exactly the inconsistency this is meant to prevent.
  const client = await pgPool.pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE gym_payments
          SET status      = $1,
              method      = COALESCE($6, method),
              reference   = COALESCE($2, reference),
              verified_by = $3,
              verified_at = now(),
              updated_at  = now()
        WHERE id = $4 AND gym_id = $5
        RETURNING *`,
      [status, reference || null, recordedBy, paymentId, gymId, method || null]
    );
    if (!result.rows[0]) throw notFound(`Payment '${paymentId}' not found.`);

    // Scoped to 'pending_payment' so re-settling an already-active membership
    // cannot move its dates or revive a cancelled one.
    const sub = await client.query(
      `UPDATE gym_subscriptions
          SET status = 'active', updated_at = now()
        WHERE id = $1 AND status = 'pending_payment'
        RETURNING *`,
      [result.rows[0].subscription_id]
    );

    await client.query('COMMIT');
    return { ...result.rows[0], subscription_activated: sub.rowCount > 0 };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

// Put a payment back to unpaid — the owner correcting a mistaken "paid".
//
// The inverse of settlePayment, and it has to undo BOTH halves or it would leave
// a member training on a membership nobody paid for: the payment returns to
// 'pending' and the subscription it activated returns to 'pending_payment'. One
// transaction, for the same reason settling is.
//
// Refused once the cash has been handed over. At that point the money has
// physically moved to the owner, and silently un-marking it would misstate what
// staff are holding — the count at handover is where a mistake like that should
// have surfaced, and quietly rewriting it afterwards helps nobody.
//
// The reversal is recorded (reversed_at / reversed_by) rather than wiped, so a
// correction is visible and a pattern of them is findable.
exports.reversePayment = async ({ gymId, paymentId, reversedBy }) => {
  const client = await pgPool.pool.connect();
  try {
    await client.query('BEGIN');

    const payment = (await client.query(
      'SELECT * FROM gym_payments WHERE id = $1 AND gym_id = $2 FOR UPDATE',
      [paymentId, gymId]
    )).rows[0];
    if (!payment) throw notFound(`Payment '${paymentId}' not found.`);

    if (!['verified', 'collected'].includes(payment.status)) {
      throw badRequest('That payment is not marked as paid, so there is nothing to undo.');
    }
    if (payment.handed_over_at) {
      throw badRequest(
        'That cash has already been handed over to you, so it cannot be undone here.'
      );
    }

    const updated = await client.query(
      `UPDATE gym_payments
          SET status      = 'pending',
              verified_by = NULL,
              verified_at = NULL,
              reversed_at = now(),
              reversed_by = $2,
              updated_at  = now()
        WHERE id = $1
        RETURNING *`,
      [paymentId, reversedBy]
    );

    // Back to pending_payment, so the door refuses them until it is actually
    // paid. Scoped to 'active' so a subscription that was never activated by
    // this payment is left alone.
    const sub = await client.query(
      `UPDATE gym_subscriptions
          SET status = 'pending_payment', updated_at = now()
        WHERE id = $1 AND status = 'active'
        RETURNING *`,
      [payment.subscription_id]
    );

    await client.query('COMMIT');
    return { ...updated.rows[0], membership_suspended: sub.rowCount > 0 };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

// Recently settled payments — what the owner scans to spot a wrong "paid".
// Newest first, and each row carries who marked it so a correction can be aimed
// at the right person rather than just at the row.
exports.recentSettledPayments = async ({ gymId, limit = 20 }) => {
  const result = await pgPool.query(
    `SELECT p.id, p.amount, p.method, p.status, p.verified_at, p.handed_over_at,
            m.full_name, s.plan_name, s.end_date,
            a.name AS marked_by_name,
            st.role AS marked_by_role
       FROM gym_payments p
       JOIN gym_members m ON m.id = p.member_id
       JOIN gym_subscriptions s ON s.id = p.subscription_id
       LEFT JOIN gym_accounts a ON a.id = COALESCE(p.verified_by, p.recorded_by)
       LEFT JOIN gym_staff st ON st.account_id = COALESCE(p.verified_by, p.recorded_by)
                             AND st.gym_id = p.gym_id
      WHERE p.gym_id = $1
        AND p.status IN ('verified', 'collected')
      ORDER BY COALESCE(p.verified_at, p.created_at) DESC
      LIMIT $2`,
    [gymId, limit]
  );
  return result.rows;
};

exports.listMemberPayments = async ({ gymId, memberId }) => {
  const result = await pgPool.query(
    `SELECT p.*, s.plan_name, s.start_date, s.end_date
       FROM gym_payments p
       JOIN gym_subscriptions s ON s.id = p.subscription_id
      WHERE p.member_id = $1 AND p.gym_id = $2
      ORDER BY p.created_at DESC`,
    [memberId, gymId]
  );
  return result.rows;
};

// `unsettledOnly` is what a staff caller gets: the rows still owed or awaiting
// confirmation, which is the desk's worklist. Settled rows are withheld, because
// a full list of everything ever collected is the gym's takings in another
// shape — and the whole point of the owner/staff split is that staff do not see
// those. Staff can still act on what they can see: taking the cash is their job.
exports.listPayments = async ({ gymId, status, unsettledOnly = false }) => {
  const result = await pgPool.query(
    `SELECT p.*, m.full_name, m.phone, s.plan_name, s.end_date
       FROM gym_payments p
       JOIN gym_members m ON m.id = p.member_id
       JOIN gym_subscriptions s ON s.id = p.subscription_id
      WHERE p.gym_id = $1 AND ($2::text IS NULL OR p.status = $2)
        AND ($3::boolean IS NOT TRUE OR p.status IN ('pending', 'pending_verification'))
      ORDER BY p.created_at DESC
      LIMIT 500`,
    [gymId, status || null, unsettledOnly]
  );
  return result.rows;
};

// --- cash in staff hands ---------------------------------------------------

// Who is holding the gym's money, and how much.
//
// Attribution is COALESCE(verified_by, recorded_by), not recorded_by alone.
// verified_by is who confirmed the money arrived — for cash, the person who put
// the note in their pocket — and that is not always who opened the row: a member
// can start a payment at the door and settle it in cash at the desk days later.
// recorded_by is the fallback for rows nobody has confirmed. Rows with neither
// are the member paying for themselves online, reported under a null account
// rather than dropped, so these figures still reconcile with the gym's takings.
//
// Cash is the only column that means "in their pocket". QR/UPI lands in the
// gym's bank directly, so it is shown per person for credit, not as a debt.
exports.staffCollections = async ({ gymId }) => {
  const result = await pgPool.query(
    `SELECT COALESCE(p.verified_by, p.recorded_by)       AS account_id,
            a.name                                       AS account_name,
            s.role                                       AS staff_role,
            COALESCE(SUM(CASE WHEN p.method = 'cash' AND p.status = 'collected'
                               AND p.handed_over_at IS NULL
                              THEN p.amount END), 0)      AS cash_in_hand,
            COUNT(CASE WHEN p.method = 'cash' AND p.status = 'collected'
                        AND p.handed_over_at IS NULL
                       THEN 1 END)::int                   AS cash_payments,
            COALESCE(SUM(CASE WHEN p.method = 'cash' AND p.handed_over_at IS NOT NULL
                              THEN p.amount END), 0)      AS cash_handed_over,
            COALESCE(SUM(CASE WHEN p.method IN ('qr', 'gateway')
                               AND p.status IN ('verified', 'collected')
                              THEN p.amount END), 0)      AS upi_confirmed,
            COALESCE(SUM(CASE WHEN p.method = 'qr' AND p.status = 'pending_verification'
                              THEN p.amount END), 0)      AS upi_awaiting,
            MAX(CASE WHEN p.method = 'cash' AND p.status = 'collected'
                      AND p.handed_over_at IS NULL
                     THEN p.created_at END)               AS oldest_unsettled_at
       FROM gym_payments p
       LEFT JOIN gym_accounts a ON a.id = COALESCE(p.verified_by, p.recorded_by)
       LEFT JOIN gym_staff s ON s.account_id = COALESCE(p.verified_by, p.recorded_by)
                            AND s.gym_id = p.gym_id
      WHERE p.gym_id = $1
      GROUP BY COALESCE(p.verified_by, p.recorded_by), a.name, s.role
     HAVING COALESCE(SUM(CASE WHEN p.method = 'cash' AND p.status = 'collected'
                               AND p.handed_over_at IS NULL THEN p.amount END), 0) > 0
         OR COALESCE(SUM(CASE WHEN p.method IN ('qr', 'gateway') THEN p.amount END), 0) > 0
         OR COALESCE(SUM(CASE WHEN p.method = 'cash' THEN p.amount END), 0) > 0
      ORDER BY cash_in_hand DESC, a.name ASC`,
    [gymId]
  );
  return result.rows;
};

// The owner's one-line answer to "where is my money": in the bank, in my hands,
// or still in someone's pocket.
//
// Buckets are mutually exclusive and together cover every settled payment, so
// the four figures add up to what the gym has taken — a report that did not add
// up would be worse than none.
//
// Cash whose holder is not a 'staff' row — the owner's own takings, a platform
// admin's, or an unattributed row — counts as with the owner. Somebody has to be
// accountable for it and it is not the front desk.
exports.cashPosition = async ({ gymId }) => {
  const result = await pgPool.query(
    `SELECT
       -- UPI and gateway payments: straight into the gym's bank account.
       COALESCE(SUM(CASE WHEN p.method IN ('qr', 'gateway')
                          AND p.status IN ('verified', 'collected')
                         THEN p.amount END), 0)                          AS in_bank,
       -- Cash the owner holds: taken by them, or handed over to them since.
       COALESCE(SUM(CASE WHEN p.method = 'cash' AND p.status = 'collected'
                          AND (p.handed_over_at IS NOT NULL OR COALESCE(s.role, 'owner') <> 'staff')
                         THEN p.amount END), 0)                          AS cash_with_owner,
       -- Cash still in a staff member's pocket.
       COALESCE(SUM(CASE WHEN p.method = 'cash' AND p.status = 'collected'
                          AND p.handed_over_at IS NULL AND s.role = 'staff'
                         THEN p.amount END), 0)                          AS cash_with_staff,
       -- Not money yet: owed, or a UPI transfer nobody has confirmed.
       COALESCE(SUM(CASE WHEN p.status IN ('pending', 'pending_verification')
                         THEN p.amount END), 0)                          AS still_owed
     FROM gym_payments p
     LEFT JOIN gym_staff s ON s.account_id = COALESCE(p.verified_by, p.recorded_by)
                          AND s.gym_id = p.gym_id
    WHERE p.gym_id = $1`,
    [gymId]
  );
  return result.rows[0];
};

// One person's outstanding cash — what a staff account sees about itself, so the
// desk knows what it owes the owner at the end of a shift. Same arithmetic as
// the owner's report, scoped to one account and with nobody else's figures.
exports.myCashInHand = async ({ gymId, accountId }) => {
  const result = await pgPool.query(
    `SELECT COALESCE(SUM(amount), 0)::text AS cash_in_hand,
            COUNT(*)::int                  AS cash_payments
       FROM gym_payments
      WHERE gym_id = $1 AND COALESCE(verified_by, recorded_by) = $2
        AND method = 'cash' AND status = 'collected'
        AND handed_over_at IS NULL`,
    [gymId, accountId]
  );
  return result.rows[0];
};

// What the owner has actually collected, grouped by day, week or month.
//
// A handover stamps every settled cash row it covers with the same
// handed_over_at, so the history is already in the payments table — no separate
// ledger to keep in step. Grouping by that timestamp in the GYM's timezone, not
// the server's, or a Monday-morning collection in Kolkata would land in the
// previous week.
//
// The period is whitelisted rather than interpolated: it goes into date_trunc,
// which takes a literal, so a caller-supplied value must never reach the SQL.
exports.handoverHistory = async ({ gymId, period = 'week', method = 'cash', limit = 26 }) => {
  const units = { day: 'day', week: 'week', month: 'month' };
  const unit = units[period];
  if (!unit) throw badRequest("period must be 'day', 'week' or 'month'.");
  if (!['cash', 'qr', 'all'].includes(method)) {
    throw badRequest("method must be 'cash', 'qr' or 'all'.");
  }

  const result = await pgPool.query(
    `SELECT date_trunc($2, (p.handed_over_at AT TIME ZONE g.timezone))::date AS period_start,
            SUM(p.amount)                                     AS total,
            COUNT(*)::int                                     AS payments,
            MAX(p.handed_over_at)                             AS last_at,
            string_agg(DISTINCT a.name, ', ')                 AS from_whom
       FROM gym_payments p
       JOIN gyms g ON g.id = p.gym_id
       LEFT JOIN gym_accounts a ON a.id = COALESCE(p.verified_by, p.recorded_by)
      WHERE p.gym_id = $1
        AND ($4::text = 'all' OR p.method = $4)
        AND p.handed_over_at IS NOT NULL
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT $3`,
    [gymId, unit, limit, method === 'qr' ? 'qr' : method]
  );
  return result.rows;
};

// Close one payment off: the owner has accounted for this money.
//
// The counterpart of a cash handover, for money that was never in anyone's
// hands. A UPI payment is already in the owner's account, so there is nothing to
// collect — but until they have seen it on their statement it is still just
// staff's word, and while it is open the Undo button has to stay. Ticking it off
// is what closes it, and a closed payment cannot be reversed, exactly like cash
// that has been handed over.
//
// Deliberately the same two columns as a handover rather than a third timestamp:
// both answer one question — has the owner accounted for this money yet — and
// two ways of recording the same fact would eventually disagree.
exports.closePayment = async ({ gymId, paymentId, closedBy }) => {
  const payment = (await pgPool.query(
    'SELECT * FROM gym_payments WHERE id = $1 AND gym_id = $2',
    [paymentId, gymId]
  )).rows[0];
  if (!payment) throw notFound(`Payment '${paymentId}' not found.`);
  if (!['verified', 'collected'].includes(payment.status)) {
    throw badRequest('That payment is not marked as paid yet.');
  }
  if (payment.handed_over_at) return payment; // already closed; nothing to do

  const result = await pgPool.query(
    `UPDATE gym_payments
        SET handed_over_at = now(), handed_over_to = $2, updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [paymentId, closedBy]
  );
  return result.rows[0];
};

// The owner says "I have taken Ravi's cash". Stamps every outstanding cash row
// he holds, so the report goes to zero and the trail records who received it.
//
// Deliberately settles ALL of that person's outstanding cash rather than an
// amount the owner types: a partial figure could not say WHICH payments it
// covered, and the owner counting notes at the desk is not doing part of a
// drawer. If a count comes up short, that is a conversation, not a data model.
exports.recordCashHandover = async ({ gymId, accountId, receivedBy }) => {
  if (!accountId) throw badRequest('An account must be specified.');
  const result = await pgPool.query(
    `UPDATE gym_payments
        SET handed_over_at = now(), handed_over_to = $3, updated_at = now()
      WHERE gym_id = $1 AND COALESCE(verified_by, recorded_by) = $2
        AND method = 'cash' AND status = 'collected'
        AND handed_over_at IS NULL
      RETURNING amount`,
    [gymId, accountId, receivedBy]
  );
  const total = result.rows.reduce((sum, r) => sum + Number(r.amount), 0);
  return { payments: result.rowCount, total };
};

// --- the owner's dashboard ------------------------------------------------

// The renewal worklist: who has lapsed, and who is about to. Both derive from
// end_date against today in this gym's timezone, so there is no nightly job
// keeping it current and it cannot be out of date.
//
// Each row carries the member's phone, which the console turns into a `tel:`
// link so "call them to renew" is one tap on the owner's phone.
exports.expiryWatchlist = async ({ gymId, withinDays = 7 }) => {
  const result = await pgPool.query(
    `WITH today AS (
       SELECT (now() AT TIME ZONE (SELECT timezone FROM gyms WHERE id = $1))::date AS d
     ),
     current_sub AS (
       SELECT DISTINCT ON (member_id)
              member_id, id AS subscription_id, plan_name, start_date, end_date, amount
         FROM gym_subscriptions
        WHERE gym_id = $1 AND status = 'active'
        ORDER BY member_id, end_date DESC
     )
     SELECT m.id, m.full_name, m.phone, m.member_code, m.joined_on,
            s.subscription_id, s.plan_name, s.end_date, s.amount,
            (s.end_date - t.d) AS days_remaining,
            CASE WHEN s.end_date < t.d THEN 'expired' ELSE 'expiring' END AS bucket
       FROM gym_members m
       JOIN current_sub s ON s.member_id = m.id
       CROSS JOIN today t
      WHERE m.gym_id = $1
        AND m.status = 'active'
        AND s.end_date <= t.d + $2::int
      ORDER BY s.end_date ASC`,
    [gymId, withinDays]
  );

  // Members with no subscription at all are a different problem from a lapsed
  // one — they were registered and never started — so they are reported
  // separately rather than mixed into "expired".
  const neverStarted = await pgPool.query(
    `SELECT m.id, m.full_name, m.phone, m.joined_on
       FROM gym_members m
       LEFT JOIN gym_subscriptions s ON s.member_id = m.id AND s.status = 'active'
      WHERE m.gym_id = $1 AND m.status = 'active' AND s.id IS NULL
      ORDER BY m.joined_on DESC`,
    [gymId]
  );

  return {
    withinDays,
    expired: result.rows.filter((r) => r.bucket === 'expired'),
    expiring: result.rows.filter((r) => r.bucket === 'expiring'),
    neverStarted: neverStarted.rows,
  };
};

// Headline counts for the top of the owner's dashboard.
//
// `includeFinancials` is false for a staff account: the two money figures are
// left out of the SQL entirely rather than computed and then stripped from the
// response, so the gym's takings are never assembled for someone who may not
// see them, and a future caller that forgets to filter the object cannot leak
// them. Everything else — headcounts, attendance, how many memberships have
// lapsed — is the front desk's job and stays.
exports.dashboardSummary = async ({ gymId, includeFinancials = true }) => {
  const financials = includeFinancials
    ? `,
       (SELECT COUNT(*)::int FROM gym_payments
         WHERE gym_id = $1 AND status IN ('pending', 'pending_verification')) AS payments_awaiting,
       -- Month boundaries in the GYM's timezone, not the server's. Comparing a
       -- timestamptz against a bare timestamp would have Postgres resolve it
       -- using the session TimeZone (UTC on Render), which puts payments taken
       -- late on the last evening of a month into the next one.
       (SELECT COALESCE(SUM(amount), 0) FROM gym_payments p, today t
         WHERE p.gym_id = $1 AND p.status IN ('verified', 'collected')
           AND date_trunc('month', (p.created_at AT TIME ZONE (SELECT timezone FROM tz))::date)
               = date_trunc('month', t.d)) AS collected_this_month`
    : '';

  const result = await pgPool.query(
    `WITH today AS (
       SELECT (now() AT TIME ZONE (SELECT timezone FROM gyms WHERE id = $1))::date AS d
     ),
     current_sub AS (
       SELECT DISTINCT ON (member_id) member_id, end_date
         FROM gym_subscriptions
        WHERE gym_id = $1 AND status = 'active'
        ORDER BY member_id, end_date DESC
     ),
     tz AS (SELECT timezone FROM gyms WHERE id = $1)
     SELECT
       (SELECT COUNT(*)::int FROM gym_members
         WHERE gym_id = $1 AND status = 'active')                          AS active_members,
       (SELECT COUNT(*)::int FROM current_sub s, today t
         WHERE s.end_date >= t.d)                                          AS active_subscriptions,
       (SELECT COUNT(*)::int FROM current_sub s, today t
         WHERE s.end_date <  t.d)                                          AS expired_subscriptions,
       (SELECT COUNT(*)::int FROM gym_attendance a, today t
         WHERE a.gym_id = $1 AND a.visit_date = t.d)                       AS visits_today,
       (SELECT COUNT(*)::int FROM gym_attendance a, today t
         WHERE a.gym_id = $1 AND a.visit_date = t.d
           AND a.check_out_at IS NULL)                                     AS currently_in
       ${financials}`,
    [gymId]
  );
  return result.rows[0];
};
