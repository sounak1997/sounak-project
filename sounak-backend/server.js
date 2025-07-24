// my-angular-backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const connectDB = require('./src/config/db.config');
const { errorHandler } = require('./src/middleware/errorMiddleware');
const { loggerMiddleware } = require('./src/middleware/loggerMiddleware');
const passport = require('passport'); // Import Passport
const configurePassport = require('./src/config/passport'); // Import Passport config

const app = express();

// Database Connection
connectDB();

// Middleware
app.use(express.json()); // Body parser for JSON
app.use(express.urlencoded({ extended: true })); // Body parser for URL-encoded data
app.use(cors()); // Enable CORS for all origins (for development)
app.use(loggerMiddleware); // Custom logger middleware

// Passport Initialization - IMPORTANT!
app.use(passport.initialize()); // Initialize Passport
configurePassport(passport);   // Configure Passport strategies by passing the passport object

// Routes
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const productRoutes = require('./src/routes/productRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);

// Basic default route for testing
app.get('/', (req, res) => {
  res.send('Node.js Backend with Passport.js is running!');
});

// Serve Angular frontend in production (optional for dev)
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../my-angular-frontend/dist/my-angular-frontend')));
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../my-angular-frontend/dist/my-angular-frontend', 'index.html'));
  });
}

// Error Handling Middleware (must be last)
app.use(errorHandler);

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
});