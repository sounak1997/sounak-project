// src/controllers/gymAuthController.js
//
// Logins for gym owners and staff. Independent of the Mongo-backed
// /api/auth used by the grocery and doctors portals — see
// src/db/schema_gym.sql, decision 2.
const asyncHandler = require('express-async-handler');
const gymAuthService = require('../services/gymAuthService');

// @desc    Sign in a gym owner or staff member
// @route   POST /api/gym/auth/login
// @access  Public
exports.login = asyncHandler(async (req, res) => {
  // `identifier` is either an email or a mobile number; `email` is still
  // accepted so any existing caller keeps working.
  const result = await gymAuthService.login({
    identifier: req.body.identifier || req.body.email,
    password: req.body.password,
  });
  res.status(200).json({ success: true, data: result });
});

// @desc    Who am I, and which gyms may I administer
// @route   GET /api/gym/auth/me
// @access  Gym account
exports.me = asyncHandler(async (req, res) => {
  // Both, for the same reason login returns both: an account may staff gyms,
  // train at gyms, or do both, and the client decides its home screen from this.
  const [gyms, memberships] = await Promise.all([
    gymAuthService.accessibleGyms(req.gymAccount),
    gymAuthService.accessibleMemberships(req.gymAccount),
  ]);
  res.status(200).json({
    success: true,
    data: { account: gymAuthService.publicAccount(req.gymAccount), gyms, memberships },
  });
});

// @desc    Change my own password
// @route   POST /api/gym/auth/change-password
// @access  Gym account
exports.changePassword = asyncHandler(async (req, res) => {
  const result = await gymAuthService.changePassword({
    accountId: req.gymAccount.id,
    currentPassword: req.body.currentPassword,
    newPassword: req.body.newPassword,
  });
  res.status(200).json({ success: true, data: result });
});

// --- platform administration ----------------------------------------------
// Creating gyms and issuing owner accounts. Restricted to the platform
// operator: a gym owner must never be able to create another gym or grant
// themselves access to one.

// @desc    List every gym on the platform
// @route   GET /api/gym/admin/gyms
// @access  Platform admin
exports.listGyms = asyncHandler(async (req, res) => {
  const gyms = await gymAuthService.listGyms();
  res.status(200).json({ success: true, count: gyms.length, data: gyms });
});

// @desc    Create a gym, optionally assigning its owner in the same step
// @route   POST /api/gym/admin/gyms
// @access  Platform admin
exports.createGym = asyncHandler(async (req, res) => {
  const gym = await gymAuthService.createGym({
    name: req.body.name,
    address: req.body.address,
    phone: req.body.phone,
    timezone: req.body.timezone,
    ownerAccountId: req.body.ownerAccountId,
  });
  res.status(201).json({ success: true, data: gym });
});

// @desc    Suspend a gym, or bring a suspended one back
// @route   PATCH /api/gym/admin/gyms/:gymId/status
// @access  Platform admin
//
// Body is { status: 'suspended' } or { status: 'active' }, rather than two
// separate endpoints, so "what state should this gym be in" is one idempotent
// call the admin screen can drive from a toggle.
exports.setGymStatus = asyncHandler(async (req, res) => {
  const gym = await gymAuthService.setGymStatus({
    gymId: req.params.gymId,
    status: req.body.status,
  });
  res.status(200).json({ success: true, data: gym });
});

// @desc    Create an owner/staff account (grants no gym access by itself)
// @route   POST /api/gym/admin/accounts
// @access  Platform admin
exports.createAccount = asyncHandler(async (req, res) => {
  const account = await gymAuthService.createAccount({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    phone: req.body.phone,
    platformAdmin: false,
  });
  res.status(201).json({ success: true, data: account });
});

// @desc    Give an account access to a gym
// @route   POST /api/gym/admin/gyms/:gymId/staff
// @access  Platform admin
exports.addStaff = asyncHandler(async (req, res) => {
  const staff = await gymAuthService.addStaff({
    gymId: req.params.gymId,
    accountId: req.body.accountId,
    role: req.body.role,
  });
  res.status(201).json({ success: true, data: staff });
});

// @desc    Remove an account's access to a gym
// @route   DELETE /api/gym/admin/gyms/:gymId/staff/:accountId
// @access  Platform admin
exports.removeStaff = asyncHandler(async (req, res) => {
  const result = await gymAuthService.removeStaff({
    gymId: req.params.gymId,
    accountId: req.params.accountId,
  });
  res.status(200).json({ success: true, data: result });
});

// @desc    Every account on the platform, so one can be picked to reset
// @route   GET /api/gym/admin/accounts
// @access  Platform admin
exports.listAccounts = asyncHandler(async (req, res) => {
  const accounts = await gymAuthService.listAccounts();
  res.status(200).json({ success: true, count: accounts.length, data: accounts });
});

// @desc    Reset any account's password — the route for a locked-out gym owner
// @route   POST /api/gym/admin/accounts/:accountId/reset-password
// @access  Platform admin
exports.resetAccountPassword = asyncHandler(async (req, res) => {
  const account = await gymAuthService.resetAccountPassword({
    accountId: req.params.accountId,
    newPassword: req.body.newPassword,
  });
  res.status(200).json({ success: true, data: account });
});
