// src/utils/secretBox.js
//
// Authenticated encryption for third-party credentials held on someone else's
// behalf — currently each gym's payment-gateway API secret.
//
// AES-256-GCM rather than plain AES: GCM authenticates the ciphertext, so a
// tampered or truncated value fails to decrypt instead of silently producing
// garbage that would then be sent to a payment provider as a key.
//
// The master key lives in the environment (GYM_CREDENTIALS_KEY), never in the
// database — otherwise a database dump would contain both the locked box and
// its key, and encrypting at all would be theatre.
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;   // 96-bit nonce, the size GCM is specified for
const TAG_BYTES = 16;

// Fail loudly and early. A silent fallback to "store it in the clear" is how
// credentials end up unencrypted in production without anyone noticing.
const masterKey = () => {
  const raw = process.env.GYM_CREDENTIALS_KEY;
  if (!raw) {
    throw new Error(
      'GYM_CREDENTIALS_KEY is not set. Generate one with:\n' +
      "  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('GYM_CREDENTIALS_KEY must be 32 bytes, base64-encoded (256-bit AES key).');
  }
  return key;
};

/** Returns "iv.tag.ciphertext", all base64 — one self-describing column value. */
exports.seal = (plaintext) => {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
};

exports.open = (sealed) => {
  if (!sealed) return null;
  const [ivB64, tagB64, dataB64] = String(sealed).split('.');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Stored credential is malformed.');
  }
  const decipher = crypto.createDecipheriv(ALGO, masterKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
};

/** Lets a health check confirm the key is configured without decrypting anything. */
exports.isConfigured = () => {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
};
