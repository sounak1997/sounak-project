require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// --- Database ---
const connectDB = require('./src/config/db.config');
require('./src/config/pg.config');

// --- Redis & RabbitMQ ---
const { connectRabbitMQ } = require('./src/config/rabbitmq.config');

// --- Socket.IO ---
const { setupSocket } = require('./src/config/socket.config');

// --- Middleware ---
const { errorHandler } = require('./src/middleware/errorMiddleware');
const { loggerMiddleware } = require('./src/middleware/loggerMiddleware');
const { apiLimiter, authLimiter, registerLimiter } = require('./src/middleware/rateLimiter');
const passport = require('passport');
const configurePassport = require('./src/config/passport');

// --- SSE Consumers ---
const { startConsumers, addSSEClient, removeSSEClient } = require('./src/consumers/notificationConsumer');

const app = express();
const server = http.createServer(app); // HTTP server — required for Socket.IO

// --- Attach Socket.IO to HTTP server ---
const io = setupSocket(server);

// --- Connect Databases ---
connectDB();

// --- Connect RabbitMQ then start consumers ---
(async () => {
  await connectRabbitMQ();
  setTimeout(startConsumers, 1500);
})();

// --- Core Middleware ---
// The gym payment webhook is authenticated by an HMAC over the EXACT bytes the
// gateway sent, so it must see the raw body. This is mounted BEFORE
// express.json() because once the JSON parser has consumed the stream the
// original bytes are gone, and re-serialising the parsed object changes
// whitespace and key order — every signature would then fail. Scoped to this
// one path so nothing else changes.
app.use('/api/gym/webhooks', express.raw({ type: 'application/json', limit: '1mb' }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Comma-separated list so both frontends (sounak-project's web app and
// sounak-android's Ionic dev server, on different local ports) can be
// allowed without loosening this back to '*'.
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim())
  : '*';
app.use(cors({
  origin: corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(loggerMiddleware);

// --- Passport ---
app.use(passport.initialize());
configurePassport(passport);

// --- Global Rate Limiter ---
app.use('/api/', apiLimiter);

// --- Routes ---
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const productRoutes = require('./src/routes/productRoutes');
const aiRoutes = require('./src/routes/aiRoutes');
// Shopping Cart App (Grocery portal) — see docs/shopping-cart-app-requirements.md
const customerRoutes = require('./src/routes/customerRoutes');
const couponRoutes = require('./src/routes/couponRoutes');
const cartRoutes = require('./src/routes/cartRoutes');
const orderRoutes = require('./src/routes/orderRoutes');
const paymentConfigRoutes = require('./src/routes/paymentConfigRoutes');
const serviceRequestRoutes = require('./src/routes/serviceRequestRoutes');
// Doctors & Test Booking portal — see docs/doctors-test-booking-and-helper-portal-requirements.md
const medicalCenterRoutes = require('./src/routes/medicalCenterRoutes');
const doctorRoutes = require('./src/routes/doctorRoutes');
const labRoutes = require('./src/routes/labRoutes');
const testRoutes = require('./src/routes/testRoutes');
// Gym Management portal — see docs/gym-management-requirements.md. Multi-tenant
// (many independent gyms) and fully self-contained: its own tables, its own
// accounts, and no overlap with the portals above.
const gymRoutes = require('./src/routes/gymRoutes');

app.use('/api/auth/register', registerLimiter);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payment-config', paymentConfigRoutes);
app.use('/api/assistance', serviceRequestRoutes);
app.use('/api/medical-centers', medicalCenterRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/labs', labRoutes);
app.use('/api/tests', testRoutes);
app.use('/api/gym', gymRoutes);

// Uploaded product images and the payment QR (NFR-3). Registered before the
// production catch-all below so it isn't swallowed by the Angular SPA route.
const { UPLOADS_DIR } = require('./src/utils/imageUpload');
app.use('/uploads', express.static(UPLOADS_DIR));

// --- SSE: Live Notifications Stream ---
app.get('/api/notifications/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  addSSEClient(clientId, res);
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', message: 'Notification stream connected', clientId })}\n\n`);

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30000);
  req.on('close', () => {
    clearInterval(heartbeat);
    removeSSEClient(clientId);
  });
});

// --- Health Check ---
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    websocket: 'socket.io active',
  });
});

// --- Serve Angular in Production (single-host deploys only) ---
// Only mount this when the bundle is actually present. On a single-host deploy
// (the old EC2 box, or anything built by provision.sh) Express serves the
// frontend same-origin and this is correct. On Render the frontend lives on
// Cloudflare and this directory does not exist — registering the catch-all
// anyway makes sendFile throw ENOENT, so every unmatched route returns a
// confusing 500 instead of a clean 404, masking real routing mistakes.
const FRONTEND_DIST = path.join(__dirname, '../sounak-project/dist/sounak-project');
if (process.env.NODE_ENV === 'production' && fs.existsSync(path.join(FRONTEND_DIST, 'index.html'))) {
  console.log('[static] Serving Angular bundle from', FRONTEND_DIST);
  app.use(express.static(FRONTEND_DIST));
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(FRONTEND_DIST, 'index.html'));
  });
} else {
  console.log('[static] No Angular bundle present — API-only mode (frontend is hosted separately)');
}

// --- Global Error Handler ---
app.use(errorHandler);

// --- Start HTTP server (not app.listen — Socket.IO needs the http server) ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\nServer running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  console.log(`Health:    http://localhost:${PORT}/health`);
  console.log(`SSE:       http://localhost:${PORT}/api/notifications/stream`);
  console.log(`WebSocket: ws://localhost:${PORT}  (Socket.IO)\n`);
});
