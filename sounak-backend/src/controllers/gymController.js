// src/controllers/gymController.js
//
// The owner's console for ONE gym. Every route reaching this file has already
// passed requireGymAccess, so `req.gym` is a gym this account may administer —
// which is why each handler passes `req.gym.id` rather than anything from the
// request body. Taking the gym from the body would let an owner aim a write at
// someone else's gym.
const asyncHandler = require('express-async-handler');
const gymService = require('../services/gymService');
const gymAttendanceService = require('../services/gymAttendanceService');
const gymAuthService = require('../services/gymAuthService');

// --- this gym --------------------------------------------------------------

// @desc    This gym's settings, plus the check-in URL to print on the poster
// @route   GET /api/gym/gyms/:gymId
exports.getGym = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: { gym: req.gym, staffRole: req.staffRole },
  });
});

// @desc    Update this gym's settings
// @route   PUT /api/gym/gyms/:gymId
exports.updateGym = asyncHandler(async (req, res) => {
  const gym = await gymService.updateGym({
    gymId: req.gym.id,
    name: req.body.name,
    address: req.body.address,
    phone: req.body.phone,
    timezone: req.body.timezone,
    closedWeekdays: req.body.closedWeekdays,
    rescanGraceSeconds: req.body.rescanGraceSeconds,
    paymentQrUrl: req.body.paymentQrUrl,
  });
  res.status(200).json({ success: true, data: gym });
});

// @desc    Reissue the door code — every printed poster stops working
// @route   POST /api/gym/gyms/:gymId/regenerate-code
exports.regenerateGymCode = asyncHandler(async (req, res) => {
  const gym = await gymService.regenerateGymCode(req.gym.id);
  res.status(200).json({ success: true, data: gym });
});

// @desc    Who may administer this gym
// @route   GET /api/gym/gyms/:gymId/staff
exports.listStaff = asyncHandler(async (req, res) => {
  const staff = await gymAuthService.listStaff(req.gym.id);
  res.status(200).json({ success: true, count: staff.length, data: staff });
});

// --- plans -----------------------------------------------------------------

// @route   GET /api/gym/gyms/:gymId/plans?includeInactive=
exports.listPlans = asyncHandler(async (req, res) => {
  const plans = await gymService.listPlans({
    gymId: req.gym.id,
    includeInactive: req.query.includeInactive === 'true',
  });
  res.status(200).json({ success: true, count: plans.length, data: plans });
});

// @route   POST /api/gym/gyms/:gymId/plans
exports.createPlan = asyncHandler(async (req, res) => {
  const plan = await gymService.createPlan({
    gymId: req.gym.id,
    name: req.body.name,
    durationDays: req.body.durationDays,
    price: req.body.price,
    description: req.body.description,
  });
  res.status(201).json({ success: true, data: plan });
});

// @route   PATCH /api/gym/gyms/:gymId/plans/:planId/active
exports.setPlanActive = asyncHandler(async (req, res) => {
  if (typeof req.body.active !== 'boolean') {
    res.status(400);
    throw new Error('active (boolean) is required.');
  }
  const plan = await gymService.setPlanActive({
    gymId: req.gym.id,
    planId: req.params.planId,
    active: req.body.active,
  });
  res.status(200).json({ success: true, data: plan });
});

// --- members ---------------------------------------------------------------

// @desc    Member list with each member's derived expiry state
// @route   GET /api/gym/gyms/:gymId/members?search=&status=&expiry=&expiringWithinDays=
exports.listMembers = asyncHandler(async (req, res) => {
  const members = await gymService.listMembers({
    gymId: req.gym.id,
    search: req.query.search,
    status: req.query.status,
    expiry: req.query.expiry,
    expiringWithinDays: Number(req.query.expiringWithinDays) || 7,
    limit: Math.min(Number(req.query.limit) || 200, 500),
    offset: Number(req.query.offset) || 0,
  });
  res.status(200).json({ success: true, count: members.length, data: members });
});

// @desc    Register an athlete — name and phone are all that is needed
// @route   POST /api/gym/gyms/:gymId/members
exports.createMember = asyncHandler(async (req, res) => {
  const result = await gymService.createMember({
    gymId: req.gym.id,
    fullName: req.body.fullName,
    phone: req.body.phone,
    emergencyContact: req.body.emergencyContact,
    notes: req.body.notes,
    joinedOn: req.body.joinedOn,
  });
  res.status(201).json({ success: true, data: result });
});

// @route   GET /api/gym/gyms/:gymId/members/:memberId
exports.getMember = asyncHandler(async (req, res) => {
  const [history, payments, devices] = await Promise.all([
    gymAttendanceService.memberHistory({ gymId: req.gym.id, memberId: req.params.memberId }),
    gymService.listMemberPayments({ gymId: req.gym.id, memberId: req.params.memberId }),
    gymAttendanceService.listMemberDevices({ gymId: req.gym.id, memberId: req.params.memberId }),
  ]);
  res.status(200).json({ success: true, data: { ...history, payments, devices } });
});

// @route   PUT /api/gym/gyms/:gymId/members/:memberId
exports.updateMember = asyncHandler(async (req, res) => {
  const member = await gymService.updateMember({
    gymId: req.gym.id,
    memberId: req.params.memberId,
    fullName: req.body.fullName,
    phone: req.body.phone,
    emergencyContact: req.body.emergencyContact,
    notes: req.body.notes,
    status: req.body.status,
  });
  res.status(200).json({ success: true, data: member });
});

// @desc    Un-remember every phone bound to this member (lost/replaced handset)
// @route   POST /api/gym/gyms/:gymId/members/:memberId/revoke-devices
exports.revokeMemberDevices = asyncHandler(async (req, res) => {
  const result = await gymService.revokeMemberDevices({
    gymId: req.gym.id,
    memberId: req.params.memberId,
  });
  res.status(200).json({ success: true, data: result });
});

// --- subscriptions + payments ---------------------------------------------

// @desc    Assign or renew a plan, recording how it was paid for
// @route   POST /api/gym/gyms/:gymId/members/:memberId/subscriptions
//          Body: { planId, startDate?, amount?, payment?: { method, status?, reference?, amount? } }
exports.createSubscription = asyncHandler(async (req, res) => {
  const result = await gymService.createSubscription({
    gymId: req.gym.id,
    memberId: req.params.memberId,
    planId: req.body.planId,
    startDate: req.body.startDate,
    amount: req.body.amount,
    payment: req.body.payment,
    recordedBy: req.gymAccount.id,
  });
  res.status(201).json({ success: true, data: result });
});

// @desc    Cash taken at the desk, or a QR payment the owner has confirmed
// @route   POST /api/gym/gyms/:gymId/payments/:paymentId/settle
//          Body: { status: 'collected' | 'verified', reference? }
exports.settlePayment = asyncHandler(async (req, res) => {
  const payment = await gymService.settlePayment({
    gymId: req.gym.id,
    paymentId: req.params.paymentId,
    status: req.body.status,
    reference: req.body.reference,
    recordedBy: req.gymAccount.id,
  });
  res.status(200).json({ success: true, data: payment });
});

// @route   GET /api/gym/gyms/:gymId/payments?status=
exports.listPayments = asyncHandler(async (req, res) => {
  const payments = await gymService.listPayments({ gymId: req.gym.id, status: req.query.status });
  res.status(200).json({ success: true, count: payments.length, data: payments });
});

// --- attendance (owner side) ----------------------------------------------

// @route   GET /api/gym/gyms/:gymId/attendance/today
exports.attendanceToday = asyncHandler(async (req, res) => {
  const today = await gymAttendanceService.listToday({ gymId: req.gym.id });
  res.status(200).json({ success: true, data: today });
});

// @desc    Mark a member present by hand — the path for members with no phone
// @route   POST /api/gym/gyms/:gymId/attendance/manual   Body: { memberId }
exports.markManual = asyncHandler(async (req, res) => {
  if (!req.body.memberId) {
    res.status(400);
    throw new Error('memberId is required.');
  }
  const result = await gymAttendanceService.markManual({
    gymId: req.gym.id,
    memberId: req.body.memberId,
    recordedBy: req.gymAccount.id,
    clientTime: req.body.clientTime,
  });
  res.status(200).json({ success: true, data: result });
});

// --- dashboard -------------------------------------------------------------

// @route   GET /api/gym/gyms/:gymId/dashboard
//
// The response is narrower for staff: no takings, no payments-to-confirm count.
// staffRole rides along so the console can lay the screen out to match instead
// of rendering an empty tile.
exports.dashboard = asyncHandler(async (req, res) => {
  const summary = await gymService.dashboardSummary({
    gymId: req.gym.id,
    includeFinancials: req.staffRole !== 'staff',
  });
  res.status(200).json({ success: true, data: { ...summary, staffRole: req.staffRole } });
});

// @desc    The renewal worklist: lapsed, about to lapse, never started
// @route   GET /api/gym/gyms/:gymId/expiring?withinDays=7
exports.expiryWatchlist = asyncHandler(async (req, res) => {
  const watchlist = await gymService.expiryWatchlist({
    gymId: req.gym.id,
    withinDays: Number(req.query.withinDays) || 7,
  });
  res.status(200).json({ success: true, data: watchlist });
});

// --- online payment setup (owner) -----------------------------------------

const gymGatewayService = require('../services/gymGatewayService');
const gymCheckoutService = require('../services/gymCheckoutService');

// @desc    Is online payment connected, and with which key
// @route   GET /api/gym/gyms/:gymId/payment-provider
//
// Never returns the secrets. Once stored they have no reason to travel back out
// of the server.
exports.getPaymentProvider = asyncHandler(async (req, res) => {
  const provider = await gymGatewayService.getProviderPublic(req.gym.id);

  // Prefer a configured public URL over the request's host. Derived from the
  // request, this reads "http://localhost:3000/..." in development — which a
  // gateway can never reach, and which an owner would paste into Razorpay in
  // good faith and then wonder why nothing arrived.
  const base = process.env.GYM_PUBLIC_API_URL
    || `${req.protocol}://${req.get('host')}`;
  const webhookUrl = `${base.replace(/\/$/, '')}/api/gym/webhooks/razorpay`;

  res.status(200).json({
    success: true,
    data: {
      provider,
      webhookUrl,
      // Lets the screen warn instead of handing over a URL that cannot work.
      webhookReachable: !/localhost|127\.0\.0\.1/.test(webhookUrl),
    },
  });
});

// @desc    Check the saved keys actually work, before a member relies on them
// @route   POST /api/gym/gyms/:gymId/payment-provider/test
exports.testPaymentProvider = asyncHandler(async (req, res) => {
  const result = await gymGatewayService.testConnection(req.gym.id);
  res.status(200).json({ success: true, data: result });
});

// @desc    Connect or update this gym's gateway account
// @route   PUT /api/gym/gyms/:gymId/payment-provider
//
// The keys belong to the gym owner's own Razorpay account, so their money
// settles directly to their bank. The platform never holds it.
exports.savePaymentProvider = asyncHandler(async (req, res) => {
  const provider = await gymGatewayService.saveProvider({
    gymId: req.gym.id,
    keyId: req.body.keyId,
    keySecret: req.body.keySecret,
    webhookSecret: req.body.webhookSecret,
    enabled: req.body.enabled,
    updatedBy: req.gymAccount.id,
  });
  res.status(200).json({ success: true, data: provider });
});

// @desc    Ask the gateway about anything still pending and settle what paid
// @route   POST /api/gym/gyms/:gymId/payments/reconcile
//
// Called when the owner opens their payments screen. Catches the payments whose
// webhook never arrived — which on a free-tier backend that sleeps is a matter
// of when, not if.
exports.reconcilePayments = asyncHandler(async (req, res) => {
  const result = await gymCheckoutService.reconcile({ gymId: req.gym.id });
  res.status(200).json({ success: true, data: result });
});

// @desc    Owner resets one of their members' passwords
// @route   POST /api/gym/gyms/:gymId/members/:memberId/reset-password
//
// The fallback for a member who has lost their member code too — the only route
// that needs the member to remember nothing at all.
exports.resetMemberPassword = asyncHandler(async (req, res) => {
  const gymMemberAccountService = require('../services/gymMemberAccountService');
  const result = await gymMemberAccountService.resetPasswordByOwner({
    gymId: req.gym.id,
    memberId: req.params.memberId,
    newPassword: req.body.newPassword,
  });
  res.status(200).json({ success: true, data: result });
});
