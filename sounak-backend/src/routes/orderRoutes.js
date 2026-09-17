// src/routes/orderRoutes.js
const express = require('express');
const router = express.Router();
const passport = require('passport');
const { requireRole } = require('../middleware/roleMiddleware');
const orderController = require('../controllers/orderController');

const requireAuth = passport.authenticate('jwt', { session: false });
const requireAdmin = [requireAuth, requireRole('admin')];

router.post('/', requireAuth, orderController.placeOrder);
router.get('/', requireAuth, orderController.listOrders); // scoped by role in the controller
router.get('/:id', requireAuth, orderController.getOrder); // owner-or-admin check in the controller
router.patch('/:id/status', requireAdmin, orderController.updateStatus);
router.patch('/:id/payment', requireAdmin, orderController.markPaymentStatus);

module.exports = router;
