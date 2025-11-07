// src/routes/userRoutes.js
const express = require('express');
const router = express.Router(); // <--- Make sure this is here
const userController = require('../controllers/userController');

router.get('/', userController.getUsers);
router.post('/', userController.createUser);
router.get('/get', userController.getProfileDesc);

module.exports = router; // <--- This MUST export the router instance