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
  platformAdminOnly,
} = require('../middleware/gymAuthMiddleware');

const checkin = require('../controllers/gymCheckinController');
const webhooks = require('../controllers/gymWebhookController');
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
router.get('/auth/me', requireGymAccount, auth.me);
router.post('/auth/change-password', requireGymAccount, auth.changePassword);

// ---------------------------------------------------------------------------
// Owner console — one gym, always tenancy-checked
// ---------------------------------------------------------------------------
router.get('/gyms/:gymId', gymStaffOnly, gym.getGym);
router.put('/gyms/:gymId', gymStaffOnly, gym.updateGym);
router.post('/gyms/:gymId/regenerate-code', gymStaffOnly, gym.regenerateGymCode);
router.get('/gyms/:gymId/staff', gymStaffOnly, gym.listStaff);

router.get('/gyms/:gymId/dashboard', gymStaffOnly, gym.dashboard);
router.get('/gyms/:gymId/expiring', gymStaffOnly, gym.expiryWatchlist);

router.get('/gyms/:gymId/plans', gymStaffOnly, gym.listPlans);
router.post('/gyms/:gymId/plans', gymStaffOnly, gym.createPlan);
router.patch('/gyms/:gymId/plans/:planId/active', gymStaffOnly, gym.setPlanActive);

router.get('/gyms/:gymId/members', gymStaffOnly, gym.listMembers);
router.post('/gyms/:gymId/members', gymStaffOnly, gym.createMember);
router.get('/gyms/:gymId/members/:memberId', gymStaffOnly, gym.getMember);
router.put('/gyms/:gymId/members/:memberId', gymStaffOnly, gym.updateMember);
router.post('/gyms/:gymId/members/:memberId/revoke-devices', gymStaffOnly, gym.revokeMemberDevices);
router.post('/gyms/:gymId/members/:memberId/subscriptions', gymStaffOnly, gym.createSubscription);

router.get('/gyms/:gymId/payment-provider', gymStaffOnly, gym.getPaymentProvider);
router.put('/gyms/:gymId/payment-provider', gymStaffOnly, gym.savePaymentProvider);
router.post('/gyms/:gymId/payments/reconcile', gymStaffOnly, gym.reconcilePayments);

router.get('/gyms/:gymId/payments', gymStaffOnly, gym.listPayments);
router.post('/gyms/:gymId/payments/:paymentId/settle', gymStaffOnly, gym.settlePayment);

router.get('/gyms/:gymId/attendance/today', gymStaffOnly, gym.attendanceToday);
router.post('/gyms/:gymId/attendance/manual', gymStaffOnly, gym.markManual);

// ---------------------------------------------------------------------------
// Platform operator
// ---------------------------------------------------------------------------
router.get('/admin/gyms', platformAdminOnly, auth.listGyms);
router.post('/admin/gyms', platformAdminOnly, auth.createGym);
router.post('/admin/accounts', platformAdminOnly, auth.createAccount);
router.post('/admin/gyms/:gymId/staff', platformAdminOnly, auth.addStaff);
router.delete('/admin/gyms/:gymId/staff/:accountId', platformAdminOnly, auth.removeStaff);

module.exports = router;
