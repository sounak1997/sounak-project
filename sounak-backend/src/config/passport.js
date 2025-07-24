// my-angular-backend/src/config/passport.js
const LocalStrategy = require('passport-local').Strategy;
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const User = require('../models/User'); // Your User model

module.exports = function(passport) {
  // --- Local Strategy for User Login (email/password) ---
  passport.use(
    new LocalStrategy(
      { usernameField: 'email' }, // Specify 'email' as the field for username
      async (email, password, done) => {
        try {
          const user = await User.findOne({ email });

          if (!user) {
            // User not found
            return done(null, false, { message: 'Incorrect email or password.' });
          }

          // Check password
          const isMatch = await user.matchPassword(password);

          if (!isMatch) {
            // Password mismatch
            return done(null, false, { message: 'Incorrect email or password.' });
          }

          // Authentication successful
          return done(null, user);
        } catch (error) {
          // Server error
          return done(error);
        }
      }
    )
  );

  // --- JWT Strategy for Protected Routes ---
  const opts = {};
  // Extract JWT from the Authorization header as a Bearer token
  opts.jwtFromRequest = ExtractJwt.fromAuthHeaderAsBearerToken();
  opts.secretOrKey = process.env.JWT_SECRET; // Your JWT secret from .env

  passport.use(
    new JwtStrategy(opts, async (jwt_payload, done) => {
      try {
        // Find the user by ID from the JWT payload
        // Select all fields except password for security
        const user = await User.findById(jwt_payload.id).select('-password');

        if (user) {
          // User found, token is valid
          return done(null, user);
        } else {
          // User not found (e.g., deleted), or token invalid
          return done(null, false);
        }
      } catch (error) {
        // Server error during user lookup
        return done(error, false);
      }
    })
  );

  // Note: For a stateless JWT API, `serializeUser` and `deserializeUser`
  // are generally NOT needed unless you explicitly want to use sessions
  // in addition to JWTs (which is less common for pure REST APIs).
};