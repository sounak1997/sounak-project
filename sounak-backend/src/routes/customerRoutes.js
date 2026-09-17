// src/routes/customerRoutes.js
const express = require('express');
const router = express.Router();
const passport = require('passport');
const { requireRole } = require('../middleware/roleMiddleware');
const customerController = require('../controllers/customerController');

const requireAuth = passport.authenticate('jwt', { session: false });
const requireAdmin = [requireAuth, requireRole('admin')];

// Admin-only: create/list customer accounts directly (FR-1.2).
router.post('/', requireAdmin, customerController.createCustomer);
router.get('/', requireAdmin, customerController.listCustomers);

module.exports = router;
