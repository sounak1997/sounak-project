// src/controllers/doctorBookingController.js
const asyncHandler = require('express-async-handler');
const doctorBookingService = require('../services/doctorBookingService');
const { readFields, fieldError } = require('../utils/formFields');

// What the admin panel's center and doctor forms send, field by field.
const CENTER_FIELDS = {
  name: { key: 'name', label: 'Name', type: 'text', required: true },
  address: { key: 'address', label: 'Address', type: 'text' },
  phone: { key: 'phone', label: 'Phone', type: 'phone', required: true },
  map_url: { key: 'mapUrl', label: 'Map link', type: 'link' },
  photo_url: { key: 'photoUrl', label: 'Photo', type: 'image' },
};

const DOCTOR_FIELDS = {
  name: { key: 'name', label: 'Name', type: 'text', required: true },
  specialization: { key: 'specialization', label: 'Specialization', type: 'text' },
  qualification: { key: 'qualification', label: 'Degree', type: 'text' },
  experience_years: { key: 'experienceYears', label: 'Experience', type: 'integer' },
  consultation_fee: { key: 'consultationFee', label: 'Consultation fee', type: 'number' },
  registration_no: { key: 'registrationNo', label: 'Registration number', type: 'text' },
  languages: { key: 'languages', label: 'Languages', type: 'text' },
  about: { key: 'about', label: 'About', type: 'text' },
  photo_url: { key: 'photoUrl', label: 'Photo', type: 'image' },
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/**
 * Validate a weekly schedule: [{ dayOfWeek: 0-6, startTime: 'HH:MM', endTime }].
 * A day may have several slots (a morning and an evening sitting), but they
 * must not overlap — two overlapping rows would show the patient a doctor
 * "in" twice at once. Returns undefined when the body has no `slots` at all.
 */
function readSlots(slots) {
  if (slots === undefined) return undefined;
  if (!Array.isArray(slots)) throw fieldError('slots must be a list of { dayOfWeek, startTime, endTime }.');

  const cleaned = slots.map((slot) => {
    const dayOfWeek = Number(slot?.dayOfWeek);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw fieldError('Each time slot needs a day of the week.');
    }
    const day = DAY_NAMES[dayOfWeek];
    if (!TIME.test(slot.startTime || '') || !TIME.test(slot.endTime || '')) {
      throw fieldError(`${day}: start and end times must be like 09:30.`);
    }
    const startTime = slot.startTime.slice(0, 5);
    const endTime = slot.endTime.slice(0, 5);
    if (endTime <= startTime) throw fieldError(`${day}: the end time must be after the start time.`);
    return { dayOfWeek, startTime, endTime };
  });

  const sorted = [...cleaned].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const slot = sorted[i];
    if (slot.dayOfWeek === prev.dayOfWeek && slot.startTime < prev.endTime) {
      throw fieldError(`${DAY_NAMES[slot.dayOfWeek]}: two time slots overlap.`);
    }
  }
  return cleaned;
}

const notFound = (res, what, id) => {
  res.status(404);
  throw new Error(`${what} '${id}' not found.`);
};

// @desc    List medical centers with doctors + weekly schedules nested
// @route   GET /api/medical-centers?includeInactive=
exports.listCenters = asyncHandler(async (req, res) => {
  const includeInactive = req.user.role === 'admin' && req.query.includeInactive === 'true';
  const centers = await doctorBookingService.listCenters({ includeInactive });
  res.status(200).json({ success: true, count: centers.length, data: centers });
});

// @desc    Admin: one center, for its edit form
// @route   GET /api/medical-centers/:id
exports.getCenter = asyncHandler(async (req, res) => {
  const center = await doctorBookingService.getCenter(req.params.id);
  if (!center) notFound(res, 'Center', req.params.id);
  res.status(200).json({ success: true, data: center });
});

// @desc    Admin: add a medical center
// @route   POST /api/medical-centers
exports.createCenter = asyncHandler(async (req, res) => {
  const fields = readFields(req.body, CENTER_FIELDS, { partial: false });
  const center = await doctorBookingService.createCenter(fields);
  res.status(201).json({ success: true, data: center });
});

// @desc    Admin: edit a medical center
// @route   PUT /api/medical-centers/:id
exports.updateCenter = asyncHandler(async (req, res) => {
  const fields = readFields(req.body, CENTER_FIELDS, { partial: true });
  const center = await doctorBookingService.updateCenter(req.params.id, fields);
  if (!center) notFound(res, 'Center', req.params.id);
  res.status(200).json({ success: true, data: center });
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
  if (!center) notFound(res, 'Center', req.params.id);
  res.status(200).json({ success: true, data: center });
});

// @desc    Admin: add a doctor to a center, optionally with their schedule
// @route   POST /api/medical-centers/:id/doctors
//          Body: doctor fields + optional slots: [{ dayOfWeek, startTime, endTime }]
exports.createDoctor = asyncHandler(async (req, res) => {
  const fields = readFields(req.body, DOCTOR_FIELDS, { partial: false });
  const slots = readSlots(req.body.slots);
  const doctor = await doctorBookingService.createDoctor({ centerId: req.params.id, slots, ...fields });
  res.status(201).json({ success: true, data: doctor });
});

// @desc    Admin: one doctor with their schedule, for the edit form
// @route   GET /api/doctors/:id
exports.getDoctor = asyncHandler(async (req, res) => {
  const doctor = await doctorBookingService.getDoctor(req.params.id);
  if (!doctor) notFound(res, 'Doctor', req.params.id);
  res.status(200).json({ success: true, data: doctor });
});

// @desc    Admin: edit a doctor; `slots`, if sent, replaces their schedule
// @route   PUT /api/doctors/:id
exports.updateDoctor = asyncHandler(async (req, res) => {
  const fields = readFields(req.body, DOCTOR_FIELDS, { partial: true });
  const slots = readSlots(req.body.slots);
  const doctor = await doctorBookingService.updateDoctor(req.params.id, { slots, ...fields });
  if (!doctor) notFound(res, 'Doctor', req.params.id);
  res.status(200).json({ success: true, data: doctor });
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
  if (!doctor) notFound(res, 'Doctor', req.params.id);
  res.status(200).json({ success: true, data: doctor });
});

// @desc    Admin: set a doctor's weekly schedule (replaces it wholesale)
// @route   PUT /api/doctors/:id/schedule   Body: { slots: [{ dayOfWeek, startTime, endTime }] }
exports.setDoctorSchedule = asyncHandler(async (req, res) => {
  const slots = readSlots(req.body.slots);
  if (!slots) {
    res.status(400);
    throw new Error('slots must be an array of { dayOfWeek, startTime, endTime }.');
  }
  const schedule = await doctorBookingService.setDoctorSchedule(req.params.id, slots);
  res.status(200).json({ success: true, data: schedule });
});
