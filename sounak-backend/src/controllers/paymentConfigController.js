// src/controllers/paymentConfigController.js
const asyncHandler = require('express-async-handler');
const paymentConfigService = require('../services/paymentConfigService');
const catalogImageService = require('../services/catalogImageService');
const { deleteUploadedImage } = require('../utils/imageUpload');

// @desc    Get the current live payment QR — shown to customers at checkout (FR-3.8)
// @route   GET /api/payment-config/qr
exports.getQr = asyncHandler(async (req, res) => {
  const config = await paymentConfigService.getCurrentQr();
  res.status(200).json({ success: true, data: config });
});

// @desc    Admin uploads/replaces the live QR image — FR-2.8, FR-2.9, NFR-3
// @route   POST /api/payment-config/qr   multipart/form-data, field "image"
exports.uploadQr = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error('No file was uploaded. Attach an image in the "image" field.');
  }

  const previous = await paymentConfigService.getCurrentQr();
  // Stored in Postgres, not uploads/: on Render's ephemeral disk a QR saved as a
  // file vanished on the next restart, and checkout showed a broken image.
  const imageUrl = await catalogImageService.saveImage({
    buffer: req.file.buffer,
    maxWidth: 800,
    createdBy: String(req.user._id),
  });
  const config = await paymentConfigService.setQr(imageUrl, String(req.user._id));

  // Best-effort cleanup of the old image now that it's no longer referenced —
  // only one QR is ever "live" (FR-2.9). An older QR may still be a file.
  if (previous.qr_image_url) {
    deleteUploadedImage(previous.qr_image_url).catch(() => {});
    await catalogImageService.releaseImages([previous.qr_image_url]);
  }

  res.status(200).json({ success: true, data: config });
});
