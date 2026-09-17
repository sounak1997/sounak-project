// src/controllers/labTestController.js
const asyncHandler = require('express-async-handler');
const labTestService = require('../services/labTestService');

// @desc    List labs with their tests nested
// @route   GET /api/labs?includeInactive=
exports.listLabs = asyncHandler(async (req, res) => {
  const includeInactive = req.user.role === 'admin' && req.query.includeInactive === 'true';
  const labs = await labTestService.listLabs({ includeInactive });
  res.status(200).json({ success: true, count: labs.length, data: labs });
});

// @desc    Admin: add a lab
// @route   POST /api/labs
exports.createLab = asyncHandler(async (req, res) => {
  const { name, address, phone } = req.body;
  if (!name || !phone) {
    res.status(400);
    throw new Error('name and phone are required.');
  }
  const lab = await labTestService.createLab({ name, address, phone });
  res.status(201).json({ success: true, data: lab });
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
  if (!lab) {
    res.status(404);
    throw new Error(`Lab '${req.params.id}' not found.`);
  }
  res.status(200).json({ success: true, data: lab });
});

// @desc    Admin: add a test to a lab
// @route   POST /api/labs/:id/tests
exports.createTest = asyncHandler(async (req, res) => {
  const { name, price, description } = req.body;
  if (!name) {
    res.status(400);
    throw new Error('name is required.');
  }
  const test = await labTestService.createTest({ labId: req.params.id, name, price, description });
  res.status(201).json({ success: true, data: test });
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
  if (!test) {
    res.status(404);
    throw new Error(`Test '${req.params.id}' not found.`);
  }
  res.status(200).json({ success: true, data: test });
});
