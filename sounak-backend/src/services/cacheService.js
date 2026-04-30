const redis = require('../config/redis.config');

const DEFAULT_TTL = 300; // 5 minutes

const get = async (key) => {
  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error(`[Cache] GET error for key "${key}":`, err.message);
    return null;
  }
};

const set = async (key, value, ttl = DEFAULT_TTL) => {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttl);
  } catch (err) {
    console.error(`[Cache] SET error for key "${key}":`, err.message);
  }
};

const del = async (key) => {
  try {
    await redis.del(key);
  } catch (err) {
    console.error(`[Cache] DEL error for key "${key}":`, err.message);
  }
};

const flush = async (pattern) => {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  } catch (err) {
    console.error(`[Cache] FLUSH error for pattern "${pattern}":`, err.message);
  }
};

module.exports = { get, set, del, flush };
