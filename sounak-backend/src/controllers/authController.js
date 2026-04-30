// src/controllers/authController.js
const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const generateToken = require('../utils/generateToken');
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

  // Password hashing handled by pre-save hook in User model
  const user = await User.create({ name, email, password });

  if (user) {
    // Publish async event to RabbitMQ (non-blocking — fire and forget)
    publishUserRegistered(user);

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      token: generateToken(user._id),
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
      token: generateToken(user._id),
    });
  })(req, res, next);
};

// @desc    Get user profile (JWT protected)
// @route   GET /api/auth/profile
// @access  Private
const getUserProfile = asyncHandler(async (req, res) => {
  res.json({
    _id: req.user._id,
    name: req.user.name,
    email: req.user.email,
  });
});

module.exports = { registerUser, loginUser, getUserProfile };
