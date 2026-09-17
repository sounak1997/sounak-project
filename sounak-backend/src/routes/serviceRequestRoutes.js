// src/routes/serviceRequestRoutes.js
const express = require('express');
const router = express.Router();
const passport = require('passport');
const { requireRole } = require('../middleware/roleMiddleware');
const serviceRequestController = require('../controllers/serviceRequestController');

const requireAuth = passport.authenticate('jwt', { session: false });
const requireAdmin = [requireAuth, requireRole('admin')];

// Customer (FR-3.10 / FR-3.11). 'mine' must come before '/:id' routes.
router.post('/', requireAuth, serviceRequestController.createAssistanceRequest);
router.get('/mine', requireAuth, serviceRequestController.listOwnRequests);

// Admin queue (FR-2.13 / FR-2.14).
router.get('/', requireAdmin, serviceRequestController.listRequests);
router.patch('/:id/status', requireAdmin, serviceRequestController.setStatus);

module.exports = router;
