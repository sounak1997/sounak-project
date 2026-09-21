// src/controllers/gymCheckinController.js
//
// The PUBLIC half of the gym portal: the door check-in flow. No login, no JWT —
// see gymAttendanceService.js for why, and src/db/schema_gym.sql
// (gym_device_tokens) for what the device token can and cannot do.
//
// Everything here is reachable by anyone who can read a gym's printed QR, so
// each handler takes the gym code and hands it to the service, which refuses
// anything it does not recognise before touching a member record.
const asyncHandler = require('express-async-handler');
const gymAttendanceService = require('../services/gymAttendanceService');
const gymCheckoutService = require('../services/gymCheckoutService');
const gymGatewayService = require('../services/gymGatewayService');
const pgPool = require('../config/pg.config');

// @desc    What the check-in screen should show on load
// @route   GET /api/gym/checkin/state?g=<gymCode>&deviceToken=<token>
// @access  Public
//
// The device token arrives as a query parameter rather than a header because
// this is the first call the page makes and it is a plain GET — but that also
// means it can land in access logs, which is one more reason the token grants
// nothing beyond attendance for its own member.
exports.getState = asyncHandler(async (req, res) => {
  const state = await gymAttendanceService.getState({
    gymCode: req.query.g,
    deviceToken: req.query.deviceToken,
  });
  res.status(200).json({ success: true, data: state });
});

// @desc    Find a member by phone number or name, on this gym's list
// @route   POST /api/gym/checkin/search   Body: { gymCode, query }
// @access  Public (rate limited — this is the member-enumeration surface)
exports.search = asyncHandler(async (req, res) => {
  const result = await gymAttendanceService.search({
    gymCode: req.body.gymCode,
    query: req.body.query,
  });
  res.status(200).json({ success: true, data: result });
});

// @desc    Bind this phone to a member, so later scans are one tap
// @route   POST /api/gym/checkin/claim   Body: { gymCode, memberId, verify }
// @access  Public (verified by the last 4 digits of the member's mobile)
exports.claim = asyncHandler(async (req, res) => {
  const result = await gymAttendanceService.claim({
    gymCode: req.body.gymCode,
    memberId: req.body.memberId,
    verify: req.body.verify,
    userAgent: req.headers['user-agent'],
  });
  res.status(201).json({ success: true, data: result });
});

// @desc    Mark the visit — check in, or check out. The SERVER decides which.
// @route   POST /api/gym/checkin   Body: { gymCode, deviceToken, clientTime }
// @access  Public (device token)
//
// `clientTime` is the browser's own clock, so a tap recorded while Render wakes
// from sleep still shows the time the member actually tapped. The service
// ignores it when it disagrees with the server by more than a few minutes.
exports.scan = asyncHandler(async (req, res) => {
  const result = await gymAttendanceService.scan({
    gymCode: req.body.gymCode,
    deviceToken: req.body.deviceToken,
    clientTime: req.body.clientTime,
  });
  res.status(200).json({ success: true, data: result });
});

// ---------------------------------------------------------------------------
// ONLINE RENEWAL — the member pays by UPI on their own phone.
//
// Still public, still no login: the member is identified by the same device
// token the door flow uses. That token's reach stays narrow — it can start a
// payment for ITS OWN membership and read that payment's status, and nothing
// else. It cannot read payment history, other members, or another gym.
// ---------------------------------------------------------------------------
// Resolves gym + member from the scanned code and the device token. Every
// payment endpoint below starts here, so a caller can only ever act on the
// membership their own phone is bound to.
const requireMemberDevice = async (req) => {
  const gymCode = req.body.gymCode || req.query.g;
  const deviceToken = req.body.deviceToken || req.query.deviceToken;
  const gym = await gymAttendanceService.requireGymByCode(gymCode);
  const member = await gymAttendanceService.resolveDevice(deviceToken, gym.id);
  if (!member) {
    const err = new Error('This device is not recognised. Please enter your mobile number first.');
    err.statusCode = 403;
    throw err;
  }
  return { gym, member };
};

// @desc    Plans this gym sells, so a member can choose one to renew with
// @route   GET /api/gym/checkin/plans?g=<gymCode>
// @access  Public — prices are on a board in the gym, not a secret
// @desc    Member picks a plan and pays by scanning the gym's UPI QR
// @route   POST /api/gym/checkin/pay/qr
//          Body: { gymCode, deviceToken, planId }
// @access  Device token — the same proof startPayment requires
//
// The no-gateway path, and for these gyms the normal one. Nothing here confirms
// money: it books the membership as pending and raises a payment the desk can
// see, so the member scans the QR, pays, shows their UPI receipt, and staff tap
// 'Paid UPI'. Status is 'pending_verification' precisely because a member's word
// is a claim, not a confirmation — only somebody who can see the gym's account
// turns it into money.
//
// The member comes from the device token, never from the body: a memberId a
// caller could choose would let anyone run up a claim against somebody else's
// membership.
exports.payByQr = asyncHandler(async (req, res) => {
  const { gym, member } = await requireMemberDevice(req);
  const started = await gymCheckoutService.startQrClaim({
    gym,
    memberId: member.id,
    planId: req.body.planId,
  });
  res.status(201).json({
    success: true,
    data: {
      paymentId: started.paymentId,
      amount: started.amount,
      planName: started.planName,
      // Short, readable, and printed on the screen: what the member reads out so
      // the desk can match the right row.
      reference: started.reference,
      paymentQrUrl: gym.payment_qr_url || null,
    },
  });
});

exports.plans = asyncHandler(async (req, res) => {
  const gym = await gymAttendanceService.requireGymByCode(req.query.g);
  const plans = await pgPool.query(
    `SELECT id, name, duration_days, price, description
       FROM gym_plans WHERE gym_id = $1 AND active = true
      ORDER BY duration_days ASC`,
    [gym.id]
  );
  const provider = await gymGatewayService.getProviderPublic(gym.id);
  res.status(200).json({
    success: true,
    data: {
      gymName: gym.name,
      plans: plans.rows,
      // Lets the screen offer "pay at the desk" instead of a dead button when
      // the gym has not connected a gateway.
      onlinePaymentAvailable: !!(provider && provider.enabled),
      // The gym's own UPI QR, displayed on the door screen so a member can pay
      // without any gateway at all: they scan, pay, and show the desk. Public by
      // nature — it is the same code the gym would tape to the counter.
      paymentQrUrl: gym.payment_qr_url || null,
    },
  });
});

// @desc    Start a UPI payment — returns what the browser needs to open Checkout
// @route   POST /api/gym/checkin/pay/start   Body: { gymCode, deviceToken, planId }
// @access  Device token
exports.startPayment = asyncHandler(async (req, res) => {
  const { gym, member } = await requireMemberDevice(req);
  const result = await gymCheckoutService.startRenewal({
    gym,
    memberId: member.id,
    planId: req.body.planId,
  });
  res.status(201).json({ success: true, data: result });
});

// @desc    Confirm from the browser's signed receipt — the FAST path
// @route   POST /api/gym/checkin/pay/confirm
// @access  Device token + gateway signature
//
// The signature is what makes this safe to expose: it is computed with the
// gym's key secret, which never reaches the browser, so a client cannot claim
// "paid" by calling this directly.
exports.confirmPayment = asyncHandler(async (req, res) => {
  const { gym } = await requireMemberDevice(req);
  const result = await gymCheckoutService.confirmFromCheckout({
    gym,
    paymentId: req.body.paymentId,
    orderId: req.body.orderId,
    gatewayPaymentId: req.body.gatewayPaymentId,
    signature: req.body.signature,
  });
  res.status(200).json({ success: true, data: result });
});

// @desc    Poll a payment's status, reconciling against the gateway first
// @route   GET /api/gym/checkin/pay/status?g=&deviceToken=&paymentId=
// @access  Device token
//
// This is the path that saves the member when the browser callback was lost AND
// the webhook could not be delivered because the free-tier backend was asleep.
// It asks the gateway directly rather than trusting local state.
exports.paymentStatus = asyncHandler(async (req, res) => {
  const { gym } = await requireMemberDevice(req);
  const paymentId = req.query.paymentId;

  const before = await gymCheckoutService.getPaymentStatus({ gymId: gym.id, paymentId });
  if (before.status === 'pending') {
    await gymCheckoutService.reconcile({ gymId: gym.id, paymentId });
  }

  const after = await gymCheckoutService.getPaymentStatus({ gymId: gym.id, paymentId });
  res.status(200).json({ success: true, data: after });
});
