// src/services/aiService.js
//
// Talks to the Python AI microservice (sounak-ai-service). From this backend's
// point of view it's just another downstream dependency — like pg or redis —
// that happens to speak to an LLM. All the LLM/Gemini/RAG specifics live in
// Python; here we only make HTTP calls and translate failures into clean errors.
//
// The timeout + error mapping is the "production plumbing" that separates a
// demo from something defensible: an LLM call can hang, rate-limit, or the
// service can be down, and each case gets a sensible HTTP status, not a 500.

// Where the Python service lives. localhost in dev; in Docker this becomes the
// compose service name (see .env / docker-compose). Never hardcoded.
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// Abort the call if the AI service takes too long, so a hung LLM request can't
// tie up this backend's connections indefinitely.
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 30000;

/**
 * POST some JSON to the Python service and return its parsed body, mapping
 * failures to errors tagged with an HTTP .status for the controller to use.
 */
async function callAiService(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const response = await fetch(`${AI_SERVICE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    // The Python service always replies JSON (even on errors: { detail: ... }).
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const err = new Error(data.detail || `AI service responded ${response.status}`);
      err.status = response.status;
      throw err;
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      const err = new Error('AI service timed out.');
      err.status = 504; // Gateway Timeout
      throw err;
    }
    // A fetch that rejects without an HTTP status means we never reached the
    // service (it's down, wrong URL, DNS, connection refused).
    if (!error.status) {
      const err = new Error(`Could not reach AI service: ${error.message}`);
      err.status = 502; // Bad Gateway
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Plain, ungrounded chat. */
exports.chat = ({ message, system }) => callAiService('/chat', { message, system });

/** RAG: grounded answer over the ingested documents. */
exports.ask = ({ question, k }) => callAiService('/ask', { question, k });

/**
 * Open the streaming (SSE) endpoint and return the raw fetch Response, so the
 * controller can pipe the response body straight to the browser. No timeout
 * wrapper here — a stream is meant to stay open while tokens arrive.
 */
exports.openChatStream = ({ message, system }) =>
  fetch(`${AI_SERVICE_URL}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, system }),
  });

/**
 * Shared handler for non-POST-JSON calls to the AI service (GET/DELETE, and
 * multipart upload). Same timeout + error-status mapping as callAiService.
 */
async function requestAiService(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const response = await fetch(`${AI_SERVICE_URL}${path}`, {
      ...options,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const err = new Error(data.detail || `AI service responded ${response.status}`);
      err.status = response.status;
      throw err;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      const err = new Error('AI service timed out.');
      err.status = 504;
      throw err;
    }
    if (!error.status) {
      const err = new Error(`Could not reach AI service: ${error.message}`);
      err.status = 502;
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** List the documents currently indexed for RAG. */
exports.listDocuments = () => requestAiService('/documents', { method: 'GET' });

/**
 * Forward an uploaded file to the AI service for indexing. Multer gives us the
 * file in memory (buffer); we rebuild it as multipart form-data using the
 * runtime's built-in FormData/Blob (Node >= 18) rather than adding a dependency.
 */
exports.uploadDocument = ({ buffer, originalname, mimetype }) => {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype }), originalname);
  return requestAiService('/documents', { method: 'POST', body: form });
};

/** Remove a document from the RAG index. */
exports.deleteDocument = (source) =>
  requestAiService(`/documents/${encodeURIComponent(source)}`, { method: 'DELETE' });
