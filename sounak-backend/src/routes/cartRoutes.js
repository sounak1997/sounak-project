// src/routes/cartRoutes.js
const express = require('express');
const router = express.Router();
const passport = require('passport');
const cartController = require('../controllers/cartController');

const requireAuth = passport.authenticate('jwt', { session: false });

router.get('/', requireAuth, cartController.getCart);
router.post('/items', requireAuth, cartController.addItem);
router.put('/items/:productId', requireAuth, cartController.updateItemQuantity);
router.delete('/items/:productId', requireAuth, cartController.removeItem);

module.exports = router;
