// src/controllers/cartController.js
const asyncHandler = require('express-async-handler');
const cartService = require('../services/cartService');

// @desc    Get the logged-in customer's cart — FR-3.4
// @route   GET /api/cart
exports.getCart = asyncHandler(async (req, res) => {
  const cart = await cartService.getCart(String(req.user._id));
  res.status(200).json({ success: true, data: cart });
});

// @desc    Add an item to the cart — FR-3.3
// @route   POST /api/cart/items   Body: { productId, quantity? }
exports.addItem = asyncHandler(async (req, res) => {
  const { productId, quantity } = req.body;
  if (!productId) {
    res.status(400);
    throw new Error('productId is required.');
  }

  let cart;
  try {
    cart = await cartService.addItem(String(req.user._id), productId, quantity ? Number(quantity) : 1);
  } catch (err) {
    res.status(err.status || 500);
    throw err;
  }
  res.status(200).json({ success: true, data: cart });
});

// @desc    Set an item's quantity (0 removes it) — FR-3.3
// @route   PUT /api/cart/items/:productId   Body: { quantity }
exports.updateItemQuantity = asyncHandler(async (req, res) => {
  const { quantity } = req.body;
  if (quantity === undefined || Number.isNaN(Number(quantity))) {
    res.status(400);
    throw new Error('quantity is required.');
  }

  let cart;
  try {
    cart = await cartService.updateItemQuantity(String(req.user._id), req.params.productId, Number(quantity));
  } catch (err) {
    res.status(err.status || 500);
    throw err;
  }
  res.status(200).json({ success: true, data: cart });
});

// @desc    Remove an item from the cart — FR-3.3
// @route   DELETE /api/cart/items/:productId
exports.removeItem = asyncHandler(async (req, res) => {
  const cart = await cartService.removeItem(String(req.user._id), req.params.productId);
  res.status(200).json({ success: true, data: cart });
});
