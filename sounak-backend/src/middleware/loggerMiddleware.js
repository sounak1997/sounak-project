// my-angular-node-backend/src/middleware/loggerMiddleware.js

const loggerMiddleware = (req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next(); // Pass control to the next middleware/route handler
};

module.exports = { loggerMiddleware }; // Correctly export the function