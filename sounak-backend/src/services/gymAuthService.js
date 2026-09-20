// src/services/gymAuthService.js
//
// Logins for the gym portal, deliberately independent of the Mongo `users`
// collection the grocery and doctors portals authenticate against. See the
// header of src/db/schema_gym.sql, decision 2: no gym table is shared with
// another portal, and that includes the one holding credentials.
//
// What authorises an owner is NOT a claim in their token — it is a gym_staff
// row read fresh from the database on every request. The token only says which
// account is calling. That mirrors how passport.js treats the Mongo role (it
// re-fetches the user rather than trusting the token), so a token issued before
// someone lost access to a gym cannot still reach it.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pgPool = require('../config/pg.config');
const { genId } = require('../utils/id');

// A distinct secret when one is configured, so a gym token and a grocery token
// are not interchangeable even if the `kind` check below were ever dropped.
const secret = () => process.env.GYM_JWT_SECRET || process.env.JWT_SECRET;

// Marks the token as belonging to this portal. Checked on every verify, so a
// grocery user's token cannot be presented to a gym route (and vice versa)
// even when both are signed with the same fallback secret.
const TOKEN_KIND = 'gym';

// 12 hours, not the 1 hour the grocery portal uses. An owner has the console
// open at the desk through a working day; expiring their session mid-shift
// would read as the app being broken rather than as a security measure, which
// is precisely the confusion a 1-hour token caused elsewhere in this codebase.
const TOKEN_TTL = '12h';

const badRequest = (message) => {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
};

const unauthorized = (message) => {
  const err = new Error(message);
  err.statusCode = 401;
  return err;
};

const forbidden = (message) => {
  const err = new Error(message);
  err.statusCode = 403;
  return err;
};

const publicAccount = (account) => ({
  id: account.id,
  name: account.name,
  email: account.email,
  phone: account.phone,
  platformAdmin: account.platform_admin,
});

exports.publicAccount = publicAccount;

// --- accounts --------------------------------------------------------------

// Creating an account never grants access to a gym — that is a separate,
// explicit gym_staff row. So this is safe to call from the platform admin's
// "add an owner" screen and from the seed script alike.
exports.createAccount = async ({ name, email, password, phone, platformAdmin = false }) => {
  if (!name || !password) throw badRequest('name and password are required.');
  // Either identifier will do, but one of them must exist or the account could
  // never be signed in to.
  if (!email && !phone) throw badRequest('An email address or a mobile number is required.');
  if (String(password).length < 8) throw badRequest('Password must be at least 8 characters.');

  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  if (normalizedEmail) {
    const existing = await pgPool.query('SELECT id FROM gym_accounts WHERE email = $1', [normalizedEmail]);
    if (existing.rows[0]) throw badRequest(`An account already exists for ${normalizedEmail}.`);
  }
  if (phone) {
    const existingPhone = await pgPool.query(
      `SELECT id FROM gym_accounts
        WHERE right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = $1`,
      [phoneKey(phone)]
    );
    if (existingPhone.rows[0]) throw badRequest('An account already exists for that mobile number.');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pgPool.query(
    `INSERT INTO gym_accounts (id, name, email, password_hash, phone, platform_admin)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [genId('GAC'), name, normalizedEmail, passwordHash, phone || null, !!platformAdmin]
  );
  return publicAccount(result.rows[0]);
};

// 10+ digits once punctuation is stripped: treated as a mobile number rather
// than an email. Nobody's email address is ten digits and nothing else.
const phoneKey = (value) => String(value || '').replace(/\D/g, '').slice(-10);
const looksLikePhone = (value) => phoneKey(value).length >= 10 && !String(value).includes('@');

/**
 * Sign in with EITHER an email or a mobile number.
 *
 * `identifier` is the field to use; `email` is still accepted so nothing that
 * called this before has to change.
 */
exports.login = async ({ identifier, email, phone, password }) => {
  const given = identifier || email || phone;
  if (!given || !password) throw badRequest('Enter your email or mobile number, and your password.');

  const result = looksLikePhone(given)
    ? await pgPool.query(
        `SELECT * FROM gym_accounts
          WHERE right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = $1`,
        [phoneKey(given)]
      )
    : await pgPool.query('SELECT * FROM gym_accounts WHERE email = $1', [
        String(given).trim().toLowerCase(),
      ]);
  const account = result.rows[0];

  // Same message and a real bcrypt comparison whether or not the account
  // exists, so a wrong email and a wrong password are indistinguishable — the
  // login form must not double as a way to find out who has an account.
  const hash = account ? account.password_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const matches = await bcrypt.compare(password, hash);

  if (!account || !matches) throw unauthorized('Incorrect email/mobile number or password.');
  if (account.status !== 'active') throw forbidden('This account has been suspended.');

  // Both are returned because one account can be either, or both: a gym owner
  // who also trains is an ordinary case, not an edge case. The client decides
  // which home screen to show from what comes back.
  const [gyms, memberships] = await Promise.all([
    exports.accessibleGyms(account),
    exports.accessibleMemberships(account),
  ]);

  return {
    token: jwt.sign({ sub: account.id, kind: TOKEN_KIND }, secret(), { expiresIn: TOKEN_TTL }),
    account: publicAccount(account),
    gyms,
    memberships,
  };
};

exports.changePassword = async ({ accountId, currentPassword, newPassword }) => {
  if (!newPassword || String(newPassword).length < 8) {
    throw badRequest('New password must be at least 8 characters.');
  }
  const result = await pgPool.query('SELECT * FROM gym_accounts WHERE id = $1', [accountId]);
  const account = result.rows[0];
  if (!account) throw unauthorized('Account not found.');
  if (!(await bcrypt.compare(currentPassword || '', account.password_hash))) {
    throw forbidden('Current password is incorrect.');
  }
  await pgPool.query(
    'UPDATE gym_accounts SET password_hash = $1, updated_at = now() WHERE id = $2',
    [await bcrypt.hash(newPassword, 10), accountId]
  );
  return { changed: true };
};

// --- token verification ----------------------------------------------------

// Re-reads the account on every request rather than trusting the token's
// contents, so a suspended account stops working immediately instead of when
// its token happens to expire.
exports.verifyToken = async (token) => {
  if (!token) throw unauthorized('Sign in to continue.');

  let payload;
  try {
    payload = jwt.verify(token, secret());
  } catch (err) {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
  if (payload.kind !== TOKEN_KIND) throw unauthorized('This token is not valid for the gym portal.');

  const result = await pgPool.query('SELECT * FROM gym_accounts WHERE id = $1', [payload.sub]);
  const account = result.rows[0];
  if (!account) throw unauthorized('Your session is no longer valid. Please sign in again.');
  if (account.status !== 'active') throw forbidden('This account has been suspended.');
  return account;
};

// --- gym access ------------------------------------------------------------

// The gyms this account may administer. A platform admin sees every gym; an
// owner sees only what gym_staff names.
exports.accessibleGyms = async (account) => {
  if (account.platform_admin) {
    const all = await pgPool.query(
      `SELECT id, name, gym_code, timezone, status, 'platform_admin' AS staff_role
         FROM gyms ORDER BY name ASC`
    );
    return all.rows;
  }
  const result = await pgPool.query(
    `SELECT g.id, g.name, g.gym_code, g.timezone, g.status, s.role AS staff_role
       FROM gym_staff s
       JOIN gyms g ON g.id = s.gym_id
      WHERE s.account_id = $1
      ORDER BY g.name ASC`,
    [account.id]
  );
  return result.rows;
};

// The memberships this account holds — the member-side counterpart of
// accessibleGyms. A member of two gyms on the platform gets both, each with its
// own subscription state.
//
// Note this deliberately does NOT go through gym_staff: being a member of a gym
// grants a view of your OWN record there and nothing else. Administering it is
// a separate grant.
exports.accessibleMemberships = async (account) => {
  const result = await pgPool.query(
    `SELECT m.id AS member_id, m.full_name, m.member_code, m.joined_on, m.status,
            g.id AS gym_id, g.name AS gym_name, g.gym_code, g.timezone, g.phone AS gym_phone
       FROM gym_members m
       JOIN gyms g ON g.id = m.gym_id
      WHERE m.account_id = $1 AND m.status = 'active'
      ORDER BY g.name ASC`,
    [account.id]
  );
  return result.rows;
};

// Resolves one of this account's own memberships. The member-side equivalent of
// assertGymAccess: it is what stops a signed-in member reading someone else's
// record by passing a different member id.
exports.assertMembership = async (account, memberId) => {
  const result = await pgPool.query(
    `SELECT m.*, g.name AS gym_name, g.timezone, g.phone AS gym_phone, g.gym_code
       FROM gym_members m
       JOIN gyms g ON g.id = m.gym_id
      WHERE m.id = $1 AND m.account_id = $2 AND m.status = 'active'`,
    [memberId, account.id]
  );
  if (!result.rows[0]) {
    const e = new Error('Membership not found.');
    e.statusCode = 404;
    throw e;
  }
  return result.rows[0];
};

// THE tenancy boundary. Every owner-side route resolves its gym through this,
// so "gym A's owner must never see gym B's data" is enforced in exactly one
// place rather than being re-argued per endpoint.
exports.assertGymAccess = async (account, gymId) => {
  if (!gymId) throw badRequest('A gym must be specified.');

  const gymResult = await pgPool.query('SELECT * FROM gyms WHERE id = $1', [gymId]);
  const gym = gymResult.rows[0];
  if (!gym) {
    // Deliberately 404 rather than 403: telling a stranger that a gym id
    // exists but is not theirs is itself information about the platform.
    const err = new Error('Gym not found.');
    err.statusCode = 404;
    throw err;
  }

  if (account.platform_admin) return { gym, staffRole: 'platform_admin' };

  const staffResult = await pgPool.query(
    'SELECT * FROM gym_staff WHERE gym_id = $1 AND account_id = $2',
    [gymId, account.id]
  );
  if (!staffResult.rows[0]) {
    const err = new Error('Gym not found.');
    err.statusCode = 404;
    throw err;
  }

  // A suspended gym is closed to its own staff too — that is the point of
  // suspending it. Checked AFTER the gym_staff lookup above so the 404 for a
  // stranger still comes first: someone guessing ids must not be able to tell
  // a suspended gym from one that was never theirs.
  //
  // The platform admin returned earlier is deliberately exempt, or suspending a
  // gym would lock away the only screen that can un-suspend it.
  if (gym.status !== 'active') {
    const err = new Error(
      'This gym has been suspended by the platform administrator. Contact support to restore access.'
    );
    err.statusCode = 403;
    throw err;
  }

  return { gym, staffRole: staffResult.rows[0].role };
};

// --- gyms + staff (platform admin) ----------------------------------------

const newGymCode = () => crypto.randomBytes(9).toString('base64url');

exports.createGym = async ({ name, address, phone, timezone, ownerAccountId }) => {
  if (!name) throw badRequest('name is required.');

  const client = await pgPool.pool.connect();
  try {
    await client.query('BEGIN');
    const gymResult = await client.query(
      `INSERT INTO gyms (id, name, gym_code, address, phone, timezone)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'Asia/Kolkata'))
       RETURNING *`,
      [genId('GYM'), name, newGymCode(), address || null, phone || null, timezone || null]
    );
    const gym = gymResult.rows[0];

    if (ownerAccountId) {
      await client.query(
        `INSERT INTO gym_staff (id, gym_id, account_id, role) VALUES ($1, $2, $3, 'owner')`,
        [genId('GST'), gym.id, ownerAccountId]
      );
    }
    await client.query('COMMIT');
    return gym;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

exports.listGyms = async () => {
  const result = await pgPool.query(
    `SELECT g.*,
            (SELECT COUNT(*)::int FROM gym_members m
              WHERE m.gym_id = g.id AND m.status = 'active') AS active_members,
            (SELECT COUNT(*)::int FROM gym_staff s WHERE s.gym_id = g.id) AS staff_count
       FROM gyms g
      ORDER BY g.name ASC`
  );
  return result.rows;
};

/**
 * Suspend or reactivate a gym — for a gym that has stopped doing business with
 * the platform.
 *
 * Suspending is not a delete: every member, subscription, payment and
 * attendance row stays exactly as it is, so reactivating restores the gym
 * whole and the records survive for whatever is still owed. What stops is
 * access:
 *
 *   - the printed door QR stops working, because requireGymByCode already
 *     filters on status = 'active' (gymAttendanceService)
 *   - the owner's console stops loading, via assertGymAccess above
 *
 * Nothing is billed or cancelled here; this is an access switch only.
 */
exports.setGymStatus = async ({ gymId, status }) => {
  if (!['active', 'suspended'].includes(status)) {
    throw badRequest("status must be 'active' or 'suspended'.");
  }
  const result = await pgPool.query(
    `UPDATE gyms SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [gymId, status]
  );
  if (!result.rows[0]) {
    const err = new Error('Gym not found.');
    err.statusCode = 404;
    throw err;
  }
  return result.rows[0];
};

exports.addStaff = async ({ gymId, accountId, role = 'owner' }) => {
  if (!['owner', 'staff'].includes(role)) throw badRequest("role must be 'owner' or 'staff'.");
  const result = await pgPool.query(
    `INSERT INTO gym_staff (id, gym_id, account_id, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (gym_id, account_id) DO UPDATE SET role = EXCLUDED.role
     RETURNING *`,
    [genId('GST'), gymId, accountId, role]
  );
  return result.rows[0];
};

exports.listStaff = async (gymId) => {
  const result = await pgPool.query(
    `SELECT s.id, s.role, s.created_at, a.id AS account_id, a.name, a.email, a.phone, a.status
       FROM gym_staff s
       JOIN gym_accounts a ON a.id = s.account_id
      WHERE s.gym_id = $1
      ORDER BY s.role ASC, a.name ASC`,
    [gymId]
  );
  return result.rows;
};

exports.removeStaff = async ({ gymId, accountId }) => {
  const result = await pgPool.query(
    'DELETE FROM gym_staff WHERE gym_id = $1 AND account_id = $2 RETURNING id',
    [gymId, accountId]
  );
  return { removed: result.rowCount };
};

/**
 * Platform admin resetting a gym owner's or staff member's password.
 *
 * Gym staff have no member code, so the self-service reset cannot help them —
 * without this, a locked-out owner needs someone running SQL by hand, which is
 * exactly the hole that made this whole feature necessary.
 */
exports.resetAccountPassword = async ({ accountId, newPassword }) => {
  if (!newPassword || String(newPassword).length < 8) {
    throw badRequest('The new password must be at least 8 characters.');
  }
  const result = await pgPool.query(
    'UPDATE gym_accounts SET password_hash = $1, updated_at = now() WHERE id = $2 RETURNING id, name, email, phone',
    [await bcrypt.hash(newPassword, 10), accountId]
  );
  if (!result.rows[0]) {
    const e = new Error('Account not found.');
    e.statusCode = 404;
    throw e;
  }
  return result.rows[0];
};

/** So the platform admin can find the account to reset. */
exports.listAccounts = async () => {
  const result = await pgPool.query(
    `SELECT a.id, a.name, a.email, a.phone, a.platform_admin, a.status,
            (SELECT COUNT(*)::int FROM gym_staff s WHERE s.account_id = a.id) AS staffs_gyms,
            (SELECT COUNT(*)::int FROM gym_members m WHERE m.account_id = a.id) AS memberships
       FROM gym_accounts a
      ORDER BY a.created_at DESC`
  );
  return result.rows;
};
