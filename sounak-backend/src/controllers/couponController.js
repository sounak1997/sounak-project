// src/controllers/couponController.js
const asyncHandler = require('express-async-handler');
const couponService = require('../services/couponService');

// @desc    Admin creates a coupon — FR-2.5
// @route   POST /api/coupons
exports.createCoupon = asyncHandler(async (req, res) => {
  const { code, discountType, value, minCartValue, usageLimit, validFrom, validTo } = req.body;

  if (!code || !discountType || value === undefined) {
    res.status(400);
    throw new Error('code, discountType and value are required.');
  }
  if (!['percentage', 'flat'].includes(discountType)) {
    res.status(400);
    throw new Error('discountType must be "percentage" or "flat".');
  }
  if (Number(value) <= 0) {
    res.status(400);
    throw new Error('value must be greater than 0.');
  }

  let coupon;
  try {
    coupon = await couponService.createCoupon({
      code, discountType, value, minCartValue, usageLimit, validFrom, validTo,
      createdBy: String(req.user._id),
    });
  } catch (err) {
    res.status(err.status || 500);
    throw err;
  }

  res.status(201).json({ success: true, data: coupon });
});

// @desc    Admin lists all coupons, with redemption counts — FR-2.7
// @route   GET /api/coupons
exports.listCoupons = asyncHandler(async (req, res) => {
  const coupons = await couponService.listCoupons();
  res.status(200).json({ success: true, count: coupons.length, data: coupons });
});

// @desc    Admin edits a coupon — FR-2.6
// @route   PUT /api/coupons/:id
exports.updateCoupon = asyncHandler(async (req, res) => {
  const { discountType, value, minCartValue, usageLimit, validFrom, validTo } = req.body;

  let coupon;
  try {
    coupon = await couponService.updateCoupon(req.params.id, {
      discountType, value, minCartValue, usageLimit, validFrom, validTo,
    });
  } catch (err) {
    res.status(err.status || 500);
    throw err;
  }

  if (!coupon) {
    res.status(404);
    throw new Error(`Coupon '${req.params.id}' not found.`);
  }
  res.status(200).json({ success: true, data: coupon });
});

// @desc    Admin deactivates/reactivates a coupon — FR-2.6
// @route   PATCH /api/coupons/:id/active
exports.setActive = asyncHandler(async (req, res) => {
  const { active } = req.body;
  if (typeof active !== 'boolean') {
    res.status(400);
    throw new Error('active (boolean) is required.');
  }

  const coupon = await couponService.setCouponActive(req.params.id, active);
  if (!coupon) {
    res.status(404);
    throw new Error(`Coupon '${req.params.id}' not found.`);
  }
  res.status(200).json({ success: true, data: coupon });
});

// @desc    Customer previews a coupon against their cart subtotal — FR-3.5
// @route   POST /api/coupons/validate
// @access  Private (customer) — does NOT redeem/increment times_used; that
// only happens when the order is actually placed (see orderService).
exports.validateCoupon = asyncHandler(async (req, res) => {
  const { code, cartSubtotal } = req.body;
  if (!code || cartSubtotal === undefined) {
    res.status(400);
    throw new Error('code and cartSubtotal are required.');
  }

  let result;
  try {
    result = await couponService.validateCoupon(code, Number(cartSubtotal));
  } catch (err) {
    res.status(err.status || 500);
    throw err;
  }

  res.status(200).json({
    success: true,
    data: {
      code: result.coupon.code,
      discountType: result.coupon.discount_type,
      discountAmount: result.discountAmount,
      total: Math.round((Number(cartSubtotal) - result.discountAmount) * 100) / 100,
    },
  });
});
