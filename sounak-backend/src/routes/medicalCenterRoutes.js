// src/routes/medicalCenterRoutes.js
const express = require('express');
const router = express.Router();
const passport = require('passport');
const { requireRole } = require('../middleware/roleMiddleware');
const doctorBookingController = require('../controllers/doctorBookingController');

const requireAuth = passport.authenticate('jwt', { session: false });
const requireAdmin = [requireAuth, requireRole('admin')];

router.get('/', requireAuth, doctorBookingController.listCenters);
router.post('/', requireAdmin, doctorBookingController.createCenter);
router.patch('/:id/active', requireAdmin, doctorBookingController.setCenterActive);
router.post('/:id/doctors', requireAdmin, doctorBookingController.createDoctor);

module.exports = router;
