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
