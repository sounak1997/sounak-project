// src/routes/catalogImageRoutes.js
// Mounted at /api/images. Serving is NOT here: GET /images/:id sits outside
// /api in server.js, so a product grid's forty thumbnails don't count against
// the per-IP API rate limit.
const express = require('express');
const router = express.Router();
const passport = require('passport');
const { requireRole } = require('../middleware/roleMiddleware');
const { singleImage } = require('../utils/imageUpload');
const catalogImageController = require('../controllers/catalogImageController');

const requireAdmin = [passport.authenticate('jwt', { session: false }), requireRole('admin')];

router.post('/', requireAdmin, singleImage('image'), catalogImageController.uploadImage);

module.exports = router;
