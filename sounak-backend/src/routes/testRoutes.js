// src/routes/testRoutes.js
const express = require('express');
const router = express.Router();
const passport = require('passport');
const { requireRole } = require('../middleware/roleMiddleware');
const labTestController = require('../controllers/labTestController');

const requireAdmin = [passport.authenticate('jwt', { session: false }), requireRole('admin')];

router.get('/:id', requireAdmin, labTestController.getTest);
router.put('/:id', requireAdmin, labTestController.updateTest);
router.patch('/:id/active', requireAdmin, labTestController.setTestActive);

module.exports = router;
