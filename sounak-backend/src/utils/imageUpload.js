// src/utils/imageUpload.js
//
// Shared image handling for product photos and the payment QR (NFR-3:
// "Product images and the QR image are compressed/resized on upload").
// multer parses the multipart body into memory; sharp then re-encodes to a
// capped size before anything touches disk, so a customer's phone photo
// (often several MB, wrong orientation) never gets served back as-is.
//
// Storage is the local filesystem under UPLOADS_DIR, served statically by
// this same Express app (see server.js) — there's no S3/cloud storage
// configured, which fits the current single-EC2-instance deployment. If this
// ever runs across multiple instances or in a container without a persistent
// volume, UPLOADS_DIR needs to point at shared/durable storage instead.
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB raw upload cap, pre-compression
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed.'));
    }
    cb(null, true);
  },
});

/**
 * Resize/compress an in-memory image buffer and save it under
 * UPLOADS_DIR/<subdir>/, returning the public URL path to store in Postgres.
 *
 * @param {Buffer} buffer   raw upload from multer memoryStorage
 * @param {string} subdir   e.g. 'products' or 'payment-qr'
 * @param {number} maxWidth resize cap (aspect ratio preserved, never upscaled)
 */
async function saveResizedImage(buffer, subdir, maxWidth = 1024) {
  const dir = path.join(UPLOADS_DIR, subdir);
  await fs.mkdir(dir, { recursive: true });

  const filename = `${crypto.randomUUID()}.webp`;
  const filePath = path.join(dir, filename);

  await sharp(buffer)
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(filePath);

  return `/uploads/${subdir}/${filename}`;
}

/** Delete a previously-saved upload given its public URL path (best-effort). */
async function deleteUploadedImage(urlPath) {
  if (!urlPath || !urlPath.startsWith('/uploads/')) return;
  const filePath = path.join(UPLOADS_DIR, urlPath.replace('/uploads/', ''));
  await fs.unlink(filePath).catch(() => {}); // ignore if already gone
}

module.exports = { upload, saveResizedImage, deleteUploadedImage, UPLOADS_DIR };
