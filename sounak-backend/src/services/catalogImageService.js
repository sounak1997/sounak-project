// src/services/catalogImageService.js
//
// Catalogue images (product photos, doctor / clinic / lab photos, the payment
// QR), stored as bytes in Postgres and served from GET /images/:id. See the
// catalog_images note in src/db/schema.sql for why not on disk — briefly:
// Render's filesystem is ephemeral, so an uploaded file lasts until the next
// restart and no longer.
//
// Uploading and attaching are two separate steps. An upload only stores the
// bytes and hands back a URL; the product / doctor / lab form then saves that
// URL like any other field. That lets the admin add photos while creating
// something, before it has an id, and keeps one upload path for every kind of
// record instead of one per table.
const crypto = require('crypto');
const sharp = require('sharp');
const pgPool = require('../config/pg.config');

const URL_PREFIX = '/images/';

/**
 * Re-encode and store one image, returning the URL path to save on a record.
 *
 * Everything leaves as webp at no more than `maxWidth` wide. `rotate()` with no
 * argument applies the EXIF orientation, so a phone photo taken sideways is
 * stored upright rather than relying on every viewer to honour the tag.
 */
exports.saveImage = async ({ buffer, maxWidth = 1024, createdBy = null }) => {
  const bytes = await sharp(buffer)
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  const id = crypto.randomBytes(16).toString('hex');
  await pgPool.query(
    `INSERT INTO catalog_images (id, mime, bytes, byte_size, created_by)
     VALUES ($1, 'image/webp', $2, $3, $4)`,
    [id, bytes, bytes.length, createdBy]
  );
  return `${URL_PREFIX}${id}`;
};

exports.getImage = async (id) => {
  const result = await pgPool.query('SELECT mime, bytes FROM catalog_images WHERE id = $1', [id]);
  return result.rows[0] || null;
};

/** The catalog_images id inside a /images/<id> path, or null for anything else. */
const idFromUrl = (url) =>
  typeof url === 'string' && url.startsWith(URL_PREFIX) ? url.slice(URL_PREFIX.length) : null;

/**
 * Image URLs a record may hold: a path this backend serves, either a stored
 * image (/images/…) or one of the committed catalogue files (/uploads/…).
 * The customer screens prefix every image path with the API origin, so an
 * outside https:// link would render as a broken image — refusing it here
 * says so at save time instead.
 */
exports.isValidImageUrl = (url) =>
  typeof url === 'string' && /^\/(images|uploads)\/[\w.\-/]+$/.test(url) && !url.includes('..');

/**
 * Delete stored images that nothing points at any more. Called after a record
 * drops or replaces a photo.
 *
 * Checks every table that can hold an image URL before deleting, so an image
 * that happens to be shared (the same photo on two pack sizes, say) is only
 * removed once the last reference goes. Best-effort: a failure leaves an
 * orphaned row, which costs a few KB and nothing else, so it is logged rather
 * than surfaced to the admin whose save already succeeded.
 */
exports.releaseImages = async (urls) => {
  for (const url of urls) {
    const id = idFromUrl(url);
    if (!id) continue;
    try {
      await pgPool.query(
        `DELETE FROM catalog_images
         WHERE id = $1
           AND NOT EXISTS (SELECT 1 FROM products WHERE image_urls @> to_jsonb($2::text))
           AND NOT EXISTS (SELECT 1 FROM doctors WHERE photo_url = $2)
           AND NOT EXISTS (SELECT 1 FROM medical_centers WHERE photo_url = $2)
           AND NOT EXISTS (SELECT 1 FROM labs WHERE photo_url = $2)
           AND NOT EXISTS (SELECT 1 FROM payment_config WHERE qr_image_url = $2)`,
        [id, url]
      );
    } catch (error) {
      console.error(`[catalog-images] could not release ${url}:`, error.message);
    }
  }
};
