// src/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const passport = require('passport');
const userController = require('../controllers/userController');

// These routes used to be public. They aren't any more, because the AI agent
// calls them on a user's behalf: the assistant forwards the caller's own JWT,
// and "the agent can only see what you can see" is only true if the endpoint
// actually checks. Every Angular caller already sends the token (JwtInterceptor
// attaches it to all HttpClient requests), so nothing in the UI changes.
const requireAuth = passport.authenticate('jwt', { session: false });

router.get('/', requireAuth, userController.getUsers);
router.post('/', requireAuth, userController.createUser);
router.get('/get', requireAuth, userController.getProfileDesc);

module.exports = router;
