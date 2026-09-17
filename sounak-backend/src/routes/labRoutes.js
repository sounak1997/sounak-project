// src/routes/labRoutes.js
const express = require('express');
const router = express.Router();
const passport = require('passport');
const { requireRole } = require('../middleware/roleMiddleware');
const labTestController = require('../controllers/labTestController');

const requireAuth = passport.authenticate('jwt', { session: false });
const requireAdmin = [requireAuth, requireRole('admin')];

router.get('/', requireAuth, labTestController.listLabs);
router.post('/', requireAdmin, labTestController.createLab);
router.patch('/:id/active', requireAdmin, labTestController.setLabActive);
router.post('/:id/tests', requireAdmin, labTestController.createTest);

module.exports = router;
