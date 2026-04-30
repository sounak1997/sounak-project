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

// General API: 100 requests per 15 minutes per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please try again later.' },
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

module.exports = { apiLimiter, authLimiter, registerLimiter };
