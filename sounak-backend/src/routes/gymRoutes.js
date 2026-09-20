// src/routes/gymRoutes.js
//
// Every gym route, mounted at /api/gym. Three clearly separated tiers, and the
// separation is the security model rather than tidiness:
//
//   /checkin/*            PUBLIC. No login. Anyone who can read a gym's printed
//                         QR reaches these. Identified by a device token that
//                         grants attendance for one member at one gym, nothing
//                         more.
//   /auth/*               Gym owner/staff sign-in. Its own accounts table — not
//                         the Mongo users the grocery/doctors portals use.
//   /gyms/:gymId/*        Owner console. ALWAYS behind gymStaffOnly, so the
//                         tenancy check cannot be forgotten: with ~100 gyms
//                         sharing these tables, an unscoped route hands one
//                         owner another's members, and it fails silently.
//   /admin/*              Platform operator: creates gyms, issues owner
//                         accounts. A gym owner must never reach these.
//
// :gymId is in the PATH on purpose. A gym taken from a request body would be
// invisible in this file, and "is this route scoped?" has to be answerable by
// reading the route table.
const express = require('express');
const router = express.Router();

const { gymCheckinLimiter, gymIdentifyLimiter } = require('../middleware/rateLimiter');
const {
  requireGymAccount,
  gymStaffOnly,
  gymOwnerOnly,
  platformAdminOnly,
} = require('../middleware/gymAuthMiddleware');

const checkin = require('../controllers/gymCheckinController');
const webhooks = require('../controllers/gymWebhookController');
const member = require('../controllers/gymMemberController');
const auth = require('../controllers/gymAuthController');
const gym = require('../controllers/gymController');

// ---------------------------------------------------------------------------
// PUBLIC — the door check-in flow
// ---------------------------------------------------------------------------
// gymCheckinLimiter is generous (and the global apiLimiter skips these paths)
// because every member of one gym shares that gym's public IP: per-IP counting
// sees a whole membership as a single client. See rateLimiter.js.
router.get('/checkin/state', gymCheckinLimiter, checkin.getState);
router.post('/checkin', gymCheckinLimiter, checkin.scan);

// Tighter: this is the one endpoint that turns a phone number or name into a
// member's identity, so it is the enumeration surface.
router.post('/checkin/search', gymIdentifyLimiter, checkin.search);
router.post('/checkin/claim', gymIdentifyLimiter, checkin.claim);

// Online renewal by UPI. Public in the same sense as the rest of /checkin: no
// login, the member identified by their device token. That token can start a
// payment for its OWN membership and read that payment's status — nothing else.
router.get('/checkin/plans', gymCheckinLimiter, checkin.plans);
router.post('/checkin/pay/start', gymCheckinLimiter, checkin.startPayment);
router.post('/checkin/pay/confirm', gymCheckinLimiter, checkin.confirmPayment);
router.get('/checkin/pay/status', gymCheckinLimiter, checkin.paymentStatus);

// OPTIONAL member login. Signing up needs no password and no OTP because the
// device has already been verified at the door — see gymMemberAccountService.
// Nothing here is required to check in; scanning remains login-free.
router.get('/checkin/account/state', gymCheckinLimiter, member.deviceAccountState);
router.post('/checkin/account', gymIdentifyLimiter, member.signUp);

// ---------------------------------------------------------------------------
// GATEWAY WEBHOOK
// ---------------------------------------------------------------------------
// No auth middleware, deliberately: a payment gateway cannot sign in. It is
// authenticated by an HMAC signature over the RAW body, which is why server.js
// mounts express.raw() for this path ahead of express.json().
//
// Not rate limited either — throttling a gateway's retries would drop payment
// confirmations, and the signature check is what keeps it safe.
router.post('/webhooks/razorpay', webhooks.razorpay);

// ---------------------------------------------------------------------------
// Gym owner / staff authentication
// ---------------------------------------------------------------------------
router.post('/auth/login', auth.login);

// Standalone member sign-up, for someone not standing at the gym. Rate limited
// with the identify limiter because a member code is a guessing surface.
router.post('/auth/signup', gymIdentifyLimiter, member.signUpWithCode);

// Password reset by member code + mobile — the same proof sign-up uses, and
// rate limited for the same reason.
router.post('/auth/reset-password', gymIdentifyLimiter, member.resetPassword);
router.get('/auth/me', requireGymAccount, auth.me);
router.post('/auth/change-password', requireGymAccount, auth.changePassword);

// ---------------------------------------------------------------------------
// A signed-in member's OWN record
// ---------------------------------------------------------------------------
// requireGymAccount only, never requireGymAccess: a member is not staff of the
// gym they train at. Scoping is by gym_members.account_id inside the service,
// so these return the caller's own record and 404 for anyone else's.
router.post('/me/bind-device', requireGymAccount, member.bindDevice);
router.get('/me/memberships', requireGymAccount, member.myMemberships);
router.get('/me/memberships/:memberId', requireGymAccount, member.myMembership);

// ---------------------------------------------------------------------------
// Owner console — one gym, always tenancy-checked
//
// Two chains here, and which one a route gets is the whole owner/staff split:
//
//   gymStaffOnly  the front desk's work — run the gym, serve the members
//   gymOwnerOnly  the takings, the prices, and the payout credentials
//
// The dividing line is totals and settings, not payments as such: staff DO
// record a renewal and the cash that came with it (createSubscription below),
// because that is the desk taking a membership. What they cannot do is read
// what the gym has earned, re-price a plan, or touch the gateway keys.
// ---------------------------------------------------------------------------
router.get('/gyms/:gymId', gymStaffOnly, gym.getGym);
router.put('/gyms/:gymId', gymOwnerOnly, gym.updateGym);
router.post('/gyms/:gymId/regenerate-code', gymOwnerOnly, gym.regenerateGymCode);
router.get('/gyms/:gymId/staff', gymOwnerOnly, gym.listStaff);

// Staff get this too, but the response drops the money fields — see
// gymController.dashboard.
router.get('/gyms/:gymId/dashboard', gymStaffOnly, gym.dashboard);
// Who has lapsed and who is about to: the desk's chase list, deliberately open
// to staff.
router.get('/gyms/:gymId/expiring', gymStaffOnly, gym.expiryWatchlist);

// Reading plans is needed to sell one; creating and re-pricing them is not.
router.get('/gyms/:gymId/plans', gymStaffOnly, gym.listPlans);
router.post('/gyms/:gymId/plans', gymOwnerOnly, gym.createPlan);
router.patch('/gyms/:gymId/plans/:planId/active', gymOwnerOnly, gym.setPlanActive);

router.get('/gyms/:gymId/members', gymStaffOnly, gym.listMembers);
router.post('/gyms/:gymId/members', gymStaffOnly, gym.createMember);
router.get('/gyms/:gymId/members/:memberId', gymStaffOnly, gym.getMember);
router.put('/gyms/:gymId/members/:memberId', gymStaffOnly, gym.updateMember);
router.post('/gyms/:gymId/members/:memberId/revoke-devices', gymStaffOnly, gym.revokeMemberDevices);
router.post('/gyms/:gymId/members/:memberId/reset-password', gymStaffOnly, gym.resetMemberPassword);
// Selling or renewing a membership, cash included. The desk's core job.
router.post('/gyms/:gymId/members/:memberId/subscriptions', gymStaffOnly, gym.createSubscription);

// Payout credentials — the owner's bank, effectively.
router.get('/gyms/:gymId/payment-provider', gymOwnerOnly, gym.getPaymentProvider);
router.put('/gyms/:gymId/payment-provider', gymOwnerOnly, gym.savePaymentProvider);
router.post('/gyms/:gymId/payment-provider/test', gymOwnerOnly, gym.testPaymentProvider);
router.post('/gyms/:gymId/payments/reconcile', gymOwnerOnly, gym.reconcilePayments);

// The ledger, and confirming money said to have arrived. Owner's books.
router.get('/gyms/:gymId/payments', gymOwnerOnly, gym.listPayments);
router.post('/gyms/:gymId/payments/:paymentId/settle', gymOwnerOnly, gym.settlePayment);

router.get('/gyms/:gymId/attendance/today', gymStaffOnly, gym.attendanceToday);
router.post('/gyms/:gymId/attendance/manual', gymStaffOnly, gym.markManual);

// ---------------------------------------------------------------------------
// Platform operator
// ---------------------------------------------------------------------------
router.get('/admin/gyms', platformAdminOnly, auth.listGyms);
router.post('/admin/gyms', platformAdminOnly, auth.createGym);
// Suspending a gym is how a gym that has stopped working with the platform is
// switched off: its door QR and its owner's console both stop, while every
// member and payment row is kept.
router.patch('/admin/gyms/:gymId/status', platformAdminOnly, auth.setGymStatus);
router.post('/admin/accounts', platformAdminOnly, auth.createAccount);
router.get('/admin/accounts', platformAdminOnly, auth.listAccounts);
// The only way back in for a locked-out gym owner: staff hold no member code,
// so the self-service reset cannot reach them.
router.post('/admin/accounts/:accountId/reset-password', platformAdminOnly, auth.resetAccountPassword);
router.post('/admin/gyms/:gymId/staff', platformAdminOnly, auth.addStaff);
router.delete('/admin/gyms/:gymId/staff/:accountId', platformAdminOnly, auth.removeStaff);

module.exports = router;
