// src/controllers/authController.js
const crypto = require('crypto');
const asyncHandler = require('express-async-handler');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { generateAccessToken, generateRefreshToken } = generateToken;
const passport = require('passport');
const { publishUserRegistered } = require('../services/queueService');

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
const registerUser = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  const userExists = await User.findOne({ email });
  if (userExists) {
    res.status(400);
    throw new Error('User already exists');
  }

  // Self-registration is customer-only (FR-1.2 / FR-1.3) — `role` is never
  // read from the request body here, so a crafted request can't self-promote
  // to admin. Admin accounts are seeded manually or created by an existing
  // admin (see customerController.createCustomer for the admin-side path).
  const user = await User.create({ name, email, password, role: 'customer' });

  if (user) {
    // Publish async event to RabbitMQ (non-blocking — fire and forget)
    publishUserRegistered(user);

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateAccessToken(user),
      refreshToken: generateRefreshToken(user),
    });
  } else {
    res.status(400);
    throw new Error('Invalid user data');
  }
});

// @desc    Authenticate user & get token (Passport Local Strategy)
// @route   POST /api/auth/login
// @access  Public
const loginUser = (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      res.status(401);
      return res.json({ message: info.message || 'Authentication failed' });
    }
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateAccessToken(user),
      refreshToken: generateRefreshToken(user),
    });
  })(req, res, next);
};

// @desc    Exchange a refresh token for a new access token (FR-1.5)
// @route   POST /api/auth/refresh
// @access  Public (the refresh token itself is the credential)
const refreshAccessToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400);
    throw new Error('refreshToken is required.');
  }

  let payload;
  try {
    payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
  } catch (err) {
    res.status(401);
    throw new Error('Refresh token is invalid or expired.');
  }

  if (payload.type !== 'refresh') {
    res.status(401);
    throw new Error('Not a refresh token.');
  }

  // Re-fetch the account so a since-deleted or since-demoted user can't keep
  // minting valid access tokens off an old refresh token.
  const user = await User.findById(payload.id);
  if (!user) {
    res.status(401);
    throw new Error('Account no longer exists.');
  }

  res.json({ token: generateAccessToken(user) });
});

// @desc    Get user profile (JWT protected)
// @route   GET /api/auth/profile
// @access  Private
const getUserProfile = asyncHandler(async (req, res) => {
  res.json({
    _id: req.user._id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
    phone: req.user.phone,
    addresses: req.user.addresses,
  });
});

// @desc    Request a password reset (FR-1.4)
// @route   POST /api/auth/forgot-password
// @access  Public
//
// NOTE: this project has no email/SMS provider configured yet. In production
// this must dispatch the reset link by email/SMS instead of returning it —
// see the TODO below. Until that's wired up, the response never reveals
// whether the account exists (a fixed generic message either way), which is
// the right behavior for the caller; only the server log carries the token
// in the meantime, for manual/dev use.
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const genericResponse = {
    message: 'If an account with that email exists, a password reset link has been sent.',
  };

  if (!email) {
    res.status(400);
    throw new Error('email is required.');
  }

  const user = await User.findOne({ email });
  if (!user) {
    // Same response as the success case — don't leak which emails are registered.
    return res.json(genericResponse);
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  user.resetPasswordTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  user.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 hour
  await user.save();

  // TODO(production): send `rawToken` via email/SMS instead of logging it.
  // No provider (SES/SendGrid/Twilio/etc.) is configured yet — see
  // docs/shopping-cart-app-requirements.md FR-1.4.
  console.log(`[Password Reset] token for ${email}: ${rawToken} (expires in 1h)`);

  res.json(genericResponse);
});

// @desc    Reset password using the token from forgotPassword
// @route   POST /api/auth/reset-password
// @access  Public
const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    res.status(400);
    throw new Error('token and password are required.');
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({
    resetPasswordTokenHash: tokenHash,
    resetPasswordExpires: { $gt: Date.now() },
  }).select('+resetPasswordTokenHash +resetPasswordExpires');

  if (!user) {
    res.status(400);
    throw new Error('That reset link is invalid or has expired.');
  }

  user.password = password; // re-hashed by the pre-save hook
  user.resetPasswordTokenHash = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  res.json({ message: 'Password has been reset. Please log in with your new password.' });
});

module.exports = {
  registerUser,
  loginUser,
  refreshAccessToken,
  getUserProfile,
  forgotPassword,
  resetPassword,
};
