// src/routes/aiRoutes.js
const express = require('express');
const router = express.Router();
const passport = require('passport');
const aiController = require('../controllers/aiController');

// All AI routes are protected with the JWT strategy — only authenticated users
// can spend AI quota. { session: false } keeps it stateless, same as
// /api/auth/profile.
const requireAuth = passport.authenticate('jwt', { session: false });

// POST /api/ai/chat — plain, ungrounded chat.
router.post('/chat', requireAuth, aiController.chat);

// POST /api/ai/chat/stream — same, but streamed to the client as SSE.
router.post('/chat/stream', requireAuth, aiController.chatStream);

// POST /api/ai/ask — RAG: grounded answer over ingested documents.
router.post('/ask', requireAuth, aiController.ask);

module.exports = router;
