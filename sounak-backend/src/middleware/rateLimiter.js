const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redis = require('../config/redis.config');

// Use Redis store only when Redis is connected, otherwise fall back to memory
const makeStore = () => {
  if (redis.status === 'ready') {
    return new RedisStore({ sendCommand: (...args) => redis.call(...args) });
  }
  console.warn('[RateLimiter] Redis not ready — using in-memory store');
  return undefined; // express-rate-limit defaults to memory store when undefined
};

// Gym door check-in is exempt from the global limiter and gets its own,
// far more generous one below. Reason: every member standing in one gym is
// behind that gym's single public IP, so per-IP counting sees the whole
// membership as one client. 100 requests / 15 min is a sane ceiling for one
// person and a guaranteed outage for a busy evening at the gym.
const isGymCheckinPath = (req) => req.path.startsWith('/gym/checkin');

// The whole gym portal carries its own limiters (below), so the general one
// steps aside for it. Same reasoning as the check-in exemption, for the other
// side of the same product: opening the owner's console is a single human action
// that fans out to ~13 requests — the figures, who is holding cash, the member
// list, the renewal worklist, today's attendance, the collection history. At 100
// per 15 minutes that is seven page views before a gym owner is locked out of
// their own console, which is what happened.
const isGymPath = (req) => req.path.startsWith('/gym/');

// General API: 100 requests per 15 minutes per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please try again later.' },
  store: makeStore(),
  skip: isGymPath,
});

// The owner/staff console: sized for a screen that fans out, not for a single
// call. ~40 requests a minute sustained is roughly three dashboard loads a
// minute — more than anyone reads — while still being a brake on a script.
const gymConsoleLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please wait a moment and try again.' },
  store: makeStore(),
});

// Signing in to the gym portal. Brute-force protection, but counted per IP and a
// gym has ONE public IP shared by the owner and everyone on the desk — so 10,
// which is what the main auth limiter allows, would lock out a gym where three
// people sign in on a shift change.
const gymAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts — please try again in a few minutes.' },
  store: makeStore(),
});

// Auth endpoints: 10 requests per 15 minutes per IP (brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts — please try again later.' },
  store: makeStore(),
});

// Strict limiter for register: 5 per hour per IP
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts — please try again in an hour.' },
  store: makeStore(),
});

// Gym check-in (public, no login): 300 per 15 minutes per IP. Sized for a
// shared gym IP rather than a single person — see isGymCheckinPath above.
const gymCheckinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'The check-in desk is busy — please try again in a moment.' },
  store: makeStore(),
});

// Device identification by phone number: 30 per hour per IP.
//
// This is the one endpoint that turns a phone number into a member's name, so
// it is the enumeration surface for "who trains here". A member hits it once
// per device, ever, so 30/hour comfortably covers a gym onboarding a group of
// new members on the same WiFi, while making it impractical to walk a phone
// number space looking for hits.
const gymIdentifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — please ask the gym desk to check you in.' },
  store: makeStore(),
});

module.exports = {
  apiLimiter,
  authLimiter,
  registerLimiter,
  gymCheckinLimiter,
  gymIdentifyLimiter,
  gymConsoleLimiter,
  gymAuthLimiter,
};
