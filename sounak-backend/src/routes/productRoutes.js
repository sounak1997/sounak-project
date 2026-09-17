// src/routes/productRoutes.js
const express = require('express');
const router = express.Router();
const passport = require('passport');
const { requireRole } = require('../middleware/roleMiddleware');
const { upload } = require('../utils/imageUpload');
const productController = require('../controllers/productController');

// Protected for the same reason as userRoutes: the AI agent reaches these
// through the caller's forwarded JWT, so the permission check has to be real.
const requireAuth = passport.authenticate('jwt', { session: false });
const requireAdmin = [requireAuth, requireRole('admin')];

// 1. GET /api/products/list (List endpoint must come first)
router.get('/list', requireAuth, productController.getProductsList);

// Admin: catalog management (FR-2.1–FR-2.4). These must come before the
// generic '/:id' routes below so 'list' etc. above already claimed their own
// path, and so these specific-method routes on '/:id' take precedence.
router.post('/', requireAdmin, productController.createProduct);
router.put('/:id', requireAdmin, productController.updateProduct);
router.patch('/:id/active', requireAdmin, productController.setActive);
router.patch('/:id/stock', requireAdmin, productController.setInStock);
router.post('/:id/image', requireAdmin, upload.single('image'), productController.uploadImage);

// 2. GET /api/products/:id (Details endpoints)
router.get('/:id/info', requireAuth, productController.getProductInfo);
router.get('/:id', requireAuth, productController.getProductDetails);

module.exports = router;
