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
  if (!name || !email || !password) throw badRequest('name, email and password are required.');
  if (String(password).length < 8) throw badRequest('Password must be at least 8 characters.');

  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await pgPool.query('SELECT id FROM gym_accounts WHERE email = $1', [
    normalizedEmail,
  ]);
  if (existing.rows[0]) throw badRequest(`An account already exists for ${normalizedEmail}.`);

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pgPool.query(
    `INSERT INTO gym_accounts (id, name, email, password_hash, phone, platform_admin)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [genId('GAC'), name, normalizedEmail, passwordHash, phone || null, !!platformAdmin]
  );
  return publicAccount(result.rows[0]);
};

exports.login = async ({ email, password }) => {
  if (!email || !password) throw badRequest('Email and password are required.');

  const result = await pgPool.query('SELECT * FROM gym_accounts WHERE email = $1', [
    String(email).trim().toLowerCase(),
  ]);
  const account = result.rows[0];

  // Same message and a real bcrypt comparison whether or not the account
  // exists, so a wrong email and a wrong password are indistinguishable — the
  // login form must not double as a way to find out who has an account.
  const hash = account ? account.password_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const matches = await bcrypt.compare(password, hash);

  if (!account || !matches) throw unauthorized('Incorrect email or password.');
  if (account.status !== 'active') throw forbidden('This account has been suspended.');

  const gyms = await exports.accessibleGyms(account);
  return {
    token: jwt.sign({ sub: account.id, kind: TOKEN_KIND }, secret(), { expiresIn: TOKEN_TTL }),
    account: publicAccount(account),
    gyms,
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
