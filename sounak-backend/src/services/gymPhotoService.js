// src/services/gymPhotoService.js
//
// Member photos, stored as bytes in Postgres. See the MEMBER PHOTOS note in
// src/db/schema_gym.sql for why not on disk — briefly: Render's filesystem is
// ephemeral, so an uploaded file survives until the next restart and no longer,
// which is a failure that shows up weeks later as missing pictures.
//
// Every image is re-encoded before it is stored. A phone camera photo arrives
// several megabytes, often rotated by EXIF orientation that only some viewers
// honour; sharp normalises both, so what comes back out is small, upright and
// always webp regardless of what went in.
const crypto = require('crypto');
const sharp = require('sharp');
const multer = require('multer');
const pgPool = require('../config/pg.config');

// 400px is a face at a comfortable size on a phone and in the member table,
// and keeps a stored photo to roughly 20-40 KB.
const PHOTO_WIDTH = 400;

const err = (statusCode, message) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

/**
 * multer into memory: the buffer goes to sharp and then to Postgres, so it
 * never touches the filesystem at any point.
 *
 * The 8MB cap is on the RAW upload, before compression — a modern phone photo
 * is 3-6MB, so this accepts a real camera capture while refusing something
 * that is not a photo at all.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(err(400, 'That file is not an image.'));
    }
    cb(null, true);
  },
});

exports.upload = upload;

/**
 * Store (or replace) a member's photo.
 *
 * A fresh photo_id is minted every time, so the old URL stops resolving and
 * any cached copy is bypassed — which is what lets the image be served with a
 * far-future cache header.
 */
exports.savePhoto = async ({ gymId, memberId, buffer, updatedBy }) => {
  const member = await pgPool.query(
    'SELECT id FROM gym_members WHERE id = $1 AND gym_id = $2',
    [memberId, gymId]
  );
  if (!member.rows[0]) throw err(404, 'Member not found.');

  let webp;
  try {
    webp = await sharp(buffer)
      // rotate() with no argument applies the EXIF orientation and strips it,
      // which is why a photo taken in portrait does not arrive sideways.
      .rotate()
      .resize({ width: PHOTO_WIDTH, height: PHOTO_WIDTH, fit: 'cover', position: 'attention' })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    throw err(400, 'That image could not be read. Please try another photo.');
  }

  const photoId = crypto.randomBytes(16).toString('hex');

  const client = await pgPool.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO gym_member_photos (member_id, gym_id, photo_id, mime, bytes, byte_size, updated_by)
       VALUES ($1, $2, $3, 'image/webp', $4, $5, $6)
       ON CONFLICT (member_id) DO UPDATE SET
         photo_id   = EXCLUDED.photo_id,
         mime       = EXCLUDED.mime,
         bytes      = EXCLUDED.bytes,
         byte_size  = EXCLUDED.byte_size,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()`,
      [memberId, gymId, photoId, webp, webp.length, updatedBy]
    );
    // Mirrored onto gym_members so the member list can build image URLs without
    // joining a table full of image bytes.
    await client.query('UPDATE gym_members SET photo_id = $1, updated_at = now() WHERE id = $2', [
      photoId,
      memberId,
    ]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return { photoId, byteSize: webp.length, url: `/api/gym/members/photo/${photoId}` };
};

exports.deletePhoto = async ({ gymId, memberId }) => {
  const client = await pgPool.pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      'DELETE FROM gym_member_photos WHERE member_id = $1 AND gym_id = $2 RETURNING member_id',
      [memberId, gymId]
    );
    await client.query('UPDATE gym_members SET photo_id = NULL, updated_at = now() WHERE id = $1 AND gym_id = $2', [
      memberId,
      gymId,
    ]);
    await client.query('COMMIT');
    return { removed: r.rowCount };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

/**
 * Fetch by photo_id alone — no gym, no member, no auth.
 *
 * The id is 128 random bits and changes on every replacement, so knowing it is
 * the permission. This is what allows a plain <img src> to work in the owner's
 * console and on the door screen alike, neither of which can attach a bearer
 * token to an image request.
 */
exports.getPhotoBytes = async (photoId) => {
  const result = await pgPool.query(
    'SELECT mime, bytes FROM gym_member_photos WHERE photo_id = $1',
    [photoId]
  );
  return result.rows[0] || null;
};
