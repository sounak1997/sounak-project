// my-angular-node-backend/src/middleware/errorMiddleware.js

const errorHandler = (err, req, res, next) => {
  console.error(err.stack); // Log the error stack for debugging
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode; // If status code is still 200, set to 500 (Internal Server Error)
  res.status(statusCode).json({
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack // Don't expose stack in production
  });
};

module.exports = { errorHandler }; // Correctly export the function