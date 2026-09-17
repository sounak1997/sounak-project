// my-angular-backend/src/utils/generateToken.js
const jwt = require('jsonwebtoken');

// FR-1.3: role travels in the access token so a client (or another service)
// can introspect it without a lookup. This is NOT what authorization decisions
// are based on, though — passport's JWT strategy re-fetches the user by id on
// every request (see config/passport.js) and roleMiddleware checks THAT fresh
// value. So a role claim baked into an old token can never grant more than
// the account currently has in the database.
const generateAccessToken = (user) => {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
};

// FR-1.5: a long-lived token whose only job is to mint a new access token via
// POST /api/auth/refresh, so a customer isn't dropped back to the login
// screen every hour. Signed with a distinct `type` claim (and, when set, a
// separate secret) so a refresh token can never be presented as an access
// token to a protected route by mistake or by a malicious client.
const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user._id, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// Backward-compatible default export: existing call sites do
// `generateToken(user._id)`. Keep that working (id-only access token) while
// new call sites pass the full user to get the role embedded too.
const generateToken = (userOrId) => {
  if (userOrId && typeof userOrId === 'object') {
    return generateAccessToken(userOrId);
  }
  return jwt.sign({ id: userOrId }, process.env.JWT_SECRET, { expiresIn: '1h' });
};

module.exports = generateToken;
module.exports.generateAccessToken = generateAccessToken;
module.exports.generateRefreshToken = generateRefreshToken;
