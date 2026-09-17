// src/services/customerService.js
//
// Admin-side customer management (FR-1.2: "Confirm if Admin should also be
// able to create customer accounts" — resolved yes). Deliberately separate
// from userService/userController, which back the pre-existing generic
// "members" demo feature (AI-agent create_user tool, /user-list screen) —
// keeping them apart means neither can accidentally change the other's
// behavior.
const User = require('../models/User');

// Create a customer account on a caller's behalf — e.g. staff walking a
// phone-order customer through checkout verbally. `role` is hardcoded to
// 'customer' here, never taken from the request, for the same reason as
// self-registration: this must never be a path to creating an admin.
exports.createCustomer = async ({ name, email, password, phone }) => {
  const existing = await User.findOne({ email });
  if (existing) {
    const err = new Error('A user with that email already exists.');
    err.status = 409;
    throw err;
  }

  const user = await User.create({ name, email, password, phone, role: 'customer' });
  return user;
};

exports.listCustomers = async ({ search } = {}) => {
  const query = { role: 'customer' };
  if (search) {
    const rx = new RegExp(search, 'i');
    query.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }
  return User.find(query, { name: 1, email: 1, phone: 1, createdAt: 1 }).sort({ createdAt: -1 });
};
