// src/controllers/labTestController.js
const asyncHandler = require('express-async-handler');
const labTestService = require('../services/labTestService');
const { readFields } = require('../utils/formFields');

// What the admin panel's lab and test forms send, field by field.
const LAB_FIELDS = {
  name: { key: 'name', label: 'Name', type: 'text', required: true },
  address: { key: 'address', label: 'Address', type: 'text' },
  phone: { key: 'phone', label: 'Phone', type: 'phone', required: true },
  opening_hours: { key: 'openingHours', label: 'Opening hours', type: 'text' },
  accreditation: { key: 'accreditation', label: 'Accreditation', type: 'text' },
  map_url: { key: 'mapUrl', label: 'Map link', type: 'link' },
  photo_url: { key: 'photoUrl', label: 'Photo', type: 'image' },
};

const TEST_FIELDS = {
  name: { key: 'name', label: 'Name', type: 'text', required: true },
  price: { key: 'price', label: 'Price', type: 'number' },
  description: { key: 'description', label: 'Description', type: 'text' },
  sample_type: { key: 'sampleType', label: 'Sample type', type: 'text' },
  preparation: { key: 'preparation', label: 'Preparation', type: 'text' },
  report_time: { key: 'reportTime', label: 'Report time', type: 'text' },
};

const notFound = (res, what, id) => {
  res.status(404);
  throw new Error(`${what} '${id}' not found.`);
};

// @desc    List labs with their tests nested
// @route   GET /api/labs?includeInactive=
exports.listLabs = asyncHandler(async (req, res) => {
  const includeInactive = req.user.role === 'admin' && req.query.includeInactive === 'true';
  const labs = await labTestService.listLabs({ includeInactive });
  res.status(200).json({ success: true, count: labs.length, data: labs });
});

// @desc    Admin: one lab, for its edit form
// @route   GET /api/labs/:id
exports.getLab = asyncHandler(async (req, res) => {
  const lab = await labTestService.getLab(req.params.id);
  if (!lab) notFound(res, 'Lab', req.params.id);
  res.status(200).json({ success: true, data: lab });
});

// @desc    Admin: add a lab
// @route   POST /api/labs
exports.createLab = asyncHandler(async (req, res) => {
  const fields = readFields(req.body, LAB_FIELDS, { partial: false });
  const lab = await labTestService.createLab(fields);
  res.status(201).json({ success: true, data: lab });
});

// @desc    Admin: edit a lab
// @route   PUT /api/labs/:id
exports.updateLab = asyncHandler(async (req, res) => {
  const fields = readFields(req.body, LAB_FIELDS, { partial: true });
  const lab = await labTestService.updateLab(req.params.id, fields);
  if (!lab) notFound(res, 'Lab', req.params.id);
  res.status(200).json({ success: true, data: lab });
});

// @desc    Admin: deactivate/reactivate a lab
// @route   PATCH /api/labs/:id/active
exports.setLabActive = asyncHandler(async (req, res) => {
  const { active } = req.body;
  if (typeof active !== 'boolean') {
    res.status(400);
    throw new Error('active (boolean) is required.');
  }
  const lab = await labTestService.setLabActive(req.params.id, active);
  if (!lab) notFound(res, 'Lab', req.params.id);
  res.status(200).json({ success: true, data: lab });
});

// @desc    Admin: add a test to a lab
// @route   POST /api/labs/:id/tests
exports.createTest = asyncHandler(async (req, res) => {
  const fields = readFields(req.body, TEST_FIELDS, { partial: false });
  const test = await labTestService.createTest({ labId: req.params.id, ...fields });
  res.status(201).json({ success: true, data: test });
});

// @desc    Admin: one test, for its edit form
// @route   GET /api/tests/:id
exports.getTest = asyncHandler(async (req, res) => {
  const test = await labTestService.getTest(req.params.id);
  if (!test) notFound(res, 'Test', req.params.id);
  res.status(200).json({ success: true, data: test });
});

// @desc    Admin: edit a test
// @route   PUT /api/tests/:id
exports.updateTest = asyncHandler(async (req, res) => {
  const fields = readFields(req.body, TEST_FIELDS, { partial: true });
  const test = await labTestService.updateTest(req.params.id, fields);
  if (!test) notFound(res, 'Test', req.params.id);
  res.status(200).json({ success: true, data: test });
});

// @desc    Admin: deactivate/reactivate a test
// @route   PATCH /api/tests/:id/active
exports.setTestActive = asyncHandler(async (req, res) => {
  const { active } = req.body;
  if (typeof active !== 'boolean') {
    res.status(400);
    throw new Error('active (boolean) is required.');
  }
  const test = await labTestService.setTestActive(req.params.id, active);
  if (!test) notFound(res, 'Test', req.params.id);
  res.status(200).json({ success: true, data: test });
});
