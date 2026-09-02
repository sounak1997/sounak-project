// src/routes/productRoutes.js
const express = require('express');
const router = express.Router();
const passport = require('passport');
const productController = require('../controllers/productController');

// Protected for the same reason as userRoutes: the AI agent reaches these
// through the caller's forwarded JWT, so the permission check has to be real.
const requireAuth = passport.authenticate('jwt', { session: false });

// 1. GET /api/products/list (List endpoint must come first)
router.get('/list', requireAuth, productController.getProductsList);

// 2. GET /api/products/:id (Details endpoints)
router.get('/:id/info', requireAuth, productController.getProductInfo);
router.get('/:id', requireAuth, productController.getProductDetails);

module.exports = router;
