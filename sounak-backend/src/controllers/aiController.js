// src/controllers/aiController.js
const { Readable } = require('stream');
const aiService = require('../services/aiService');

/**
 * POST /api/ai/chat
 * Body: { message: string, system?: string }
 * Protected — req.user is set by the JWT strategy (see aiRoutes).
 */
exports.chat = async (req, res) => {
  const { message, system } = req.body;

  // Validate at the edge, same as the Python service does, so a bad request
  // never even reaches the AI service (and never spends quota).
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({
      success: false,
      message: 'A non-empty "message" string is required.',
    });
  }

  try {
    const result = await aiService.chat({ message, system });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Controller Error (AI chat):', error.message);

    // aiService tags errors with a .status (502 unreachable, 504 timeout, or
    // the status the Python service returned). Fall back to 500 otherwise.
    const status = error.status || 500;

    return res.status(status).json({
      success: false,
      message: 'The AI service could not complete your request.',
      detail: error.message,
    });
  }
};

/**
 * POST /api/ai/ask
 * Body: { question: string, k?: number }
 * RAG — answers grounded in the documents ingested by the Python service.
 * Protected — req.user is set by the JWT strategy (see aiRoutes).
 */
exports.ask = async (req, res) => {
  const { question, k } = req.body;

  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({
      success: false,
      message: 'A non-empty "question" string is required.',
    });
  }

  try {
    const result = await aiService.ask({ question, k });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Controller Error (AI ask):', error.message);

    const status = error.status || 500;

    return res.status(status).json({
      success: false,
      message: 'The AI service could not complete your request.',
      detail: error.message,
    });
  }
};

/**
 * POST /api/ai/chat/stream
 * Streams the reply to the client as Server-Sent Events by piping the Python
 * service's SSE stream straight through. Protected — see aiRoutes.
 */
exports.chatStream = async (req, res) => {
  const { message, system } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({
      success: false,
      message: 'A non-empty "message" string is required.',
    });
  }

  let upstream;
  try {
    upstream = await aiService.openChatStream({ message, system });
  } catch (error) {
    // Never reached the Python service.
    return res.status(502).json({
      success: false,
      message: 'Could not reach AI service.',
      detail: error.message,
    });
  }

  // If the Python service rejected the request (e.g. 503 no key), it replies
  // JSON, not a stream — forward that as a normal error before we open the SSE.
  if (!upstream.ok) {
    const data = await upstream.json().catch(() => ({}));
    return res.status(upstream.status).json({
      success: false,
      message: 'The AI service could not complete your request.',
      detail: data.detail,
    });
  }

  // Open the SSE response to the client and pipe the upstream stream into it.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // upstream.body is a web ReadableStream; Readable.fromWeb adapts it to a Node
  // stream we can pipe. (This is why the runtime must be Node >= 18.)
  const nodeStream = Readable.fromWeb(upstream.body);
  nodeStream.pipe(res);

  // If the browser disconnects, stop pulling from the model.
  req.on('close', () => nodeStream.destroy());
  nodeStream.on('error', () => res.end());
};
