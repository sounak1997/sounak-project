// my-angular-backend/src/controllers/authController.js
const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const passport = require('passport'); // Import Passport

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

  // Password hashing is handled by the pre-save hook in User model
  const user = await User.create({
    name,
    email,
    password,
  });

  if (user) {
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

// @desc    Authenticate user & get token (using Passport Local Strategy)
// @route   POST /api/auth/login
// @access  Public
const loginUser = (req, res, next) => {
  // Use passport.authenticate('local') with a custom callback
  // This allows us to handle the response (token generation) manually
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      // If an error occurred during authentication (e.g., database error)
      return next(err); // Pass to Express error handling middleware
    }
    if (!user) {
      // Authentication failed (e.g., incorrect credentials)
      res.status(401); // Unauthorized
      return res.json({ message: info.message || 'Authentication failed' });
    }
    // Authentication successful
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      token: generateToken(user._id), // Generate and send the JWT
    });
  })(req, res, next); // Make sure to call the returned middleware
};

// @desc    Get user profile (protected by Passport JWT Strategy)
// @route   GET /api/auth/profile
// @access  Private
const getUserProfile = asyncHandler(async (req, res) => {
  // req.user is populated by the 'jwt' strategy middleware if authentication succeeds
  res.json({
    _id: req.user._id,
    name: req.user.name,
    email: req.user.email,
  });
});

module.exports = { registerUser, loginUser, getUserProfile };