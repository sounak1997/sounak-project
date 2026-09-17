// src/controllers/customerController.js
const asyncHandler = require('express-async-handler');
const customerService = require('../services/customerService');

// @desc    Admin creates a customer account directly
// @route   POST /api/customers
// @access  Private (admin)
exports.createCustomer = asyncHandler(async (req, res) => {
  const { name, email, password, phone } = req.body;

  if (!name || !email || !password) {
    res.status(400);
    throw new Error('name, email and password are required.');
  }

  let user;
  try {
    user = await customerService.createCustomer({ name, email, password, phone });
  } catch (err) {
    // The errorMiddleware reads res.statusCode (set here), not err.status —
    // same convention as the rest of authController.
    res.status(err.status || 500);
    throw err;
  }

  res.status(201).json({
    success: true,
    data: {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
    },
  });
});

// @desc    Admin lists customer accounts (optionally filtered)
// @route   GET /api/customers?search=
// @access  Private (admin)
exports.listCustomers = asyncHandler(async (req, res) => {
  const customers = await customerService.listCustomers({ search: req.query.search });
  res.status(200).json({ success: true, count: customers.length, data: customers });
});
