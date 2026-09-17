// src/controllers/doctorBookingController.js
const asyncHandler = require('express-async-handler');
const doctorBookingService = require('../services/doctorBookingService');

// @desc    List medical centers with doctors + weekly schedules nested
// @route   GET /api/medical-centers?includeInactive=
exports.listCenters = asyncHandler(async (req, res) => {
  const includeInactive = req.user.role === 'admin' && req.query.includeInactive === 'true';
  const centers = await doctorBookingService.listCenters({ includeInactive });
  res.status(200).json({ success: true, count: centers.length, data: centers });
});

// @desc    Admin: add a medical center
// @route   POST /api/medical-centers
exports.createCenter = asyncHandler(async (req, res) => {
  const { name, address, phone } = req.body;
  if (!name || !phone) {
    res.status(400);
    throw new Error('name and phone are required.');
  }
  const center = await doctorBookingService.createCenter({ name, address, phone });
  res.status(201).json({ success: true, data: center });
});

// @desc    Admin: deactivate/reactivate a center
// @route   PATCH /api/medical-centers/:id/active
exports.setCenterActive = asyncHandler(async (req, res) => {
  const { active } = req.body;
  if (typeof active !== 'boolean') {
    res.status(400);
    throw new Error('active (boolean) is required.');
  }
  const center = await doctorBookingService.setCenterActive(req.params.id, active);
  if (!center) {
    res.status(404);
    throw new Error(`Center '${req.params.id}' not found.`);
  }
  res.status(200).json({ success: true, data: center });
});

// @desc    Admin: add a doctor to a center
// @route   POST /api/medical-centers/:id/doctors
exports.createDoctor = asyncHandler(async (req, res) => {
  const { name, specialization } = req.body;
  if (!name) {
    res.status(400);
    throw new Error('name is required.');
  }
  const doctor = await doctorBookingService.createDoctor({ centerId: req.params.id, name, specialization });
  res.status(201).json({ success: true, data: doctor });
});

// @desc    Admin: deactivate/reactivate a doctor
// @route   PATCH /api/doctors/:id/active
exports.setDoctorActive = asyncHandler(async (req, res) => {
  const { active } = req.body;
  if (typeof active !== 'boolean') {
    res.status(400);
    throw new Error('active (boolean) is required.');
  }
  const doctor = await doctorBookingService.setDoctorActive(req.params.id, active);
  if (!doctor) {
    res.status(404);
    throw new Error(`Doctor '${req.params.id}' not found.`);
  }
  res.status(200).json({ success: true, data: doctor });
});

// @desc    Admin: set a doctor's weekly schedule (replaces it wholesale)
// @route   PUT /api/doctors/:id/schedule   Body: { slots: [{ dayOfWeek, startTime, endTime }] }
exports.setDoctorSchedule = asyncHandler(async (req, res) => {
  const { slots } = req.body;
  if (!Array.isArray(slots)) {
    res.status(400);
    throw new Error('slots must be an array of { dayOfWeek, startTime, endTime }.');
  }
  const schedule = await doctorBookingService.setDoctorSchedule(req.params.id, slots);
  res.status(200).json({ success: true, data: schedule });
});
