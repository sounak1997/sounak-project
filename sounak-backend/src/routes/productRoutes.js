// src/routes/productRoutes.js
const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');

// 1. GET /api/products (List endpoint must come first)
router.get('/list', productController.getProductsList);

// 2. GET /api/products/:id (Details endpoint)
router.get('/:id/info', productController.getProductInfo);
router.get('/:id', productController.getProductDetails);


module.exports = router;