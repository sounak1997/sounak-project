// src/routes/doctorRoutes.js
// Separate from medicalCenterRoutes because these two act directly on a
// doctor by id, not scoped under a center's path.
const express = require('express');
const router = express.Router();
const passport = require('passport');
const { requireRole } = require('../middleware/roleMiddleware');
const doctorBookingController = require('../controllers/doctorBookingController');

const requireAdmin = [passport.authenticate('jwt', { session: false }), requireRole('admin')];

router.patch('/:id/active', requireAdmin, doctorBookingController.setDoctorActive);
router.put('/:id/schedule', requireAdmin, doctorBookingController.setDoctorSchedule);

module.exports = router;
