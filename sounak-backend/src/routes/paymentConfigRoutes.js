// src/routes/paymentConfigRoutes.js
const express = require('express');
const router = express.Router();
const passport = require('passport');
const { requireRole } = require('../middleware/roleMiddleware');
const { upload } = require('../utils/imageUpload');
const paymentConfigController = require('../controllers/paymentConfigController');

const requireAuth = passport.authenticate('jwt', { session: false });
const requireAdmin = [requireAuth, requireRole('admin')];

router.get('/qr', requireAuth, paymentConfigController.getQr);
router.post('/qr', requireAdmin, upload.single('image'), paymentConfigController.uploadQr);

module.exports = router;
