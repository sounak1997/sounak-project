// src/routes/couponRoutes.js
const express = require('express');
const router = express.Router();
const passport = require('passport');
const { requireRole } = require('../middleware/roleMiddleware');
const couponController = require('../controllers/couponController');

const requireAuth = passport.authenticate('jwt', { session: false });
const requireAdmin = [requireAuth, requireRole('admin')];

// Customer: preview a coupon at checkout (FR-3.5). Must come before '/:id'
// routes so 'validate' isn't swallowed as an :id.
router.post('/validate', requireAuth, couponController.validateCoupon);

// Admin: manage coupons (FR-2.5–FR-2.7).
router.post('/', requireAdmin, couponController.createCoupon);
router.get('/', requireAdmin, couponController.listCoupons);
router.put('/:id', requireAdmin, couponController.updateCoupon);
router.patch('/:id/active', requireAdmin, couponController.setActive);

module.exports = router;
