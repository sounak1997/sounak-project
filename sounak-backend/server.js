require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
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

app.use('/api/auth/register', registerLimiter);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);

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

app.get('/', (req, res) => {
  res.send('Node.js Backend — Redis | RabbitMQ | Rate Limiting | SSE | WebSocket (Socket.IO)');
});

// --- Serve Angular in Production ---
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../my-angular-frontend/dist/my-angular-frontend')));
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../my-angular-frontend/dist/my-angular-frontend', 'index.html'));
  });
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
