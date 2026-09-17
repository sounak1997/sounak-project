// src/services/orderService.js
//
// Order placement touches four things that all have to succeed or all fail
// together — the order row, the order_items snapshot, the coupon's usage
// count, and each product's stock — so, unlike the rest of this codebase's
// single-query-per-call style, placeOrder runs inside one Postgres
// transaction with row locks on the products being purchased. Everything
// else here is plain pool queries, same as productService/cartService.
const pgPool = require('../config/pg.config');
const cache = require('./cacheService');
const { genId } = require('../utils/id');
const couponService = require('./couponService');

const ACTIVE_STATUSES = ['placed', 'packed', 'out_for_delivery'];
const TERMINAL_STATUSES = ['delivered', 'cancelled'];
const VALID_STATUSES = [...ACTIVE_STATUSES, ...TERMINAL_STATUSES];

async function invalidateProductListCaches() {
  await cache.flush('products:list:*');
}

/**
 * Place an order from the customer's current cart (FR-3.6–FR-3.8).
 * Locks the product rows being purchased for the duration of the
 * transaction (SELECT ... FOR UPDATE) so two near-simultaneous checkouts
 * can't both oversell the last unit of stock.
 */
exports.placeOrder = async (userId, { deliveryAddress, paymentMethod, couponCode, paymentReference }) => {
  if (!['cod', 'qr'].includes(paymentMethod)) {
    const err = new Error('paymentMethod must be "cod" or "qr".');
    err.status = 400;
    throw err;
  }
  if (!deliveryAddress || typeof deliveryAddress !== 'object') {
    const err = new Error('deliveryAddress is required.');
    err.status = 400;
    throw err;
  }

  const client = await pgPool.pool.connect();
  try {
    await client.query('BEGIN');

    const cartResult = await client.query('SELECT id FROM carts WHERE user_id = $1', [userId]);
    if (cartResult.rows.length === 0) {
      const err = new Error('Your cart is empty.');
      err.status = 400;
      throw err;
    }
    const cartId = cartResult.rows[0].id;

    const itemsResult = await client.query(
      `SELECT ci.product_id, ci.quantity, p.name, p.price, p.stock, p.active, p.in_stock
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       WHERE ci.cart_id = $1
       FOR UPDATE OF p`,
      [cartId]
    );
    if (itemsResult.rows.length === 0) {
      const err = new Error('Your cart is empty.');
      err.status = 400;
      throw err;
    }

    for (const item of itemsResult.rows) {
      if (!item.active || !item.in_stock) {
        const err = new Error(`"${item.name}" is no longer available.`);
        err.status = 409;
        throw err;
      }
      if (item.stock < item.quantity) {
        const err = new Error(`Only ${item.stock} of "${item.name}" left in stock.`);
        err.status = 409;
        throw err;
      }
    }

    const subtotal = itemsResult.rows.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);

    let discountApplied = 0;
    let appliedCouponCode = null;
    if (couponCode) {
      const { coupon, discountAmount } = await couponService.validateCoupon(couponCode, subtotal, client);
      await couponService.redeemCoupon(coupon.id, client);
      discountApplied = discountAmount;
      appliedCouponCode = coupon.code;
    }

    const total = Math.round((subtotal - discountApplied) * 100) / 100;
    const orderId = genId('ORD');
    // FR-3.7 / FR-3.8: COD starts "pending, due on delivery"; QR starts
    // "pending verification" until admin confirms (FR-2.12).
    const paymentStatus = paymentMethod === 'cod' ? 'pending' : 'pending_verification';

    await client.query(
      `INSERT INTO orders
         (id, user_id, payment_method, payment_status, payment_reference, subtotal, discount_applied, coupon_code, total, delivery_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [orderId, userId, paymentMethod, paymentStatus, paymentReference || null,
        subtotal, discountApplied, appliedCouponCode, total, JSON.stringify(deliveryAddress)]
    );

    for (const item of itemsResult.rows) {
      await client.query(
        `INSERT INTO order_items (id, order_id, product_id, product_name, quantity, price_at_purchase)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [genId('OI'), orderId, item.product_id, item.name, item.quantity, item.price]
      );
      await client.query(
        'UPDATE products SET stock = stock - $1, updated_at = now() WHERE id = $2',
        [item.quantity, item.product_id]
      );
    }

    await client.query(
      `INSERT INTO order_status_history (id, order_id, event, changed_by) VALUES ($1, $2, $3, $4)`,
      [genId('OSH'), orderId, 'status:placed', userId]
    );

    await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);

    await client.query('COMMIT');

    // Stock just changed — best-effort cache bust, outside the transaction.
    await invalidateProductListCaches().catch(() => {});

    return exports.getOrderById(orderId);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

async function attachItems(order) {
  if (!order) return null;
  const items = await pgPool.query(
    'SELECT product_id, product_name, quantity, price_at_purchase FROM order_items WHERE order_id = $1',
    [order.id]
  );
  return { ...order, items: items.rows };
}

exports.getOrderById = async (orderId) => {
  const result = await pgPool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
  return attachItems(result.rows[0] || null);
};

// FR-3.9 (customer: own orders) / FR-2.10 (admin: all orders) — same query
// shape, scoped by userId when the caller isn't an admin (see controller).
exports.listOrders = async ({ userId, status, page, limit } = {}) => {
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  const params = [];
  if (userId) {
    params.push(userId);
    conditions.push(`user_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await pgPool.query(`SELECT COUNT(*) FROM orders ${whereClause}`, params);
  const totalCount = parseInt(countResult.rows[0].count, 10);

  const listParams = [...params, limitNum, offset];
  const rowsResult = await pgPool.query(
    `SELECT * FROM orders ${whereClause} ORDER BY created_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  return {
    rows: rowsResult.rows,
    pagination: { page: pageNum, limit: limitNum, totalCount, totalPages: Math.max(Math.ceil(totalCount / limitNum), 1) },
  };
};

// FR-2.11: Placed -> Packed -> Out for delivery -> Delivered / Cancelled.
// Not a strict linear state machine (Cancelled can happen from any active
// state), but both terminal states are final — matches "Delivered" and
// "Cancelled" reading as end-of-pipeline in the spec.
exports.updateStatus = async (orderId, newStatus, changedBy) => {
  if (!VALID_STATUSES.includes(newStatus)) {
    const err = new Error(`status must be one of: ${VALID_STATUSES.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const client = await pgPool.pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (current.rows.length === 0) {
      const err = new Error(`Order '${orderId}' not found.`);
      err.status = 404;
      throw err;
    }
    if (TERMINAL_STATUSES.includes(current.rows[0].status)) {
      const err = new Error(`Order is already ${current.rows[0].status} and cannot be changed further.`);
      err.status = 409;
      throw err;
    }

    await client.query('UPDATE orders SET status = $1, updated_at = now() WHERE id = $2', [newStatus, orderId]);
    await client.query(
      `INSERT INTO order_status_history (id, order_id, event, changed_by) VALUES ($1, $2, $3, $4)`,
      [genId('OSH'), orderId, `status:${newStatus}`, changedBy]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return exports.getOrderById(orderId);
};

// FR-2.12 (QR: mark "verified") and the COD equivalent (mark cash
// "collected"), both audited per NFR-2 (who + when).
exports.markPaymentStatus = async (orderId, newPaymentStatus, changedBy) => {
  const allowedTransitions = {
    verified: { from: 'pending_verification', method: 'qr' },
    collected: { from: 'pending', method: 'cod' },
  };
  const transition = allowedTransitions[newPaymentStatus];
  if (!transition) {
    const err = new Error('newPaymentStatus must be "verified" (QR) or "collected" (COD).');
    err.status = 400;
    throw err;
  }

  const client = await pgPool.pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      'SELECT payment_method, payment_status FROM orders WHERE id = $1 FOR UPDATE',
      [orderId]
    );
    if (current.rows.length === 0) {
      const err = new Error(`Order '${orderId}' not found.`);
      err.status = 404;
      throw err;
    }
    const order = current.rows[0];
    if (order.payment_method !== transition.method || order.payment_status !== transition.from) {
      const err = new Error(
        `Cannot mark as "${newPaymentStatus}" — order payment is currently "${order.payment_status}" via ${order.payment_method}.`
      );
      err.status = 409;
      throw err;
    }

    await client.query(
      `UPDATE orders
       SET payment_status = $1, payment_verified_by = $2, payment_verified_at = now(), updated_at = now()
       WHERE id = $3`,
      [newPaymentStatus, changedBy, orderId]
    );
    await client.query(
      `INSERT INTO order_status_history (id, order_id, event, changed_by) VALUES ($1, $2, $3, $4)`,
      [genId('OSH'), orderId, `payment:${newPaymentStatus}`, changedBy]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return exports.getOrderById(orderId);
};

exports.getOrderOwner = async (orderId) => {
  const result = await pgPool.query('SELECT user_id FROM orders WHERE id = $1', [orderId]);
  return result.rows[0]?.user_id || null;
};

exports.getStatusHistory = async (orderId) => {
  const result = await pgPool.query(
    'SELECT event, changed_by, changed_at FROM order_status_history WHERE order_id = $1 ORDER BY changed_at ASC',
    [orderId]
  );
  return result.rows;
};
