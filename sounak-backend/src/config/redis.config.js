const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  // Fail immediately when offline instead of queuing — prevents MaxRetriesPerRequestError crash
  enableOfflineQueue: false,
  lazyConnect: true,
  retryStrategy: (times) => {
    if (times > 5) {
      console.warn('[Redis] Not available — caching disabled, app continues without it');
      return null; // stop retrying, no crash
    }
    return Math.min(times * 500, 3000);
  },
});

redis.on('connect', () => console.log('[Redis] Connected'));
redis.on('error', (err) => {
  if (err.code !== 'ECONNREFUSED') console.error('[Redis] Error:', err.message);
});

// Attempt connection on startup (non-blocking)
redis.connect().catch(() => {});

module.exports = redis;
