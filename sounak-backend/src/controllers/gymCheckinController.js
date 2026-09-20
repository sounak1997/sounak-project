// src/controllers/gymCheckinController.js
//
// The PUBLIC half of the gym portal: the door check-in flow. No login, no JWT —
// see gymAttendanceService.js for why, and src/db/schema_gym.sql
// (gym_device_tokens) for what the device token can and cannot do.
//
// Everything here is reachable by anyone who can read a gym's printed QR, so
// each handler takes the gym code and hands it to the service, which refuses
// anything it does not recognise before touching a member record.
const asyncHandler = require('express-async-handler');
const gymAttendanceService = require('../services/gymAttendanceService');

// @desc    What the check-in screen should show on load
// @route   GET /api/gym/checkin/state?g=<gymCode>&deviceToken=<token>
// @access  Public
//
// The device token arrives as a query parameter rather than a header because
// this is the first call the page makes and it is a plain GET — but that also
// means it can land in access logs, which is one more reason the token grants
// nothing beyond attendance for its own member.
exports.getState = asyncHandler(async (req, res) => {
  const state = await gymAttendanceService.getState({
    gymCode: req.query.g,
    deviceToken: req.query.deviceToken,
  });
  res.status(200).json({ success: true, data: state });
});

// @desc    Find a member by phone number or name, on this gym's list
// @route   POST /api/gym/checkin/search   Body: { gymCode, query }
// @access  Public (rate limited — this is the member-enumeration surface)
exports.search = asyncHandler(async (req, res) => {
  const result = await gymAttendanceService.search({
    gymCode: req.body.gymCode,
    query: req.body.query,
  });
  res.status(200).json({ success: true, data: result });
});

// @desc    Bind this phone to a member, so later scans are one tap
// @route   POST /api/gym/checkin/claim   Body: { gymCode, memberId, verify }
// @access  Public (verified by the last 4 digits of the member's mobile)
exports.claim = asyncHandler(async (req, res) => {
  const result = await gymAttendanceService.claim({
    gymCode: req.body.gymCode,
    memberId: req.body.memberId,
    verify: req.body.verify,
    userAgent: req.headers['user-agent'],
  });
  res.status(201).json({ success: true, data: result });
});

// @desc    Mark the visit — check in, or check out. The SERVER decides which.
// @route   POST /api/gym/checkin   Body: { gymCode, deviceToken, clientTime }
// @access  Public (device token)
//
// `clientTime` is the browser's own clock, so a tap recorded while Render wakes
// from sleep still shows the time the member actually tapped. The service
// ignores it when it disagrees with the server by more than a few minutes.
exports.scan = asyncHandler(async (req, res) => {
  const result = await gymAttendanceService.scan({
    gymCode: req.body.gymCode,
    deviceToken: req.body.deviceToken,
    clientTime: req.body.clientTime,
  });
  res.status(200).json({ success: true, data: result });
});
