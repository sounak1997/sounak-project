// src/utils/formFields.js
//
// Reads an admin form's JSON body into a { column: value } map, applying one
// rule per field. Used by the doctor/center and lab/test controllers, whose
// records are all "a few required fields plus a handful of optional details".
//
// For each field:
//   key missing from the body -> left out of the result (on update: unchanged)
//   blank ('' or null)         -> null (clears an optional field)
//   otherwise                  -> the cleaned value, or a 400 if it is invalid
//
// The thrown error carries statusCode 400, which errorMiddleware turns into a
// response whose message the admin panel shows the admin verbatim.
const { isValidImageUrl } = require('../services/catalogImageService');

const fieldError = (message) => {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
};

const PARSERS = {
  text: (value) => String(value).trim(),

  // Digits plus the punctuation people actually type: "+91 98300 11223",
  // "033-2456 7890". Loose on format, but it has to contain a real number.
  phone: (value, label) => {
    const phone = String(value).trim();
    const digits = phone.replace(/\D/g, '');
    if (!/^[\d+\-\s()]+$/.test(phone) || digits.length < 6 || digits.length > 15) {
      throw fieldError(`${label} must be a phone number.`);
    }
    return phone;
  },

  number: (value, label) => {
    const n = Number(value);
    if (Number.isNaN(n) || n < 0) throw fieldError(`${label} must be a number, 0 or more.`);
    return n;
  },

  integer: (value, label) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) throw fieldError(`${label} must be a whole number, 0 or more.`);
    return n;
  },

  image: (value, label) => {
    if (!isValidImageUrl(value)) throw fieldError(`${label} must be an uploaded image.`);
    return value;
  },

  // Opened by the customer's "Directions" button, so only real web links.
  link: (value, label) => {
    const link = String(value).trim();
    if (!/^https?:\/\/\S+$/i.test(link)) throw fieldError(`${label} must be a link starting with https://`);
    return link;
  },
};

/**
 * @param {object} body     req.body
 * @param {object} spec     { column: { key, label, type, required? } }
 * @param {object} options  { partial } — true for an update
 * @returns {object}        { column: value } for every field present
 */
function readFields(body, spec, { partial }) {
  const fields = {};
  for (const [column, rule] of Object.entries(spec)) {
    const raw = body[rule.key];
    if (raw === undefined) {
      if (rule.required && !partial) throw fieldError(`${rule.label} is required.`);
      continue;
    }
    const blank = raw === null || (typeof raw === 'string' && raw.trim() === '');
    if (blank) {
      if (rule.required) throw fieldError(`${rule.label} is required.`);
      fields[column] = null;
      continue;
    }
    fields[column] = PARSERS[rule.type](raw, rule.label);
  }
  return fields;
}

module.exports = { readFields, fieldError };
