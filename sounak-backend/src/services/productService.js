// src/services/productService.js
const pgPool = require('../config/pg.config');
const cache = require('./cacheService');

const KEYS = {
  ALL_PRODUCTS: 'products:all',
  product: (id) => `products:${id}`,
  productInfo: (id) => `products:info:${id}`,
};

// --- 1. Get List of Products (Redis-cached) ---
exports.getAllProducts = async () => {
  const cached = await cache.get(KEYS.ALL_PRODUCTS);
  if (cached) {
    console.log('[Cache HIT] products:all');
    return cached;
  }

  const sqlQuery = `
    SELECT id, name, price, category, stock
    FROM products
    ORDER BY name ASC
  `;
  try {
    const result = await pgPool.query(sqlQuery);
    await cache.set(KEYS.ALL_PRODUCTS, result.rows, 300);
    console.log('[Cache SET] products:all');
    return result.rows;
  } catch (error) {
    console.error('Database Error fetching product list (Postgres):', error.message);
    throw new Error('POSTGRES_ERROR: Could not retrieve the list of products.');
  }
};

// --- 2. Get Single Product Details (Redis-cached) ---
exports.getProductDetails = async (productId) => {
  if (!productId || typeof productId !== 'string') {
    throw new Error('Invalid product ID format.');
  }

  const cacheKey = KEYS.product(productId);
  const cached = await cache.get(cacheKey);
  if (cached) {
    console.log(`[Cache HIT] ${cacheKey}`);
    return cached;
  }

  const sqlQuery = `SELECT * FROM products WHERE id = $1`;
  try {
    const result = await pgPool.query(sqlQuery, [productId]);
    if (result.rows.length === 0) return null;
    await cache.set(cacheKey, result.rows[0], 300);
    console.log(`[Cache SET] ${cacheKey}`);
    return result.rows[0];
  } catch (error) {
    console.error('Database Error fetching product details (Postgres):', error.message);
    throw new Error('POSTGRES_ERROR: Could not retrieve product details.');
  }
};

// --- 3. Get Product Info (Redis-cached) ---
exports.getProductInfo = async (productId) => {
  const cacheKey = KEYS.productInfo(productId);
  const cached = await cache.get(cacheKey);
  if (cached) {
    console.log(`[Cache HIT] ${cacheKey}`);
    return cached;
  }

  const sqlQuery = `SELECT * FROM product_details WHERE product_id = $1`;
  try {
    const result = await pgPool.query(sqlQuery, [productId]);
    const row = result.rows[0] || null;
    if (row) await cache.set(cacheKey, row, 300);
    return row;
  } catch (error) {
    console.error(`Database error fetching product info for ID ${productId}:`, error.message);
    throw new Error('Failed to retrieve product information due to a database issue.');
  }
};
