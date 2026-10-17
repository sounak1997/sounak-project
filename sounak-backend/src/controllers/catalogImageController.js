// src/controllers/catalogImageController.js
const asyncHandler = require('express-async-handler');
const catalogImageService = require('../services/catalogImageService');

// How wide each kind of image is kept. A product photo is the hero of its
// detail page; a face or a clinic front is shown small; a QR has to stay sharp
// enough for a phone camera to read off another screen.
const MAX_WIDTH = { product: 1024, photo: 600, qr: 800 };

// @desc    Admin: store an image, get back the URL to save on a record
// @route   POST /api/images?kind=product|photo|qr   multipart/form-data, field "image"
exports.uploadImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error('No file was uploaded. Attach an image in the "image" field.');
  }
  const maxWidth = MAX_WIDTH[req.query.kind] || MAX_WIDTH.product;

  let url;
  try {
    url = await catalogImageService.saveImage({
      buffer: req.file.buffer,
      maxWidth,
      createdBy: String(req.user._id),
    });
  } catch (error) {
    // sharp throws on bytes that claim to be an image and are not.
    if (/unsupported image format|Input buffer/i.test(error.message)) {
      res.status(400);
      throw new Error('That file could not be read as an image.');
    }
    throw error;
  }
  res.status(201).json({ success: true, data: { url } });
});

// @desc    Public: the image bytes. No auth — an <img> tag cannot send a token,
//          and catalogue photos are what every customer is meant to see.
// @route   GET /images/:id
exports.serveImage = asyncHandler(async (req, res) => {
  // Ids are 32 hex characters; anything else cannot exist, so skip the query.
  const image = /^[a-f0-9]{32}$/.test(req.params.id)
    ? await catalogImageService.getImage(req.params.id)
    : null;
  if (!image) {
    res.status(404).end();
    return;
  }
  // The id changes whenever an image is replaced, so a URL's bytes never do.
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.type(image.mime).send(image.bytes);
});
