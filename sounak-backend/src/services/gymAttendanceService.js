// src/services/gymAttendanceService.js
//
// The gym door check-in flow, and the attendance records it produces.
// See docs/gym-management-requirements.md.
//
// Shape of the flow, because it explains every otherwise-odd decision below:
// each gym prints ONE static QR and sticks it by its door. Because it is
// static, a phone's ordinary camera app opens it as a plain URL — there is no
// scanner to build, no camera permission, and no app to install. But it also
// means the URL is identical for every member of that gym and carries only the
// gym's code, so it cannot say WHO is scanning. Members are not logged in
// either. Identity therefore comes from the DEVICE: on a phone's first scan the
// member finds themselves once, that phone is issued a long-lived token, and
// every scan after that is a single tap.
//
// The member never states whether they are arriving or leaving — the server
// derives it from whether today's visit is still open. That keeps the client
// dumb, and means a page reload or a double tap cannot corrupt anything.
//
// Multi-tenant throughout: every query is scoped to one gym. A member search
// run from gym A's poster must never reach gym B's members, so `gym_id` is on
// every statement here, not inferred by joining.
const crypto = require('crypto');
const pgPool = require('../config/pg.config');
const { genId } = require('../utils/id');

// How far the browser's clock may disagree with the server's before we stop
// trusting it. The client sends its own timestamp so a check-in recorded while
// Render is waking from sleep (30-60s on the free tier) still shows the time
// the member actually tapped, rather than the time the request landed. Beyond
// this window the device clock is likelier wrong than the request slow, so the
// server clock wins.
const CLOCK_DRIFT_TOLERANCE_MS = 10 * 60 * 1000;

const SCAN_OUTCOME = {
  CHECKED_IN: 'checked_in',
  CHECKED_OUT: 'checked_out',
  // A second scan inside the grace window: an accidental re-scan or a page
  // reload. Reported as a no-op rather than closing a 0-minute visit.
  DUPLICATE_IGNORED: 'duplicate_ignored',
  ALREADY_COMPLETE: 'already_complete',
  NO_SUBSCRIPTION: 'no_subscription',
  SUBSCRIPTION_EXPIRED: 'subscription_expired',
};

exports.SCAN_OUTCOME = SCAN_OUTCOME;

const NAME_SEARCH_MIN_CHARS = 3;
const MAX_CANDIDATES = 8;

// --- helpers ---------------------------------------------------------------

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Last 10 digits, so "+91 98765 43210", "098765 43210" and "9876543210" all
// match the same member however the owner happened to type it in.
const phoneKey = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

// Shown in the candidate list so a member can recognise themselves without the
// screen printing someone else's full mobile number.
const phoneHint = (phone) => {
  const digits = phoneKey(phone);
  return digits.length >= 4 ? `xxxxxx${digits.slice(-4)}` : null;
};

// A coarse hint so an owner can tell a member's devices apart. Deliberately not
// a full UA string: it only needs to read as "Android - Chrome", not to
// fingerprint anyone.
const deviceLabelFrom = (userAgent = '') => {
  const os = /iPhone|iPad|iOS/i.test(userAgent) ? 'iOS'
    : /Android/i.test(userAgent) ? 'Android'
    : /Windows/i.test(userAgent) ? 'Windows'
    : /Mac OS/i.test(userAgent) ? 'Mac'
    : 'Unknown';
  const browser = /Edg\//i.test(userAgent) ? 'Edge'
    : /Chrome\//i.test(userAgent) ? 'Chrome'
    : /Firefox\//i.test(userAgent) ? 'Firefox'
    : /Safari\//i.test(userAgent) ? 'Safari'
    : 'Browser';
  return `${os} - ${browser}`;
};

// Returns a Date to record, or null meaning "use the database's now()".
const resolveScanTime = (clientTime) => {
  if (!clientTime) return null;
  const at = new Date(clientTime);
  if (Number.isNaN(at.getTime())) return null;
  if (Math.abs(Date.now() - at.getTime()) > CLOCK_DRIFT_TOLERANCE_MS) return null;
  return at;
};

const err = (statusCode, message) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

const INVALID_LINK = 'This check-in link is not valid. Please scan the QR at the gym entrance.';
const NOT_ON_LIST = 'We could not find you on the member list. Please ask at the gym desk.';

// --- the gym behind a scanned code -----------------------------------------

// Every public endpoint starts here. The gym code is the only thing the printed
// QR carries, so it both identifies the tenant and proves the request came from
// a poster rather than from someone poking at the API.
const requireGymByCode = async (gymCode) => {
  if (!gymCode) throw err(403, INVALID_LINK);
  const result = await pgPool.query(
    "SELECT * FROM gyms WHERE gym_code = $1 AND status = 'active'",
    [gymCode]
  );
  if (!result.rows[0]) throw err(403, INVALID_LINK);
  return result.rows[0];
};

exports.requireGymByCode = requireGymByCode;

const getGym = async (gymId) => {
  const result = await pgPool.query('SELECT * FROM gyms WHERE id = $1', [gymId]);
  if (!result.rows[0]) throw err(404, 'Gym not found.');
  return result.rows[0];
};

// --- first scan on a phone: find, then claim -------------------------------

// Split into two steps on purpose — search, then claim — because they carry
// very different exposure. Search reads other people's names, so it is
// deliberately narrow. Claiming issues a standing credential, so it always
// demands proof.

// Accepts a full mobile number OR a name fragment, scoped to the scanned gym.
//
// A name search is a much wider window onto a membership than a phone number
// is: with no floor on the query, typing "a" would list most of the gym to
// anyone who photographed the door poster. Members' names are not the owner's
// to leak, so name search needs a few characters and returns a capped list. A
// full 10-digit number is exact, so it is not capped by the same reasoning —
// knowing the whole number is itself the identifier.
exports.search = async ({ gymCode, query }) => {
  const gym = await requireGymByCode(gymCode);

  const raw = String(query || '').trim();
  const key = phoneKey(raw);
  const looksLikePhone = key.length >= 10;

  // Member code first. It is what the gym hands out and what this screen
  // displays back to a recognised member, so it is the thing people naturally
  // type — and before this was accepted here, typing it fell through to a NAME
  // search and reported "not on the member list", which is both wrong and
  // alarming. Exact match only, scoped to this gym.
  //
  // Safe as a lookup: finding a candidate is not the same as claiming one.
  // claim() still demands the last 4 digits of the registered mobile, so a
  // known code on its own cannot bind a device.
  const byCode = await pgPool.query(
    `SELECT id, full_name, phone FROM gym_members
      WHERE gym_id = $1 AND member_code = $2 AND status = 'active'`,
    [gym.id, raw]
  );
  if (byCode.rows.length > 0) {
    return {
      gymName: gym.name,
      matchedBy: 'code',
      candidates: byCode.rows.map((m) => ({
        id: m.id,
        fullName: m.full_name,
        phoneHint: phoneHint(m.phone),
        claimable: phoneKey(m.phone).length >= 4,
      })),
    };
  }

  if (!looksLikePhone && raw.length < NAME_SEARCH_MIN_CHARS) {
    throw err(400, `Enter your mobile number, your member code, or at least ${NAME_SEARCH_MIN_CHARS} letters of your name.`);
  }

  const result = looksLikePhone
    ? await pgPool.query(
        `SELECT id, full_name, phone FROM gym_members
          WHERE gym_id = $1
            AND right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $2
            AND status = 'active'
          ORDER BY full_name ASC`,
        [gym.id, key]
      )
    : await pgPool.query(
        `SELECT id, full_name, phone FROM gym_members
          WHERE gym_id = $1
            AND full_name ILIKE '%' || $2 || '%'
            AND status = 'active'
          ORDER BY full_name ASC
          LIMIT $3`,
        [gym.id, raw, MAX_CANDIDATES]
      );

  if (result.rows.length === 0) throw err(404, NOT_ON_LIST);


  return {
    gymName: gym.name,
    // Tells the screen whether it can verify silently (it already holds the
    // digits the member just typed) or must ask for the last 4.
    matchedBy: looksLikePhone ? 'phone' : 'name',
    candidates: result.rows.map((m) => ({
      id: m.id,
      fullName: m.full_name,
      phoneHint: phoneHint(m.phone),
      // Flagged so the screen can say "ask at the desk" rather than offering a
      // verification step that cannot succeed.
      claimable: phoneKey(m.phone).length >= 4,
    })),
  };
};

// Binds this device to a member. Always requires the last 4 digits of their
// registered mobile, however they were found.
//
// Uniform on the server, but free on the common path: a member who searched by
// full number has already typed those digits, so the screen submits them
// automatically and never shows a second prompt. Only a name search asks. That
// stops a device credential being issued off a guessed name without putting a
// step in front of the everyday case.
exports.claim = async ({ gymCode, memberId, verify, userAgent }) => {
  const gym = await requireGymByCode(gymCode);

  const result = await pgPool.query(
    "SELECT * FROM gym_members WHERE id = $1 AND gym_id = $2 AND status = 'active'",
    [memberId, gym.id]
  );
  const member = result.rows[0];
  if (!member) throw err(404, NOT_ON_LIST);

  const registered = phoneKey(member.phone);
  if (registered.length < 4) {
    throw err(403, 'There is no mobile number on your membership yet. Please ask at the gym desk.');
  }
  if (phoneKey(verify).slice(-4) !== registered.slice(-4)) {
    throw err(403, 'Those last 4 digits do not match the number on your membership.');
  }

  // 32 random bytes: this is the member's standing credential for attendance,
  // so it must not be guessable. Only its hash is stored.
  const token = crypto.randomBytes(32).toString('base64url');
  await pgPool.query(
    `INSERT INTO gym_device_tokens (id, gym_id, member_id, token_hash, device_label, last_used_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [genId('DEV'), gym.id, member.id, hashToken(token), deviceLabelFrom(userAgent)]
  );

  return { gymName: gym.name, member: publicMember(member), deviceToken: token };
};

// token -> member, scoped to the gym whose poster was scanned.
//
// The gym_id condition is what stops a token issued at one gym being replayed
// against another's check-in URL. Also records the touch, so an owner can spot
// dormant devices.
const resolveDevice = async (deviceToken, gymId) => {
  if (!deviceToken) return null;
  const result = await pgPool.query(
    `UPDATE gym_device_tokens
        SET last_used_at = now()
      WHERE token_hash = $1 AND gym_id = $2 AND revoked = false
      RETURNING member_id`,
    [hashToken(deviceToken), gymId]
  );
  if (!result.rows[0]) return null;

  const memberResult = await pgPool.query(
    'SELECT * FROM gym_members WHERE id = $1 AND gym_id = $2',
    [result.rows[0].member_id, gymId]
  );
  const member = memberResult.rows[0];
  if (!member || member.status !== 'active') return null;
  return member;
};

exports.resolveDevice = resolveDevice;

// The device token is an attendance credential only, so this is everything a
// holder of one is ever allowed to see about the member.
const publicMember = (member) => ({
  id: member.id,
  fullName: member.full_name,
  memberCode: member.member_code,
  joinedOn: member.joined_on,
});

// --- subscription (derived expiry) ----------------------------------------

// There is no 'expired' status in the schema on purpose — nothing flips a flag
// nightly, because Render's free tier has no scheduler and a stale flag is
// worse than none. Expiry is computed here, against the gym's own local date.
const getCurrentSubscription = async (memberId, timezone) => {
  const result = await pgPool.query(
    `SELECT *,
            (end_date < (now() AT TIME ZONE $2)::date) AS is_expired,
            (end_date - (now() AT TIME ZONE $2)::date) AS days_remaining
       FROM gym_subscriptions
      WHERE member_id = $1 AND status = 'active'
      ORDER BY end_date DESC
      LIMIT 1`,
    [memberId, timezone]
  );
  return result.rows[0] || null;
};

exports.getCurrentSubscription = getCurrentSubscription;

// --- presence percentage --------------------------------------------------

// Denominator is the days ELAPSED in the member's current subscription, minus
// the weekdays this gym is shut — not days since joining, which would count
// closed days and older memberships against them.
const attendanceSummary = async (memberId, subscription, gym) => {
  if (!subscription) return null;

  const closedWeekdays = Array.isArray(gym.closed_weekdays) ? gym.closed_weekdays : [];

  const result = await pgPool.query(
    `WITH bounds AS (
       SELECT $2::date AS start_date,
              LEAST($3::date, (now() AT TIME ZONE $4)::date) AS through_date
     )
     SELECT
       (SELECT COUNT(*)::int
          FROM gym_attendance a, bounds b
         WHERE a.member_id = $1
           AND a.visit_date BETWEEN b.start_date AND b.through_date)  AS attended_days,
       (SELECT COUNT(*)::int
          FROM bounds b,
               generate_series(b.start_date, b.through_date, interval '1 day') d
         WHERE NOT (EXTRACT(DOW FROM d)::int = ANY($5::int[])))       AS open_days
       FROM bounds`,
    [memberId, subscription.start_date, subscription.end_date, gym.timezone, closedWeekdays]
  );

  const { attended_days: attendedDays, open_days: openDays } = result.rows[0];

  return {
    attendedDays,
    openDays,
    // Null rather than 0 when the window has not started yet (a subscription
    // dated in the future), so the screen can say "not started" instead of
    // showing someone a discouraging 0%.
    percentage: openDays > 0 ? Math.min(100, Math.round((attendedDays / openDays) * 100)) : null,
    periodStart: subscription.start_date,
    periodEnd: subscription.end_date,
  };
};

exports.attendanceSummary = attendanceSummary;

const todaysVisit = async (memberId, timezone, at) => {
  const result = await pgPool.query(
    `SELECT * FROM gym_attendance
      WHERE member_id = $1
        AND visit_date = (COALESCE($2::timestamptz, now()) AT TIME ZONE $3)::date`,
    [memberId, at, timezone]
  );
  return result.rows[0] || null;
};

// --- the visit state machine ----------------------------------------------

// Insert-first, decide-second, and shared by both the member's own scan and the
// owner's manual mark so the two can never disagree about what a second tap
// means.
//
// Doing it this way round rather than SELECT-then-INSERT is what makes two
// simultaneous taps safe: the UNIQUE (member_id, visit_date) constraint lets
// exactly one win, and the loser falls through to the branches below instead of
// opening a second visit for the same day.
const recordVisit = async ({ gymId, memberId, gym, at, method, recordedBy = null }) => {
  const inserted = await pgPool.query(
    `INSERT INTO gym_attendance (id, gym_id, member_id, visit_date, check_in_at, method, recorded_by)
     VALUES ($1, $2, $3,
             (COALESCE($4::timestamptz, now()) AT TIME ZONE $5)::date,
             COALESCE($4::timestamptz, now()),
             $6, $7)
     ON CONFLICT (member_id, visit_date) DO NOTHING
     RETURNING *`,
    [genId('ATT'), gymId, memberId, at, gym.timezone, method, recordedBy]
  );

  if (inserted.rows.length > 0) {
    return { outcome: SCAN_OUTCOME.CHECKED_IN, visit: inserted.rows[0] };
  }

  const existing = await todaysVisit(memberId, gym.timezone, at);
  if (!existing) {
    // Only reachable if the row was deleted between the two statements.
    throw err(500, 'Could not record that check-in. Please try again.');
  }
  if (existing.check_out_at) {
    return { outcome: SCAN_OUTCOME.ALREADY_COMPLETE, visit: existing };
  }

  const scanAt = at || new Date();
  const heldForSeconds = (scanAt.getTime() - new Date(existing.check_in_at).getTime()) / 1000;
  if (heldForSeconds < gym.rescan_grace_seconds) {
    return {
      outcome: SCAN_OUTCOME.DUPLICATE_IGNORED,
      visit: existing,
      graceSecondsRemaining: Math.max(0, Math.ceil(gym.rescan_grace_seconds - heldForSeconds)),
    };
  }

  const closed = await pgPool.query(
    `UPDATE gym_attendance
        SET check_out_at = COALESCE($1::timestamptz, now()), updated_at = now()
      WHERE id = $2 AND check_out_at IS NULL
      RETURNING *`,
    [at, existing.id]
  );

  // Lost a race with another tap that closed it first — same end state.
  if (closed.rows.length === 0) {
    return {
      outcome: SCAN_OUTCOME.ALREADY_COMPLETE,
      visit: await todaysVisit(memberId, gym.timezone, at),
    };
  }
  return { outcome: SCAN_OUTCOME.CHECKED_OUT, visit: closed.rows[0] };
};

// --- what the check-in screen shows --------------------------------------

// Called on page load, before the member taps anything, so the button can be
// labelled correctly and the member sees their own percentage — which is the
// only reason they will keep bothering to scan, since nothing here forces them
// to.
exports.getState = async ({ gymCode, deviceToken }) => {
  const gym = await requireGymByCode(gymCode);

  const member = await resolveDevice(deviceToken, gym.id);
  if (!member) {
    // Not an error: this is a phone that has never scanned here, or one whose
    // storage was cleared. The screen asks who they are.
    return { gymName: gym.name, recognised: false };
  }

  const subscription = await getCurrentSubscription(member.id, gym.timezone);
  const visit = await todaysVisit(member.id, gym.timezone, null);

  // How much of the re-scan grace window is left on an open visit.
  //
  // Sent so the screen can disable the button and count down, instead of
  // offering "Check out" and then having the server ignore the tap. A button
  // that promises something the server will refuse is worse than no button.
  let graceSecondsRemaining = 0;
  if (visit && !visit.check_out_at) {
    const elapsed = (Date.now() - new Date(visit.check_in_at).getTime()) / 1000;
    graceSecondsRemaining = Math.max(0, Math.ceil(gym.rescan_grace_seconds - elapsed));
  }

  return {
    gymName: gym.name,
    recognised: true,
    member: publicMember(member),
    subscription: subscription && {
      planName: subscription.plan_name,
      startDate: subscription.start_date,
      endDate: subscription.end_date,
      isExpired: subscription.is_expired,
      daysRemaining: subscription.days_remaining,
    },
    today: visit && {
      visitDate: visit.visit_date,
      checkInAt: visit.check_in_at,
      checkOutAt: visit.check_out_at,
      method: visit.method,
      graceSecondsRemaining,
    },
    // What the single button should do. The server decides, never the client.
    nextAction: !visit ? 'check_in' : visit.check_out_at ? 'none' : 'check_out',
    graceSecondsRemaining,
    summary: await attendanceSummary(member.id, subscription, gym),
  };
};

exports.scan = async ({ gymCode, deviceToken, clientTime }) => {
  const gym = await requireGymByCode(gymCode);

  const member = await resolveDevice(deviceToken, gym.id);
  if (!member) {
    throw err(403, 'This device is not recognised. Please enter your mobile number to check in.');
  }

  const at = resolveScanTime(clientTime);
  const subscription = await getCurrentSubscription(member.id, gym.timezone);

  // Gate before writing anything. An expired member is told so rather than
  // silently recorded — the message IS the renewal nudge, and it keeps the
  // attendance table free of visits no subscription paid for. The owner can
  // still mark them present by hand if they let them train anyway.
  if (!subscription) {
    return { outcome: SCAN_OUTCOME.NO_SUBSCRIPTION, gymName: gym.name, member: publicMember(member) };
  }
  if (subscription.is_expired) {
    return {
      outcome: SCAN_OUTCOME.SUBSCRIPTION_EXPIRED,
      gymName: gym.name,
      member: publicMember(member),
      subscription: { planName: subscription.plan_name, endDate: subscription.end_date },
      gymPhone: gym.phone,
    };
  }

  const { outcome, visit, graceSecondsRemaining } = await recordVisit({
    gymId: gym.id,
    memberId: member.id,
    gym,
    at,
    method: 'self_scan',
  });

  return {
    outcome,
    graceSecondsRemaining: graceSecondsRemaining ?? 0,
    gymName: gym.name,
    member: publicMember(member),
    visit: visit && {
      visitDate: visit.visit_date,
      checkInAt: visit.check_in_at,
      checkOutAt: visit.check_out_at,
    },
    subscription: {
      planName: subscription.plan_name,
      endDate: subscription.end_date,
      daysRemaining: subscription.days_remaining,
    },
    summary: await attendanceSummary(member.id, subscription, gym),
  };
};

// --- owner-side attendance ------------------------------------------------

// The owner marking a member present by hand. Not a convenience: the door QR
// only works for members carrying a smartphone, so for everyone else this is
// the entire attendance path.
//
// Deliberately skips the subscription gate that scan() applies — if the owner
// has let someone train, recording that is a statement of fact, and arguing
// with them about it in software would only mean the visit goes unrecorded.
exports.markManual = async ({ gymId, memberId, recordedBy, clientTime }) => {
  const gym = await getGym(gymId);

  const memberResult = await pgPool.query(
    'SELECT * FROM gym_members WHERE id = $1 AND gym_id = $2',
    [memberId, gymId]
  );
  const member = memberResult.rows[0];
  if (!member) throw err(404, `Member '${memberId}' not found.`);

  const { outcome, visit } = await recordVisit({
    gymId,
    memberId: member.id,
    gym,
    at: resolveScanTime(clientTime),
    method: 'manual',
    recordedBy,
  });

  const subscription = await getCurrentSubscription(member.id, gym.timezone);
  return {
    outcome,
    member: publicMember(member),
    visit,
    summary: await attendanceSummary(member.id, subscription, gym),
  };
};

// Today's attendance for the owner's live list. Members still in the gym (no
// check-out yet) sort first, since those are the rows they act on.
exports.listToday = async ({ gymId }) => {
  const gym = await getGym(gymId);

  const result = await pgPool.query(
    `SELECT a.*, m.full_name, m.phone, m.member_code
       FROM gym_attendance a
       JOIN gym_members m ON m.id = a.member_id
      WHERE a.gym_id = $1
        AND a.visit_date = (now() AT TIME ZONE $2)::date
      ORDER BY (a.check_out_at IS NULL) DESC, a.check_in_at DESC`,
    [gymId, gym.timezone]
  );

  // Taken from the database in the gym's timezone rather than built in Node, so
  // the heading date always agrees with the rows underneath it.
  const todayResult = await pgPool.query('SELECT (now() AT TIME ZONE $1)::date AS today', [
    gym.timezone,
  ]);

  return {
    visitDate: todayResult.rows[0].today,
    present: result.rows.filter((r) => !r.check_out_at).length,
    total: result.rows.length,
    visits: result.rows,
  };
};

// One member's attendance history plus their percentage — the member detail
// screen in the owner's console.
exports.memberHistory = async ({ gymId, memberId, limit = 60 }) => {
  const gym = await getGym(gymId);

  const memberResult = await pgPool.query(
    'SELECT * FROM gym_members WHERE id = $1 AND gym_id = $2',
    [memberId, gymId]
  );
  const member = memberResult.rows[0];
  if (!member) throw err(404, `Member '${memberId}' not found.`);

  const visits = await pgPool.query(
    `SELECT * FROM gym_attendance
      WHERE member_id = $1
      ORDER BY visit_date DESC
      LIMIT $2`,
    [memberId, limit]
  );

  const subscription = await getCurrentSubscription(memberId, gym.timezone);
  return {
    member,
    subscription,
    summary: await attendanceSummary(memberId, subscription, gym),
    visits: visits.rows,
  };
};

// The owner's own devices list for a member, so a lost phone can be spotted and
// revoked (revocation itself lives in gymService.revokeMemberDevices).
exports.listMemberDevices = async ({ gymId, memberId }) => {
  const result = await pgPool.query(
    `SELECT id, device_label, revoked, created_at, last_used_at
       FROM gym_device_tokens
      WHERE member_id = $1 AND gym_id = $2
      ORDER BY created_at DESC`,
    [memberId, gymId]
  );
  return result.rows;
};
