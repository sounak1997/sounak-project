// src/services/paymentConfigService.js
//
// Single "live" QR image (FR-2.8 / FR-2.9) — payment_config is a one-row
// table (id is CHECK'd to always be 1), so "upload a new one" is just an
// UPDATE, never an INSERT: there's never more than one QR customers can see.
const pgPool = require('../config/pg.config');

exports.getCurrentQr = async () => {
  const result = await pgPool.query('SELECT qr_image_url, updated_by, updated_at FROM payment_config WHERE id = 1');
  return result.rows[0] || { qr_image_url: null, updated_by: null, updated_at: null };
};

exports.setQr = async (imageUrl, updatedBy) => {
  const result = await pgPool.query(
    `UPDATE payment_config SET qr_image_url = $1, updated_by = $2, updated_at = now() WHERE id = 1 RETURNING *`,
    [imageUrl, updatedBy]
  );
  return result.rows[0];
};
