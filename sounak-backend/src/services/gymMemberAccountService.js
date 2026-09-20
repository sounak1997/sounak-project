// src/services/gymMemberAccountService.js
//
// Optional member logins.
//
// Scanning the door QR stays the everyday path and needs no account — that is
// the point of the device token, and nothing here changes it. This is the
// second, optional door: a member who wants to see their own history, payments
// and renewals from anywhere can set an email and password once.
//
// HOW IDENTITY IS PROVEN AT SIGN-UP, and why it costs nothing:
// the member signs up FROM A DEVICE THAT IS ALREADY RECOGNISED. Binding that
// device already required the last 4 digits of the mobile number the owner
// registered, so the proof has been done — reusing it means no SMS provider, no
// OTP bill, and no new verification path to get wrong. A member on an unknown
// phone identifies that phone first (the existing search/claim flow) and is
// then in exactly the same position.
const bcrypt = require('bcryptjs');
const pgPool = require('../config/pg.config');
const { genId } = require('../utils/id');
const gymAttendanceService = require('./gymAttendanceService');

const err = (statusCode, message) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

/**
 * Creates a login for an already-recognised member and links it to their
 * membership.
 *
 * If the email already has an account (a member of two gyms on the platform,
 * or an owner who also trains) the existing account is linked rather than
 * refused — one person should not need two logins.
 */
exports.signUp = async ({ gymCode, deviceToken, email, password, name }) => {
  const gym = await gymAttendanceService.requireGymByCode(gymCode);
  const member = await gymAttendanceService.resolveDevice(deviceToken, gym.id);
  if (!member) {
    throw err(403, 'Please identify yourself at the gym QR first, then set up online access.');
  }
  if (member.account_id) {
    throw err(400, 'This membership already has online access. Please sign in instead.');
  }

  // Optional here for the same reason as above: the member's mobile is already
  // on the record this device is bound to, so a password is all that is needed.
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  if (normalizedEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
    throw err(400, 'That email address does not look right. You can also leave it blank.');
  }
  if (!password || String(password).length < 8) {
    throw err(400, 'Password must be at least 8 characters.');
  }

  const client = await pgPool.pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT * FROM gym_accounts
        WHERE ($1::text IS NOT NULL AND email = $1)
           OR right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) =
              right(regexp_replace(COALESCE($2, ''), '\D', '', 'g'), 10)`,
      [normalizedEmail, member.phone]
    );
    let accountId;

    if (existing.rows[0]) {
      // The email is already known. Require the existing password rather than
      // letting a device token silently attach a membership to someone else's
      // account — a device token proves "this phone belongs to this member",
      // not "this person owns that email".
      const matches = await bcrypt.compare(password, existing.rows[0].password_hash);
      if (!matches) {
        throw err(409, 'An account already exists for that email. Enter its password to link this membership, or use a different email.');
      }
      accountId = existing.rows[0].id;
    } else {
      accountId = genId('GAC');
      await client.query(
        `INSERT INTO gym_accounts (id, name, email, password_hash, phone, platform_admin)
         VALUES ($1, $2, $3, $4, $5, false)`,
        [
          accountId,
          name || member.full_name,
          normalizedEmail,
          await bcrypt.hash(password, 10),
          member.phone,
        ]
      );
    }

    // The WHERE guards against two devices signing up at once: the second finds
    // account_id already set and updates nothing.
    const linked = await client.query(
      `UPDATE gym_members SET account_id = $1, updated_at = now()
        WHERE id = $2 AND account_id IS NULL
        RETURNING *`,
      [accountId, member.id]
    );
    if (linked.rows.length === 0) {
      throw err(400, 'This membership already has online access. Please sign in instead.');
    }

    await client.query('COMMIT');
    return {
      accountId,
      email: normalizedEmail,
      signInWith: normalizedEmail || member.phone,
      memberId: member.id,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

/** Lets the check-in screen offer "set up online access" only when it applies. */
exports.deviceAccountState = async ({ gymCode, deviceToken }) => {
  const gym = await gymAttendanceService.requireGymByCode(gymCode);
  const member = await gymAttendanceService.resolveDevice(deviceToken, gym.id);
  if (!member) return { recognised: false, hasAccount: false };
  return {
    recognised: true,
    hasAccount: !!member.account_id,
    suggestedName: member.full_name,
  };
};

// --- the member's own portal ----------------------------------------------

/**
 * Everything a signed-in member may see about ONE of their memberships.
 *
 * Scoped through assertMembership, so passing another member's id returns 404
 * rather than someone else's training history.
 */
exports.memberOverview = async ({ account, memberId }) => {
  const gymAuthService = require('./gymAuthService');
  const membership = await gymAuthService.assertMembership(account, memberId);

  const gym = {
    id: membership.gym_id,
    name: membership.gym_name,
    timezone: membership.timezone,
    phone: membership.gym_phone,
    gym_code: membership.gym_code,
    closed_weekdays: (await pgPool.query('SELECT closed_weekdays FROM gyms WHERE id = $1', [membership.gym_id])).rows[0].closed_weekdays,
  };

  const subscription = await gymAttendanceService.getCurrentSubscription(memberId, gym.timezone);
  const summary = await gymAttendanceService.attendanceSummary(memberId, subscription, gym);

  const visits = await pgPool.query(
    `SELECT visit_date, check_in_at, check_out_at, method
       FROM gym_attendance
      WHERE member_id = $1
      ORDER BY visit_date DESC
      LIMIT 60`,
    [memberId]
  );

  // The member's own payment history. Deliberately omits the audit columns
  // (who verified it, gateway ids) — that is the owner's bookkeeping, not
  // theirs.
  const payments = await pgPool.query(
    `SELECT p.id, p.amount, p.method, p.status, p.created_at,
            s.plan_name, s.start_date, s.end_date
       FROM gym_payments p
       JOIN gym_subscriptions s ON s.id = p.subscription_id
      WHERE p.member_id = $1
      ORDER BY p.created_at DESC
      LIMIT 30`,
    [memberId]
  );

  return {
    membership: {
      memberId: membership.id,
      fullName: membership.full_name,
      memberCode: membership.member_code,
      joinedOn: membership.joined_on,
      gymId: gym.id,
      gymName: gym.name,
      gymPhone: gym.phone,
      gymCode: gym.gym_code,
    },
    subscription: subscription && {
      planName: subscription.plan_name,
      startDate: subscription.start_date,
      endDate: subscription.end_date,
      isExpired: subscription.is_expired,
      daysRemaining: subscription.days_remaining,
    },
    summary,
    visits: visits.rows,
    payments: payments.rows,
  };
};

/**
 * Standalone sign-up — for a member who is not at the gym.
 *
 * The device-based sign-up above only works on a phone already recognised at
 * the door. Someone at home who simply wants to log in and check their
 * attendance needs a way in that does not involve walking to the gym first.
 *
 * IDENTITY PROOF: member code + mobile number.
 *
 * The code is the secret half. It is 8 random characters, unique across the
 * platform, and was issued for exactly this (see schema_gym.sql) — random
 * rather than sequential so it cannot be guessed by incrementing someone
 * else's. The phone number is the confirming half, and must match what the gym
 * registered.
 *
 * Phone alone would be no proof at all: asking someone to type a number and
 * then confirm digits of the number they just typed is circular. An OTP would
 * be the stronger answer but needs an SMS provider and a per-message cost; this
 * gets the same practical result for nothing, since the gym hands the code out
 * when someone joins, the way a membership number always has been.
 */
exports.signUpWithCode = async ({ memberCode, phone, email, password, name }) => {
  const code = String(memberCode || '').trim();
  const phoneDigits = String(phone || '').replace(/\D/g, '').slice(-10);

  if (!code) throw err(400, 'Please enter your member code — the gym can tell you yours.');
  if (phoneDigits.length < 10) throw err(400, 'Please enter your full 10-digit mobile number.');

  // Email is OPTIONAL. The member's mobile number is already on their record —
  // it is half of the proof they just gave — so it becomes their login
  // identifier and there is nothing further to ask for. Demanding an email
  // would be asking for something neither needed nor verifiable, from people
  // who often do not use one.
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  if (normalizedEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
    throw err(400, 'That email address does not look right. You can also leave it blank.');
  }
  if (!password || String(password).length < 8) {
    throw err(400, 'Password must be at least 8 characters.');
  }

  // Both halves are checked in ONE query with one message for any failure, so
  // the form cannot be used to discover which codes are real.
  const result = await pgPool.query(
    `SELECT m.*, g.name AS gym_name
       FROM gym_members m
       JOIN gyms g ON g.id = m.gym_id
      WHERE m.member_code = $1
        AND right(regexp_replace(COALESCE(m.phone, ''), '\\D', '', 'g'), 10) = $2
        AND m.status = 'active'`,
    [code, phoneDigits]
  );
  const member = result.rows[0];
  if (!member) {
    throw err(404, 'That member code and mobile number do not match a membership. Please check with the gym.');
  }
  if (member.account_id) {
    throw err(400, 'This membership already has a login. Please sign in instead, or reset your password with the gym.');
  }

  const client = await pgPool.pool.connect();
  try {
    await client.query('BEGIN');

    // An existing account is matched on EITHER identifier, since either one
    // could already belong to this person — someone who trains at two gyms
    // should end up with one login, not two.
    const existing = await client.query(
      `SELECT * FROM gym_accounts
        WHERE ($1::text IS NOT NULL AND email = $1)
           OR right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = $2`,
      [normalizedEmail, phoneDigits]
    );
    let accountId;

    if (existing.rows[0]) {
      // Same rule as the device path: knowing a member code does not entitle
      // you to attach a membership to an account you do not control.
      const matches = await bcrypt.compare(password, existing.rows[0].password_hash);
      if (!matches) {
        throw err(409, 'You already have a login for that email or mobile number. Enter its password to add this membership.');
      }
      accountId = existing.rows[0].id;
    } else {
      accountId = genId('GAC');
      await client.query(
        `INSERT INTO gym_accounts (id, name, email, password_hash, phone, platform_admin)
         VALUES ($1, $2, $3, $4, $5, false)`,
        [accountId, name || member.full_name, normalizedEmail, await bcrypt.hash(password, 10), member.phone]
      );
    }

    const linked = await client.query(
      `UPDATE gym_members SET account_id = $1, updated_at = now()
        WHERE id = $2 AND account_id IS NULL
        RETURNING *`,
      [accountId, member.id]
    );
    if (linked.rows.length === 0) {
      throw err(400, 'This membership already has a login. Please sign in instead.');
    }

    await client.query('COMMIT');
    // `signInWith` is what the caller should use to log this person straight
    // in: their email when they gave one, otherwise their mobile.
    return {
      accountId,
      email: normalizedEmail,
      signInWith: normalizedEmail || member.phone,
      memberId: member.id,
      gymName: member.gym_name,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

/**
 * Binds the device of an ALREADY SIGNED-IN member, with nothing to type.
 *
 * Without this, a member who signs in and then opens the check-in screen is
 * asked to identify themselves all over again — which reads as the app having
 * forgotten who they are, seconds after they proved it. Their session is
 * strictly stronger evidence than the phone-number lookup that flow runs, so
 * making them repeat it adds friction and no security.
 *
 * Only ever binds the caller's OWN membership at the named gym: the membership
 * is looked up by account_id, never taken from the request.
 */
exports.bindDeviceFromSession = async ({ account, gymCode, userAgent }) => {
  const crypto = require('crypto');
  const gym = await gymAttendanceService.requireGymByCode(gymCode);

  const result = await pgPool.query(
    `SELECT * FROM gym_members
      WHERE gym_id = $1 AND account_id = $2 AND status = 'active'`,
    [gym.id, account.id]
  );
  const member = result.rows[0];
  if (!member) {
    throw err(404, 'You are not registered as a member of this gym.');
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await pgPool.query(
    `INSERT INTO gym_device_tokens (id, gym_id, member_id, token_hash, device_label, last_used_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [genId('DEV'), gym.id, member.id, hash, String(userAgent || '').slice(0, 80)]
  );

  return { deviceToken: token, memberName: member.full_name, gymName: gym.name };
};
