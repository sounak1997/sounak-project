-- Gym Management portal — Postgres schema. MULTI-TENANT: one deployment hosts
-- many independent gyms (target ~100), each with its own owner, its own
-- members, its own plans and prices, and its own door QR.
--
-- Idempotent, additive-only, same conventions as schema.sql and
-- schema_doctors_tests.sql (app-generated VARCHAR ids, `user_id` holding a
-- MongoDB User._id string with no DB-level FK, since the User collection lives
-- in Mongo rather than here).
--
-- Four decisions are load-bearing across every query, so they are stated once
-- here rather than repeated:
--
-- 1. TENANCY IS EXPLICIT ON EVERY TABLE. `gym_id` is carried on members,
--    plans, subscriptions, payments and attendance even where it could be
--    reached by joining through gym_members. It is denormalised on purpose:
--    with ~100 gyms sharing these tables, the failure that matters is one
--    gym's owner seeing another's data, and a query that forgets a join is far
--    easier to write than one that forgets a WHERE on a column that is right
--    there. Every tenant-scoped query filters on gym_id directly.
--
-- 2. THE GYM PORTAL SHARES NO TABLE WITH ANY OTHER PORTAL. Every table here is
--    gym-prefixed and reachable only from this schema: nothing references
--    products, orders, carts or payment_config, and — see gym_accounts — gym
--    logins do not use the Mongo `users` collection that the grocery and
--    doctors portals authenticate against. A gym owner therefore holds no
--    privilege anywhere else on the deployment, and authority over a gym comes
--    from a `gym_staff` row naming it, never from a role claim in a token.
--
-- 3. EXPIRY IS DERIVED, NEVER STORED. There is no 'expired' status and no
--    `is_expired` flag. A subscription is expired when `end_date < today`,
--    evaluated at read time against the GYM'S OWN timezone. Storing it would
--    need a nightly job to flip the flag, and Render's free tier has no
--    scheduler — so a stored flag would silently go stale. `status` records
--    only what a human did ('active' / 'cancelled').
--
-- 4. ATTENDANCE IS KEYED BY DAY, NOT BY SESSION. Owners want a presence
--    percentage, so what matters is "did this member show up on date X" — one
--    row per member per day. Check-in/check-out times are detail columns on
--    that row, which means a member who forgets to check out still counts as
--    present. That is the common case, not an error.

-- ---------------------------------------------------------------------------
-- The tenants.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gyms (
  id                   VARCHAR PRIMARY KEY,
  name                 VARCHAR NOT NULL,
  -- Carried in this gym's printed door QR (/checkin?g=<gym_code>). Unique
  -- across the platform, so a scan identifies the gym with no other input.
  -- Random rather than sequential, and stored rather than hardcoded, so a gym
  -- whose poster leaks can be reissued and reprinted without a deploy.
  gym_code             VARCHAR NOT NULL UNIQUE,
  address              VARCHAR,
  phone                VARCHAR,
  -- Per gym, not per platform: attendance dates are computed in THIS gym's
  -- wall clock, never UTC. A 5:30 AM IST check-in is 00:00 UTC the same day,
  -- but anything earlier falls on the previous UTC date, which would file
  -- early-morning visits under the wrong day and skew every percentage.
  timezone             VARCHAR NOT NULL DEFAULT 'Asia/Kolkata',
  -- Weekdays this gym is shut, JS Date.getDay() convention (0 = Sunday).
  -- Excluded from the presence-percentage denominator so a member is not
  -- penalised for days they could not attend.
  closed_weekdays      JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- A second scan inside this window is treated as an accidental re-scan or a
  -- page reload, instead of closing the visit with a 0-minute duration.
  rescan_grace_seconds INTEGER NOT NULL DEFAULT 120,
  payment_qr_url       VARCHAR,
  status               VARCHAR NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'suspended')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Logins for the gym portal. SELF-CONTAINED BY DESIGN: the gym portal does not
-- touch the Mongo `users` collection that the grocery and doctors portals
-- authenticate against, and shares no table with them.
--
-- The cost is a second login implementation; the benefit is that a gym owner
-- cannot hold any privilege in another portal even by accident, the gym's
-- tables can be lifted into their own service later with nothing to untangle,
-- and a change to the grocery role model cannot alter who administers a gym.
--
-- Password hashing is bcrypt, the same as the Mongo User model uses, so there
-- are no two standards for storing a password in this codebase.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym_accounts (
  id             VARCHAR PRIMARY KEY,
  name           VARCHAR NOT NULL,
  -- The login identifier, unique across the platform. One person owning two
  -- gyms therefore has ONE account with two gym_staff rows, rather than two
  -- logins — which is why credentials live here and gym membership of staff
  -- lives in gym_staff.
  email          VARCHAR NOT NULL UNIQUE,
  password_hash  VARCHAR NOT NULL,
  phone          VARCHAR,
  -- Creates gyms and assigns their owners: the person running the platform,
  -- not any one gym. Separate from the Mongo 'admin' role on purpose (see the
  -- header note), and seeded by scripts/seedGymPlatformAdmin.js.
  platform_admin BOOLEAN NOT NULL DEFAULT false,
  status         VARCHAR NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'suspended')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Which account administers which gym. See decision 2: this table, not any
-- role claim in a token, is what authorises every owner-side route.
--
-- An account may staff more than one gym (a small chain), and a gym may have
-- more than one staff member, so this is a join table rather than an owner
-- column on `gyms`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym_staff (
  id         VARCHAR PRIMARY KEY,
  gym_id     VARCHAR NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  account_id VARCHAR NOT NULL REFERENCES gym_accounts(id) ON DELETE CASCADE,
  role       VARCHAR NOT NULL DEFAULT 'owner'
               CHECK (role IN ('owner', 'staff')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gym_staff_unique_per_gym UNIQUE (gym_id, account_id)
);

-- Every admin request starts by asking "what may this account administer", so
-- account_id is the lookup that must be fast.
CREATE INDEX IF NOT EXISTS gym_staff_account_idx ON gym_staff (account_id);

-- ---------------------------------------------------------------------------
-- Members. One row per athlete PER GYM.
--
-- `account_id` is NULLABLE, and normally null. Members do not log in: they are
-- recognised at the door by their device (see gym_device_tokens), so an owner
-- adds a walk-in with nothing but a name and a phone number — no email, no
-- password, no account. This is also what keeps the gym separate from the
-- other portals on this deployment: a gym member is a row in THIS table, not a
-- grocery customer who happens to lift weights. A gym_accounts row is linked
-- only if a member later wants online self-service (paying for their own
-- renewal, viewing their own history), which is the one thing needing a login.
--
-- Postgres allows many NULLs under a UNIQUE constraint, so the constraint
-- below binds a linked account to one membership per gym without standing in
-- the way of the many members who have no account at all.
--
-- Unique on (gym_id, account_id) rather than account_id alone: the same person
-- can legitimately train at two gyms on the platform, and each membership is
-- its own record with its own plans, payments and attendance.
--
-- `full_name` and `phone` are deliberately snapshotted from the Mongo User.
-- The owner's screens sort, search and paginate the member list by name and
-- call members by phone — none of which can be expressed in a Postgres
-- ORDER BY / LIMIT if the name lives in another database. Both are refreshed
-- whenever the member is updated.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym_members (
  id                VARCHAR PRIMARY KEY,
  gym_id            VARCHAR NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  account_id        VARCHAR REFERENCES gym_accounts(id) ON DELETE SET NULL,  -- NULL is the norm
  -- Opaque per-member code, unique platform-wide. Random rather than
  -- sequential so a printed member card cannot be forged by incrementing
  -- someone else's number. Unused by the v1 web flow (the QR identifies the
  -- gym, not the member) but issued now so member cards need no migration.
  member_code       VARCHAR NOT NULL UNIQUE,
  full_name         VARCHAR NOT NULL,
  phone             VARCHAR,
  joined_on         DATE NOT NULL DEFAULT CURRENT_DATE,
  status            VARCHAR NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'inactive')),
  emergency_contact VARCHAR,
  notes             VARCHAR,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gym_members_unique_per_gym UNIQUE (gym_id, account_id)
);

CREATE INDEX IF NOT EXISTS gym_members_gym_name_idx ON gym_members (gym_id, full_name);
CREATE INDEX IF NOT EXISTS gym_members_gym_phone_idx ON gym_members (gym_id, phone);

-- ---------------------------------------------------------------------------
-- Plans each gym sells (e.g. "1 Month" / 30 days / 1000). Per gym: 100 gyms
-- set their own durations and prices.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym_plans (
  id            VARCHAR PRIMARY KEY,
  gym_id        VARCHAR NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  name          VARCHAR NOT NULL,
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  price         NUMERIC NOT NULL CHECK (price >= 0),
  description   VARCHAR,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gym_plans_gym_idx ON gym_plans (gym_id);

-- ---------------------------------------------------------------------------
-- Subscriptions. A renewal is a NEW row, never an edit of the old one, so the
-- member's payment history stays intact. `plan_name` / `amount` are
-- snapshotted for the same reason `order_items` snapshots product name and
-- price: later plan-price edits must not rewrite what someone already paid.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym_subscriptions (
  id         VARCHAR PRIMARY KEY,
  gym_id     VARCHAR NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id  VARCHAR NOT NULL REFERENCES gym_members(id) ON DELETE CASCADE,
  plan_id    VARCHAR NOT NULL REFERENCES gym_plans(id),
  plan_name  VARCHAR NOT NULL,
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  amount     NUMERIC NOT NULL CHECK (amount >= 0),
  -- Only what a human chose. Expiry is NOT in here — see decision 3.
  status     VARCHAR NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'cancelled')),
  created_by VARCHAR NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gym_subscriptions_dates_ck CHECK (end_date >= start_date)
);

-- Drives the check-in expiry gate and each gym's expiring/expired worklist.
CREATE INDEX IF NOT EXISTS gym_subscriptions_member_end_idx
  ON gym_subscriptions (member_id, end_date DESC);
CREATE INDEX IF NOT EXISTS gym_subscriptions_gym_end_idx
  ON gym_subscriptions (gym_id, end_date DESC);

-- ---------------------------------------------------------------------------
-- Payments. Mirrors the grocery portal's states so manual verification behaves
-- identically: a QR payment lands as 'pending_verification' and the owner
-- confirms it; cash is recorded straight as 'collected'.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym_payments (
  id                 VARCHAR PRIMARY KEY,
  gym_id             VARCHAR NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  subscription_id    VARCHAR NOT NULL REFERENCES gym_subscriptions(id) ON DELETE CASCADE,
  member_id          VARCHAR NOT NULL REFERENCES gym_members(id) ON DELETE CASCADE,
  amount             NUMERIC NOT NULL CHECK (amount >= 0),
  method             VARCHAR NOT NULL CHECK (method IN ('cash', 'qr', 'gateway')),
  -- pending              = owed, nothing received yet
  -- pending_verification = member paid by QR, awaiting the owner's check
  -- verified             = QR payment confirmed by the owner
  -- collected            = cash taken at the desk
  status             VARCHAR NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'pending_verification', 'verified', 'collected')),
  reference          VARCHAR,   -- UPI txn id the member types in, to speed verification
  -- Nullable and unused in v1. A Razorpay/Stripe webhook fills this in when a
  -- real gateway is added, so that switch needs no migration.
  gateway_payment_id VARCHAR,
  recorded_by        VARCHAR,   -- who entered it (the owner, for cash)
  verified_by        VARCHAR,   -- audit trail, as in `orders`
  verified_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gym_payments_member_idx ON gym_payments (member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gym_payments_gym_status_idx ON gym_payments (gym_id, status);

-- ---------------------------------------------------------------------------
-- Attendance — one row per member per day. See decision 4.
--
-- The UNIQUE constraint is not just hygiene: it is what makes the check-in
-- state machine race-free. Two taps landing at once both try to INSERT; one
-- wins, the other gets a conflict and falls through to the check-out branch,
-- so no member can ever hold two open visits on one day. member_id is already
-- gym-scoped, so the constraint needs no gym_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym_attendance (
  id           VARCHAR PRIMARY KEY,
  gym_id       VARCHAR NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id    VARCHAR NOT NULL REFERENCES gym_members(id) ON DELETE CASCADE,
  visit_date   DATE NOT NULL,          -- in the GYM'S timezone, NOT UTC
  check_in_at  TIMESTAMPTZ NOT NULL,
  -- NULL means the member never checked out. Left as-is on purpose: presence
  -- is the row's existence, so an unknown duration costs nothing.
  check_out_at TIMESTAMPTZ,
  -- self_scan = member scanned the door QR; manual = owner marked them
  -- present (the path for members without a smartphone).
  method       VARCHAR NOT NULL DEFAULT 'self_scan'
                 CHECK (method IN ('self_scan', 'manual')),
  recorded_by  VARCHAR,                -- NULL for self_scan, staff id for manual
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gym_attendance_one_per_day_uq UNIQUE (member_id, visit_date)
);

CREATE INDEX IF NOT EXISTS gym_attendance_gym_date_idx ON gym_attendance (gym_id, visit_date DESC);

-- ---------------------------------------------------------------------------
-- Remembered devices — how check-in identifies a member WITHOUT a login.
--
-- Each gym's door QR is static, so its URL is identical for every member of
-- that gym and carries no personal identity. With no login either, the only
-- thing left that can distinguish one member from another is their phone. So:
-- on a phone's first scan the member finds themselves once (by number or
-- name, confirmed with the last 4 digits of their number), and from then on
-- that device is recognised and check-in is a single tap.
--
-- `token_hash` stores a SHA-256 of the token, never the token itself — the
-- same reasoning as `User.resetPasswordTokenHash` in Mongo: a leaked database
-- dump then yields no working credentials. Lookup is by hash, which the UNIQUE
-- index makes a single-row hit rather than a scan.
--
-- The token is deliberately NOT a JWT and grants NOTHING except attendance for
-- its own member at its own gym: mark a visit, and read that member's own
-- name, subscription status and presence percentage. It cannot reach payments,
-- other members, another gym, or any admin route. So the worst a stolen phone
-- allows is marking its owner present — the risk the owners have said does not
-- matter, since attendance here measures a percentage rather than policing
-- entry. A member of two gyms holds one token per gym, since each is bound to
-- a gym-scoped membership row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym_device_tokens (
  id           VARCHAR PRIMARY KEY,
  gym_id       VARCHAR NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id    VARCHAR NOT NULL REFERENCES gym_members(id) ON DELETE CASCADE,
  token_hash   VARCHAR NOT NULL UNIQUE,
  device_label VARCHAR,        -- coarse UA hint, so the owner can tell devices apart
  revoked      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS gym_device_tokens_member_idx ON gym_device_tokens (member_id);

-- ===========================================================================
-- ONLINE PAYMENTS (UPI via a payment gateway)
--
-- Why any of this is needed: a static UPI QR produces NO callback. Money moves
-- bank -> NPCI -> bank and this server is not in that path, so it never learns
-- the payment happened. That is why `qr` payments are verified by hand. To get
-- a confirmation there must be a provider in the loop who created the order and
-- therefore knows what the money was for.
--
-- Multi-tenant consequence: each gym is paid into ITS OWN bank account, so each
-- gym brings its own gateway account and its own API keys. The platform never
-- holds anyone's money, which also keeps it clear of payment-aggregator
-- licensing — a deliberate choice over collecting centrally and paying gyms out.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Per-gym gateway credentials.
--
-- `key_secret_enc` and `webhook_secret_enc` are AES-256-GCM ciphertext (see
-- src/utils/secretBox.js), never plaintext: these are credentials that can move
-- another business's money, and they belong to the gym owner rather than to us.
-- `key_id` is NOT encrypted — it is public by design and ships to the browser
-- to open the checkout.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym_payment_providers (
  gym_id             VARCHAR PRIMARY KEY REFERENCES gyms(id) ON DELETE CASCADE,
  provider           VARCHAR NOT NULL DEFAULT 'razorpay' CHECK (provider IN ('razorpay')),
  key_id             VARCHAR NOT NULL,
  key_secret_enc     VARCHAR NOT NULL,
  webhook_secret_enc VARCHAR,
  enabled            BOOLEAN NOT NULL DEFAULT true,
  updated_by         VARCHAR,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- A subscription bought online is NOT active until the money arrives.
--
-- 'pending_payment' is added rather than creating the subscription only on
-- success, so an abandoned checkout leaves a visible row instead of vanishing.
-- Everything that grants access already filters on status = 'active', so a
-- pending row cannot let anyone train — the default is safe without touching
-- those queries.
-- ---------------------------------------------------------------------------
ALTER TABLE gym_subscriptions DROP CONSTRAINT IF EXISTS gym_subscriptions_status_check;
ALTER TABLE gym_subscriptions ADD CONSTRAINT gym_subscriptions_status_check
  CHECK (status IN ('active', 'cancelled', 'pending_payment'));

-- A checkout can fail or be abandoned, and that must be distinguishable from
-- "not paid yet".
ALTER TABLE gym_payments DROP CONSTRAINT IF EXISTS gym_payments_status_check;
ALTER TABLE gym_payments ADD CONSTRAINT gym_payments_status_check
  CHECK (status IN ('pending', 'pending_verification', 'verified', 'collected', 'failed'));

ALTER TABLE gym_payments
  ADD COLUMN IF NOT EXISTS gateway_order_id VARCHAR;

-- THE idempotency guard. Gateways deliver webhooks at-least-once and retry, so
-- the same payment arrives repeatedly; without this a replayed webhook could
-- activate a subscription twice. Partial, because the column stays NULL for
-- every cash and manual-QR payment.
CREATE UNIQUE INDEX IF NOT EXISTS gym_payments_gateway_payment_uq
  ON gym_payments (gateway_payment_id)
  WHERE gateway_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gym_payments_gateway_order_idx
  ON gym_payments (gateway_order_id)
  WHERE gateway_order_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Every webhook received, stored raw.
--
-- Kept because money is involved: when a member says they paid and the system
-- disagrees, the question is always "what did the gateway actually send us",
-- and a parsed summary cannot answer it. Also makes a missed event replayable
-- rather than lost.
--
-- `event_id` is the provider's own id and is UNIQUE, which is the second
-- idempotency guard — a duplicate delivery is rejected at insert, before any
-- money logic runs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym_webhook_events (
  id           VARCHAR PRIMARY KEY,
  provider     VARCHAR NOT NULL,
  event_id     VARCHAR NOT NULL UNIQUE,
  event_type   VARCHAR,
  gym_id       VARCHAR REFERENCES gyms(id) ON DELETE SET NULL,
  payload      JSONB NOT NULL,
  signature_ok BOOLEAN NOT NULL,
  processed_at TIMESTAMPTZ,
  error        VARCHAR,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gym_webhook_events_received_idx
  ON gym_webhook_events (received_at DESC);

-- ---------------------------------------------------------------------------
-- MEMBER ACCOUNTS (added 2026-09-20)
--
-- Members still do not NEED an account — scanning the door QR stays the
-- everyday path and requires no login, which is the whole point of the device
-- token. But a member may now optionally create one, to sign in and see their
-- own attendance history, payments and renewals from anywhere.
--
-- No new table: a member's login is a `gym_accounts` row, the same table gym
-- staff use. What someone IS follows from what points at their account —
--
--   a gym_staff row      -> they administer that gym
--   gym_members.account_id -> they train at that gym
--   both                 -> an owner who also trains, which works naturally
--
-- A second "members" credential table would have duplicated password hashing,
-- login, lockout and reset for no gain.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS gym_members_account_idx
  ON gym_members (account_id) WHERE account_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- SIGN IN WITH EMAIL *OR* MOBILE (added 2026-09-20)
--
-- Members remember their mobile number; many will not have an email they use.
-- Worse, the number is already on their membership record, so demanding an
-- email at sign-up was asking for something we neither needed nor could check.
--
-- So `email` becomes optional and the phone becomes a login identifier in its
-- own right. An account must still carry at least one of the two, or there
-- would be no way to sign in to it at all.
-- ---------------------------------------------------------------------------
ALTER TABLE gym_accounts ALTER COLUMN email DROP NOT NULL;

-- Uniqueness on the NORMALISED number, so "+91 96099 87874", "09609987874" and
-- "9609987874" cannot become three accounts that all answer to the same phone.
CREATE UNIQUE INDEX IF NOT EXISTS gym_accounts_phone_uq
  ON gym_accounts (right(regexp_replace(phone, '\D', '', 'g'), 10))
  WHERE phone IS NOT NULL;

ALTER TABLE gym_accounts DROP CONSTRAINT IF EXISTS gym_accounts_identifier_ck;
ALTER TABLE gym_accounts ADD CONSTRAINT gym_accounts_identifier_ck
  CHECK (email IS NOT NULL OR phone IS NOT NULL);
