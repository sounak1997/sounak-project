// my-angular-backend/src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const passport = require('passport'); // Import Passport
const {
  registerUser,
  loginUser,
  refreshAccessToken,
  getUserProfile,
  forgotPassword,
  resetPassword,
} = require('../controllers/authController');

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/refresh', refreshAccessToken); // FR-1.5
router.post('/forgot-password', forgotPassword); // FR-1.4
router.post('/reset-password', resetPassword); // FR-1.4

// Protect the profile route with Passport's JWT strategy
// { session: false } is crucial for stateless JWT authentication
router.get('/profile', passport.authenticate('jwt', { session: false }), getUserProfile);

module.exports = router;