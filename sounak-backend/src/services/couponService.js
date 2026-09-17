// src/services/couponService.js
const pgPool = require('../config/pg.config');
const { genId } = require('../utils/id');

// --- Admin: create — FR-2.5 ---
exports.createCoupon = async ({
  code, discountType, value, minCartValue, usageLimit, validFrom, validTo, createdBy,
}) => {
  const id = genId('CPN');
  const sqlQuery = `
    INSERT INTO coupons (id, code, discount_type, value, min_cart_value, usage_limit, valid_from, valid_to, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()), $8, $9)
    RETURNING *
  `;
  try {
    const result = await pgPool.query(sqlQuery, [
      id,
      code.toUpperCase().trim(),
      discountType,
      value,
      minCartValue ?? null,
      usageLimit ?? null,
      validFrom ?? null,
      validTo ?? null,
      createdBy,
    ]);
    return result.rows[0];
  } catch (error) {
    if (error.code === '23505') { // unique_violation on code
      const err = new Error(`A coupon with code "${code}" already exists.`);
      err.status = 409;
      throw err;
    }
    console.error('Database Error creating coupon (Postgres):', error.message);
    throw new Error('POSTGRES_ERROR: Could not create the coupon.');
  }
};

// --- Admin: list all, with redemption count (times_used) — FR-2.7 ---
exports.listCoupons = async () => {
  const result = await pgPool.query('SELECT * FROM coupons ORDER BY created_at DESC');
  return result.rows;
};

// --- Admin: edit — FR-2.6 ---
const UPDATABLE_COLUMNS = {
  discountType: 'discount_type',
  value: 'value',
  minCartValue: 'min_cart_value',
  usageLimit: 'usage_limit',
  validFrom: 'valid_from',
  validTo: 'valid_to',
};

exports.updateCoupon = async (id, fields) => {
  const setClauses = [];
  const params = [];
  for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
    if (fields[key] === undefined) continue;
    params.push(fields[key]);
    setClauses.push(`${column} = $${params.length}`);
  }
  if (setClauses.length === 0) {
    const err = new Error('No valid fields to update.');
    err.status = 400;
    throw err;
  }
  setClauses.push('updated_at = now()');
  params.push(id);

  const result = await pgPool.query(
    `UPDATE coupons SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return result.rows[0] || null;
};

// --- Admin: deactivate/reactivate — FR-2.6 ---
exports.setCouponActive = async (id, active) => {
  const result = await pgPool.query(
    'UPDATE coupons SET active = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [active, id]
  );
  return result.rows[0] || null;
};

/**
 * Validate a coupon against a cart subtotal and compute the discount,
 * WITHOUT redeeming it (times_used is only incremented when the order is
 * actually placed — see orderService.placeOrder, which does that atomically
 * in the same transaction as the order insert). Used both by a standalone
 * "preview at checkout" call and internally by orderService.
 *
 * @param {import('pg').PoolClient} [client] optional — pass the order
 *   transaction's client so this read participates in the same transaction
 *   (avoids a coupon being edited/deactivated between preview and redeem).
 */
exports.validateCoupon = async (code, cartSubtotal, client = pgPool) => {
  const result = await client.query('SELECT * FROM coupons WHERE code = $1', [
    String(code || '').toUpperCase().trim(),
  ]);
  const coupon = result.rows[0];

  if (!coupon) {
    const err = new Error('Coupon code not found.');
    err.status = 404;
    throw err;
  }
  if (!coupon.active) {
    const err = new Error('This coupon is no longer active.');
    err.status = 400;
    throw err;
  }
  const now = new Date();
  if (coupon.valid_from && now < new Date(coupon.valid_from)) {
    const err = new Error('This coupon is not valid yet.');
    err.status = 400;
    throw err;
  }
  if (coupon.valid_to && now > new Date(coupon.valid_to)) {
    const err = new Error('This coupon has expired.');
    err.status = 400;
    throw err;
  }
  if (coupon.usage_limit !== null && coupon.times_used >= coupon.usage_limit) {
    const err = new Error('This coupon has reached its usage limit.');
    err.status = 400;
    throw err;
  }
  if (coupon.min_cart_value !== null && cartSubtotal < Number(coupon.min_cart_value)) {
    const err = new Error(`This coupon requires a minimum cart value of ${coupon.min_cart_value}.`);
    err.status = 400;
    throw err;
  }

  const discountAmount = coupon.discount_type === 'percentage'
    ? (cartSubtotal * Number(coupon.value)) / 100
    : Number(coupon.value);

  // Never let a flat/percentage discount take the order below zero.
  const cappedDiscount = Math.min(discountAmount, cartSubtotal);

  return { coupon, discountAmount: Math.round(cappedDiscount * 100) / 100 };
};

/**
 * Atomically increments times_used, refusing if the usage limit has been
 * reached since it was last checked (guards against a race between two
 * concurrent checkouts both passing validateCoupon a moment apart).
 * Must be called with the order transaction's client.
 */
exports.redeemCoupon = async (couponId, client) => {
  const result = await client.query(
    `UPDATE coupons
     SET times_used = times_used + 1, updated_at = now()
     WHERE id = $1 AND (usage_limit IS NULL OR times_used < usage_limit)
     RETURNING *`,
    [couponId]
  );
  if (result.rows.length === 0) {
    const err = new Error('This coupon has just reached its usage limit.');
    err.status = 409;
    throw err;
  }
  return result.rows[0];
};
