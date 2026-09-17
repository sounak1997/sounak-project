// src/utils/id.js
//
// Postgres row ids in this schema are app-generated strings (matching the
// existing `products.id` column type/style, e.g. "PROD001"), not a SERIAL —
// so every new table needs an id generated in Node before INSERT. A prefixed
// UUID avoids collisions without a round trip to check "what's the next
// number", which existing sequential-looking ids like PROD001 would need.
const crypto = require('crypto');

const genId = (prefix) => `${prefix}_${crypto.randomUUID()}`;

module.exports = { genId };
