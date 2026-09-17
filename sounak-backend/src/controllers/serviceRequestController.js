// src/controllers/serviceRequestController.js
const asyncHandler = require('express-async-handler');
const serviceRequestService = require('../services/serviceRequestService');

const GROCERY_REASONS = ['place_order', 'general_help', 'delivery_issue', 'custom'];

// @desc    Customer requests assistance — FR-3.10, FR-3.11
// @route   POST /api/assistance   Body: { phone?, reason, note? }
// Only the grocery portal is wired up yet, so requestType is fixed to
// 'grocery_assistance' here rather than accepted from the client — the other
// three request_type values (doctor_booking/test_booking/helper_task) will
// get their own endpoints when those portals are built, all backed by the
// same service_requests table.
exports.createAssistanceRequest = asyncHandler(async (req, res) => {
  const { reason, note } = req.body;
  // FR-3.11: phone defaults to the account's own number, editable.
  const phone = req.body.phone || req.user.phone;

  if (!phone) {
    res.status(400);
    throw new Error('phone is required (no phone number on file for this account).');
  }
  if (reason && !GROCERY_REASONS.includes(reason)) {
    res.status(400);
    throw new Error(`reason must be one of: ${GROCERY_REASONS.join(', ')}`);
  }

  let request;
  try {
    request = await serviceRequestService.createRequest({
      userId: String(req.user._id),
      phone,
      requestType: 'grocery_assistance',
      reason: reason || 'custom',
      details: {},
      note,
    });
  } catch (err) {
    res.status(err.status || 500);
    throw err;
  }

  res.status(201).json({ success: true, data: request });
});

// @desc    Customer's own assistance requests
// @route   GET /api/assistance/mine
exports.listOwnRequests = asyncHandler(async (req, res) => {
  const requests = await serviceRequestService.listOwnRequests(String(req.user._id));
  res.status(200).json({ success: true, count: requests.length, data: requests });
});

// @desc    Admin: queue view — FR-2.13
// @route   GET /api/assistance?status=&requestType=&page=&limit=
exports.listRequests = asyncHandler(async (req, res) => {
  const { status, requestType, page, limit } = req.query;
  const { rows, pagination } = await serviceRequestService.listRequests({ status, requestType, page, limit });
  res.status(200).json({ success: true, count: rows.length, data: rows, pagination });
});

// @desc    Admin: mark contacted / resolved — FR-2.14
// @route   PATCH /api/assistance/:id/status   Body: { status }
exports.setStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!status) {
    res.status(400);
    throw new Error('status is required.');
  }

  let request;
  try {
    request = await serviceRequestService.setStatus(req.params.id, status, String(req.user._id));
  } catch (err) {
    res.status(err.status || 500);
    throw err;
  }
  if (!request) {
    res.status(404);
    throw new Error(`Request '${req.params.id}' not found.`);
  }
  res.status(200).json({ success: true, data: request });
});
