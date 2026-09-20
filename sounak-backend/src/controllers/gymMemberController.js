// src/controllers/gymMemberController.js
//
// The member's own side: optionally creating a login, and then reading their
// own record. Distinct from gymController.js, which is the OWNER's console —
// a member signing in must never land anywhere near another member's data, so
// the two never share a handler.
const asyncHandler = require('express-async-handler');
const gymMemberAccountService = require('../services/gymMemberAccountService');
const gymAuthService = require('../services/gymAuthService');

// @desc    Can this device offer "set up online access"?
// @route   GET /api/gym/checkin/account/state?g=&deviceToken=
// @access  Public (device token)
exports.deviceAccountState = asyncHandler(async (req, res) => {
  const state = await gymMemberAccountService.deviceAccountState({
    gymCode: req.query.g,
    deviceToken: req.query.deviceToken,
  });
  res.status(200).json({ success: true, data: state });
});

// @desc    Create a login for an already-recognised member
// @route   POST /api/gym/checkin/account   Body: { gymCode, deviceToken, email, password, name }
// @access  Public (device token is the proof — see gymMemberAccountService)
exports.signUp = asyncHandler(async (req, res) => {
  const result = await gymMemberAccountService.signUp({
    gymCode: req.body.gymCode,
    deviceToken: req.body.deviceToken,
    email: req.body.email,
    password: req.body.password,
    name: req.body.name,
  });
  res.status(201).json({ success: true, data: result });
});

// @desc    My memberships across every gym on the platform
// @route   GET /api/gym/me/memberships
// @access  Signed-in account
exports.myMemberships = asyncHandler(async (req, res) => {
  const memberships = await gymAuthService.accessibleMemberships(req.gymAccount);
  res.status(200).json({ success: true, count: memberships.length, data: memberships });
});

// @desc    One of my memberships in full: plan, percentage, visits, payments
// @route   GET /api/gym/me/memberships/:memberId
// @access  Signed-in account, scoped to their OWN membership
exports.myMembership = asyncHandler(async (req, res) => {
  const overview = await gymMemberAccountService.memberOverview({
    account: req.gymAccount,
    memberId: req.params.memberId,
  });
  res.status(200).json({ success: true, data: overview });
});

// @desc    Sign up from anywhere, using the member code the gym issued
// @route   POST /api/gym/auth/signup
// @access  Public (rate limited — member codes are a guessing surface)
//
// Signs the member straight in afterwards. Making someone type the password
// they just chose into a second form would be friction for no security.
exports.signUpWithCode = asyncHandler(async (req, res) => {
  const result = await gymMemberAccountService.signUpWithCode({
    memberCode: req.body.memberCode,
    phone: req.body.phone,
    email: req.body.email,
    password: req.body.password,
    name: req.body.name,
  });
  // Sign in with whichever identifier they actually gave us.
  const session = await gymAuthService.login({
    identifier: result.signInWith,
    password: req.body.password,
  });
  res.status(201).json({ success: true, data: { ...session, gymName: result.gymName } });
});

// @desc    Recognise this browser at the door using my signed-in session
// @route   POST /api/gym/me/bind-device   Body: { gymCode }
// @access  Signed-in account
//
// Outside /checkin on purpose: this one IS authenticated, whereas everything
// under /checkin is deliberately not, and the client's interceptor decides
// whether to send the token by looking at the path.
exports.bindDevice = asyncHandler(async (req, res) => {
  const result = await gymMemberAccountService.bindDeviceFromSession({
    account: req.gymAccount,
    gymCode: req.body.gymCode,
    userAgent: req.headers['user-agent'],
  });
  res.status(201).json({ success: true, data: result });
});

// @desc    Reset my password using my member code + mobile
// @route   POST /api/gym/auth/reset-password
// @access  Public (rate limited — same enumeration surface as sign-up)
//
// Signs them in afterwards: they have just proved who they are and chosen a
// password, so bouncing them to a login form would be a step for nothing.
exports.resetPassword = asyncHandler(async (req, res) => {
  const result = await gymMemberAccountService.resetPasswordWithCode({
    memberCode: req.body.memberCode,
    phone: req.body.phone,
    newPassword: req.body.newPassword,
  });
  const session = await gymAuthService.login({
    identifier: result.signInWith,
    password: req.body.newPassword,
  });
  res.status(200).json({ success: true, data: { ...session, gymName: result.gymName } });
});
