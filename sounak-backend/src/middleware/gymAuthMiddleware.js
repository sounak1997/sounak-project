// src/middleware/gymAuthMiddleware.js
//
// Authentication and tenancy for the gym portal. Separate from
// authMiddleware/roleMiddleware because the gym portal has its own accounts
// table and does not use the Mongo `users` collection at all — see
// src/db/schema_gym.sql, decision 2.
//
// Two distinct checks, deliberately not collapsed into one:
//
//   requireGymAccount  — "who is calling?"          (authentication)
//   requireGymAccess   — "may they touch THIS gym?" (tenancy)
//
// With ~100 independent gyms on one deployment, the second is the check that
// matters, and the failure it prevents — one owner reading another's member
// list — is silent when it happens. So every owner-side route carries :gymId in
// its path and passes through requireGymAccess, which means a route that forgot
// to be scoped is visible in the route table rather than hidden in a handler.
const asyncHandler = require('express-async-handler');
const gymAuthService = require('../services/gymAuthService');

const bearerFrom = (req) => {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
};

// Sets req.gymAccount, re-read from the database on every request.
const requireGymAccount = asyncHandler(async (req, res, next) => {
  req.gymAccount = await gymAuthService.verifyToken(bearerFrom(req));
  next();
});

// Sets req.gym and req.staffRole. Must run after requireGymAccount.
//
// A gym the caller may not administer is reported as 404, not 403: confirming
// that an id exists but belongs to someone else leaks the shape of the platform
// to anyone who can guess an id.
const requireGymAccess = asyncHandler(async (req, res, next) => {
  const gymId = req.params.gymId || req.body.gymId || req.query.gymId;
  const { gym, staffRole } = await gymAuthService.assertGymAccess(req.gymAccount, gymId);
  req.gym = gym;
  req.staffRole = staffRole;
  next();
});

// Creating gyms and issuing owner accounts — the platform operator, not any
// one gym's owner.
const requirePlatformAdmin = (req, res, next) => {
  if (!req.gymAccount || !req.gymAccount.platform_admin) {
    res.status(403);
    return next(new Error('This action is restricted to the platform administrator.'));
  }
  next();
};

// Ready-made chains, so a route cannot accidentally apply authentication
// without tenancy.
const gymStaffOnly = [requireGymAccount, requireGymAccess];
const platformAdminOnly = [requireGymAccount, requirePlatformAdmin];

module.exports = {
  requireGymAccount,
  requireGymAccess,
  requirePlatformAdmin,
  gymStaffOnly,
  platformAdminOnly,
};
