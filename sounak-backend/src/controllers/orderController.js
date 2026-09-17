// src/controllers/orderController.js
const asyncHandler = require('express-async-handler');
const orderService = require('../services/orderService');

// @desc    Place an order from the cart — FR-3.6–FR-3.8
// @route   POST /api/orders   Body: { deliveryAddress, paymentMethod, couponCode?, paymentReference? }
exports.placeOrder = asyncHandler(async (req, res) => {
  const { deliveryAddress, paymentMethod, couponCode, paymentReference } = req.body;

  let order;
  try {
    order = await orderService.placeOrder(String(req.user._id), {
      deliveryAddress, paymentMethod, couponCode, paymentReference,
    });
  } catch (err) {
    res.status(err.status || 500);
    throw err;
  }

  res.status(201).json({ success: true, data: order });
});

// @desc    List orders — own orders for a customer (FR-3.9), all orders for
//          an admin (FR-2.10). Same endpoint, scoped by role.
// @route   GET /api/orders?status=&page=&limit=
exports.listOrders = asyncHandler(async (req, res) => {
  const { status, page, limit } = req.query;
  const isAdmin = req.user.role === 'admin';

  const { rows, pagination } = await orderService.listOrders({
    userId: isAdmin ? undefined : String(req.user._id),
    status,
    page,
    limit,
  });

  res.status(200).json({ success: true, count: rows.length, data: rows, pagination });
});

// @desc    Get one order — owner or admin (FR-3.9 / FR-2.10)
// @route   GET /api/orders/:id
exports.getOrder = asyncHandler(async (req, res) => {
  const order = await orderService.getOrderById(req.params.id);
  if (!order) {
    res.status(404);
    throw new Error(`Order '${req.params.id}' not found.`);
  }
  if (req.user.role !== 'admin' && order.user_id !== String(req.user._id)) {
    res.status(403);
    throw new Error('You do not have permission to view this order.');
  }

  const history = await orderService.getStatusHistory(order.id);
  res.status(200).json({ success: true, data: { ...order, history } });
});

// @desc    Admin updates order status — FR-2.11
// @route   PATCH /api/orders/:id/status   Body: { status }
exports.updateStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!status) {
    res.status(400);
    throw new Error('status is required.');
  }

  let order;
  try {
    order = await orderService.updateStatus(req.params.id, status, String(req.user._id));
  } catch (err) {
    res.status(err.status || 500);
    throw err;
  }
  res.status(200).json({ success: true, data: order });
});

// @desc    Admin marks a payment verified (QR) or collected (COD) — FR-2.12, NFR-2
// @route   PATCH /api/orders/:id/payment   Body: { paymentStatus }
exports.markPaymentStatus = asyncHandler(async (req, res) => {
  const { paymentStatus } = req.body;
  if (!paymentStatus) {
    res.status(400);
    throw new Error('paymentStatus is required.');
  }

  let order;
  try {
    order = await orderService.markPaymentStatus(req.params.id, paymentStatus, String(req.user._id));
  } catch (err) {
    res.status(err.status || 500);
    throw err;
  }
  res.status(200).json({ success: true, data: order });
});
