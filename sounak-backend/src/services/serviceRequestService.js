// src/services/serviceRequestService.js
//
// The unified callback-queue table — see
// docs/doctors-test-booking-and-helper-portal-requirements.md § 5. Grocery
// assistance (FR-3.10/FR-3.11), doctor booking, test booking, and the Helper
// portal all share this one table and this one service; only
// `grocery_assistance` has an API wired to it yet (see serviceRequestRoutes),
// but the shape here already supports the other three request_type values.
const pgPool = require('../config/pg.config');
const { genId } = require('../utils/id');

const REQUEST_TYPES = ['grocery_assistance', 'doctor_booking', 'test_booking', 'helper_task'];
const STATUSES = ['pending', 'contacted', 'resolved'];

exports.REQUEST_TYPES = REQUEST_TYPES;
exports.STATUSES = STATUSES;

// FR-3.10 / FR-3.11: create a request. `reason` is one of place_order /
// general_help / delivery_issue / custom for grocery_assistance; other
// request types define their own reason vocabulary later.
exports.createRequest = async ({ userId, phone, requestType, reason, details, note }) => {
  if (!REQUEST_TYPES.includes(requestType)) {
    const err = new Error(`requestType must be one of: ${REQUEST_TYPES.join(', ')}`);
    err.status = 400;
    throw err;
  }
  if (!phone) {
    const err = new Error('phone is required.');
    err.status = 400;
    throw err;
  }

  const id = genId('SR');
  const result = await pgPool.query(
    `INSERT INTO service_requests (id, user_id, phone, request_type, reason, details, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [id, userId, phone, requestType, reason || null, JSON.stringify(details || {}), note || null]
  );
  return result.rows[0];
};

// FR-2.13: admin queue view, optionally filtered.
exports.listRequests = async ({ status, requestType, page, limit } = {}) => {
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  const params = [];
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (requestType) {
    params.push(requestType);
    conditions.push(`request_type = $${params.length}`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await pgPool.query(`SELECT COUNT(*) FROM service_requests ${whereClause}`, params);
  const totalCount = parseInt(countResult.rows[0].count, 10);

  const listParams = [...params, limitNum, offset];
  const rowsResult = await pgPool.query(
    `SELECT * FROM service_requests ${whereClause}
     ORDER BY (status = 'pending') DESC, created_at ASC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  return {
    rows: rowsResult.rows,
    pagination: { page: pageNum, limit: limitNum, totalCount, totalPages: Math.max(Math.ceil(totalCount / limitNum), 1) },
  };
};

// A customer's own requests, e.g. "my assistance requests" history.
exports.listOwnRequests = async (userId) => {
  const result = await pgPool.query(
    'SELECT * FROM service_requests WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return result.rows;
};

// FR-2.14: mark contacted / resolved.
exports.setStatus = async (id, status, resolvedBy) => {
  if (!STATUSES.includes(status)) {
    const err = new Error(`status must be one of: ${STATUSES.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const isResolved = status === 'resolved';
  const result = await pgPool.query(
    `UPDATE service_requests
     SET status = $1,
         resolved_by = CASE WHEN $2 THEN $3 ELSE resolved_by END,
         resolved_at = CASE WHEN $2 THEN now() ELSE resolved_at END,
         updated_at = now()
     WHERE id = $4
     RETURNING *`,
    [status, isResolved, resolvedBy, id]
  );
  return result.rows[0] || null;
};
