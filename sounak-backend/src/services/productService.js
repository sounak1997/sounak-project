// src/services/productService.js
const pgPool = require('../config/pg.config');
const cache = require('./cacheService');
const { genId } = require('../utils/id');

const KEYS = {
  list: ({ category, search, includeInactive, page, limit }) =>
    `products:list:${category || ''}:${search || ''}:${includeInactive ? '1' : '0'}:${page}:${limit}`,
  product: (id) => `products:${id}`,
  productInfo: (id) => `products:info:${id}`,
};
const LIST_CACHE_PATTERN = 'products:list:*';
const CATEGORIES_CACHE_KEY = 'products:categories';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const invalidateProductCaches = (productId) =>
  Promise.all([
    cache.flush(LIST_CACHE_PATTERN),
    cache.del(KEYS.product(productId)),
    cache.del(CATEGORIES_CACHE_KEY), // a new/edited product may add or empty a category
  ]);

// --- 1. List products, paginated (Redis-cached) — FR-3.1, NFR-5 ---
// Customers only ever see active products; `includeInactive` is for the
// admin product-management screen and must be gated by the caller (route).
exports.listProducts = async ({ page, limit, category, search, includeInactive = false } = {}) => {
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const offset = (pageNum - 1) * limitNum;

  const cacheKey = KEYS.list({ category, search, includeInactive, page: pageNum, limit: limitNum });
  const cached = await cache.get(cacheKey);
  if (cached) {
    console.log(`[Cache HIT] ${cacheKey}`);
    return cached;
  }

  const conditions = [];
  const params = [];
  if (!includeInactive) conditions.push('active = true');
  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`name ILIKE $${params.length}`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countResult = await pgPool.query(`SELECT COUNT(*) FROM products ${whereClause}`, params);
    const totalCount = parseInt(countResult.rows[0].count, 10);

    const listParams = [...params, limitNum, offset];
    const rowsResult = await pgPool.query(
      `SELECT id, name, price, category, stock, in_stock, active, image_urls
       FROM products ${whereClause}
       ORDER BY name ASC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    const result = {
      rows: rowsResult.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages: Math.max(Math.ceil(totalCount / limitNum), 1),
      },
    };
    await cache.set(cacheKey, result, 300);
    console.log(`[Cache SET] ${cacheKey}`);
    return result;
  } catch (error) {
    console.error('Database Error listing products (Postgres):', error.message);
    throw new Error('POSTGRES_ERROR: Could not retrieve the list of products.');
  }
};

// Back-compat helper for any caller that just wants a flat array.
exports.getAllProducts = async () => (await exports.listProducts({ limit: MAX_PAGE_SIZE })).rows;

// --- 1b. Distinct categories, for the customer-facing category filter (FR-3.1) ---
// Derived from the catalog rather than a separate table: `products.category`
// is free text, so this is the only source of truth for what exists.
exports.listCategories = async () => {
  const cached = await cache.get(CATEGORIES_CACHE_KEY);
  if (cached) return cached;

  try {
    const result = await pgPool.query(
      `SELECT category, COUNT(*)::int AS count
       FROM products
       WHERE active = true AND category IS NOT NULL AND category <> ''
       GROUP BY category
       ORDER BY category ASC`
    );
    await cache.set(CATEGORIES_CACHE_KEY, result.rows, 300);
    return result.rows;
  } catch (error) {
    console.error('Database Error listing categories (Postgres):', error.message);
    throw new Error('POSTGRES_ERROR: Could not retrieve categories.');
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

// --- 4. Create product (Admin) — FR-2.1 ---
exports.createProduct = async ({ name, description, price, category, stock }) => {
  const id = genId('PROD');
  const sqlQuery = `
    INSERT INTO products (id, name, description, price, category, stock)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;
  try {
    const result = await pgPool.query(sqlQuery, [
      id,
      name,
      description || null,
      price,
      category || null,
      stock || 0,
    ]);
    await invalidateProductCaches(id);
    return result.rows[0];
  } catch (error) {
    console.error('Database Error creating product (Postgres):', error.message);
    throw new Error('POSTGRES_ERROR: Could not create the product.');
  }
};

// --- 5. Update product fields (Admin) — FR-2.2, e.g. "change product cost" ---
const UPDATABLE_COLUMNS = ['name', 'description', 'price', 'category', 'stock'];

exports.updateProduct = async (productId, fields) => {
  const setClauses = [];
  const params = [];
  for (const column of UPDATABLE_COLUMNS) {
    if (fields[column] === undefined) continue;
    params.push(fields[column]);
    setClauses.push(`${column} = $${params.length}`);
  }
  if (setClauses.length === 0) {
    const err = new Error('No valid fields to update.');
    err.status = 400;
    throw err;
  }
  setClauses.push('updated_at = now()');
  params.push(productId);

  const sqlQuery = `UPDATE products SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`;
  try {
    const result = await pgPool.query(sqlQuery, params);
    if (result.rows.length === 0) return null;
    await invalidateProductCaches(productId);
    return result.rows[0];
  } catch (error) {
    console.error('Database Error updating product (Postgres):', error.message);
    throw new Error('POSTGRES_ERROR: Could not update the product.');
  }
};

// --- 6. Soft delete / reactivate (Admin) — FR-2.3 ---
// Soft delete only: past orders reference product_id, so a hard DELETE would
// either cascade-destroy order history or fail on the FK. `active = false`
// just hides it from customer-facing listings (see listProducts above).
exports.setProductActive = async (productId, active) => {
  const sqlQuery = `UPDATE products SET active = $1, updated_at = now() WHERE id = $2 RETURNING *`;
  try {
    const result = await pgPool.query(sqlQuery, [active, productId]);
    if (result.rows.length === 0) return null;
    await invalidateProductCaches(productId);
    return result.rows[0];
  } catch (error) {
    console.error('Database Error setting product active flag (Postgres):', error.message);
    throw new Error('POSTGRES_ERROR: Could not update the product.');
  }
};

// --- 7. In-stock / out-of-stock toggle (Admin) — FR-2.4 ---
// Deliberately separate from the `stock` quantity column: an admin may want
// to mark something unavailable (e.g. a seasonal item) independent of count.
exports.setProductInStock = async (productId, inStock) => {
  const sqlQuery = `UPDATE products SET in_stock = $1, updated_at = now() WHERE id = $2 RETURNING *`;
  try {
    const result = await pgPool.query(sqlQuery, [inStock, productId]);
    if (result.rows.length === 0) return null;
    await invalidateProductCaches(productId);
    return result.rows[0];
  } catch (error) {
    console.error('Database Error setting product in_stock flag (Postgres):', error.message);
    throw new Error('POSTGRES_ERROR: Could not update the product.');
  }
};

// --- 8. Append an uploaded image URL (Admin) — NFR-3 ---
exports.addProductImage = async (productId, imageUrl) => {
  const sqlQuery = `
    UPDATE products
    SET image_urls = image_urls || to_jsonb($1::text), updated_at = now()
    WHERE id = $2
    RETURNING *
  `;
  try {
    const result = await pgPool.query(sqlQuery, [imageUrl, productId]);
    if (result.rows.length === 0) return null;
    await invalidateProductCaches(productId);
    return result.rows[0];
  } catch (error) {
    console.error('Database Error adding product image (Postgres):', error.message);
    throw new Error('POSTGRES_ERROR: Could not save the product image.');
  }
};

exports.productExists = async (productId) => {
  const result = await pgPool.query('SELECT 1 FROM products WHERE id = $1', [productId]);
  return result.rows.length > 0;
};
