// src/middleware/roleMiddleware.js
//
// Role-based access control (FR-1.3). Must run after passport's JWT strategy
// (`passport.authenticate('jwt', ...)`) so `req.user` is already the fresh
// document loaded from the database — that's what makes this safe: the role
// checked here is re-read from Mongo on every request, not merely trusted
// from whatever the client's JWT claims, so a stale or tampered token can't
// grant access a since-changed account no longer has.

const requireRole = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    // Should not happen if requireAuth runs first, but fail closed either way.
    return res.status(401).json({ message: 'Authentication required.' });
  }

  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ message: 'You do not have permission to do that.' });
  }

  next();
};

module.exports = { requireRole };
