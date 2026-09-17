// src/services/cartService.js
//
// One cart per account (FR-3.4: "tied to the logged-in account rather than
// only local device storage"), backed by Postgres alongside products/orders.
// `user_id` is a Mongo ObjectId string — no DB-level FK across engines, only
// an application-level one (every call here is scoped by the caller's own
// req.user._id, so a customer can never touch another account's cart).
const pgPool = require('../config/pg.config');
const { genId } = require('../utils/id');

async function getOrCreateCartId(userId) {
  const existing = await pgPool.query('SELECT id FROM carts WHERE user_id = $1', [userId]);
  if (existing.rows.length > 0) return existing.rows[0].id;

  const id = genId('CART');
  // ON CONFLICT guards a race between two concurrent first-add-to-cart calls
  // for the same brand-new account (carts.user_id is UNIQUE).
  const inserted = await pgPool.query(
    `INSERT INTO carts (id, user_id) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING id`,
    [id, userId]
  );
  return inserted.rows[0].id;
}

// Cart contents joined with live product data, so the UI can show current
// price/name/stock rather than what was true when the item was added.
exports.getCart = async (userId) => {
  const cartId = await getOrCreateCartId(userId);
  const result = await pgPool.query(
    `SELECT
       ci.product_id,
       ci.quantity,
       p.name,
       p.price,
       p.category,
       p.active,
       p.in_stock,
       p.stock,
       p.image_urls,
       (p.price * ci.quantity) AS line_total
     FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     WHERE ci.cart_id = $1
     ORDER BY ci.created_at ASC`,
    [cartId]
  );

  const items = result.rows;
  const subtotal = items.reduce((sum, item) => sum + Number(item.line_total), 0);
  return { cartId, items, subtotal: Math.round(subtotal * 100) / 100 };
};

// Add to cart (FR-3.3). Adding an item already present increases its
// quantity rather than erroring or duplicating the row (cart_items has a
// UNIQUE (cart_id, product_id) constraint backing this upsert).
exports.addItem = async (userId, productId, quantity = 1) => {
  if (quantity <= 0) {
    const err = new Error('quantity must be greater than 0.');
    err.status = 400;
    throw err;
  }

  const product = await pgPool.query(
    'SELECT id, active, in_stock FROM products WHERE id = $1',
    [productId]
  );
  if (product.rows.length === 0) {
    const err = new Error(`Product '${productId}' not found.`);
    err.status = 404;
    throw err;
  }
  if (!product.rows[0].active || !product.rows[0].in_stock) {
    const err = new Error('This product is not currently available.');
    err.status = 400;
    throw err;
  }

  const cartId = await getOrCreateCartId(userId);
  const id = genId('CI');
  await pgPool.query(
    `INSERT INTO cart_items (id, cart_id, product_id, quantity)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (cart_id, product_id)
     DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity, updated_at = now()`,
    [id, cartId, productId, quantity]
  );

  return exports.getCart(userId);
};

// Adjust quantity (FR-3.3) to an absolute value; 0 removes the item.
exports.updateItemQuantity = async (userId, productId, quantity) => {
  const cartId = await getOrCreateCartId(userId);

  if (quantity <= 0) {
    await pgPool.query('DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2', [cartId, productId]);
    return exports.getCart(userId);
  }

  const result = await pgPool.query(
    `UPDATE cart_items SET quantity = $1, updated_at = now()
     WHERE cart_id = $2 AND product_id = $3
     RETURNING id`,
    [quantity, cartId, productId]
  );
  if (result.rows.length === 0) {
    const err = new Error('That item is not in your cart.');
    err.status = 404;
    throw err;
  }
  return exports.getCart(userId);
};

// Remove an item (FR-3.3).
exports.removeItem = async (userId, productId) => {
  const cartId = await getOrCreateCartId(userId);
  await pgPool.query('DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2', [cartId, productId]);
  return exports.getCart(userId);
};

// Used by orderService after a successful checkout.
exports.clearCart = async (userId, client = pgPool) => {
  const cart = await client.query('SELECT id FROM carts WHERE user_id = $1', [userId]);
  if (cart.rows.length === 0) return;
  await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cart.rows[0].id]);
};

exports.getOrCreateCartId = getOrCreateCartId;
