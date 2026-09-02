// src/routes/aiRoutes.js
const express = require('express');
const router = express.Router();
const passport = require('passport');
const multer = require('multer');
const aiController = require('../controllers/aiController');

// All AI routes are protected with the JWT strategy — only authenticated users
// can spend AI quota. { session: false } keeps it stateless, same as
// /api/auth/profile.
const requireAuth = passport.authenticate('jwt', { session: false });

// Uploads are held in memory and forwarded straight to the Python service, so
// nothing is written to this server's disk. The size limit here mirrors the
// AI service's own cap, rejecting oversized files before they cross the wire.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// POST /api/ai/chat — plain, ungrounded chat.
router.post('/chat', requireAuth, aiController.chat);

// POST /api/ai/chat/stream — same, but streamed to the client as SSE.
router.post('/chat/stream', requireAuth, aiController.chatStream);

// POST /api/ai/ask — RAG: grounded answer over ingested documents.
router.post('/ask', requireAuth, aiController.ask);

// --- Agent: tool calling ---
// POST /api/ai/agent — the assistant that can read live data and drive the UI.
router.post('/agent', requireAuth, aiController.agent);
// POST /api/ai/agent/confirm — execute a write the user approved.
router.post('/agent/confirm', requireAuth, aiController.agentConfirm);

// --- Document management for RAG ---
router.get('/documents', requireAuth, aiController.listDocuments);
router.post('/documents', requireAuth, upload.single('file'), aiController.uploadDocument);
router.delete('/documents/:source', requireAuth, aiController.deleteDocument);

module.exports = router;
