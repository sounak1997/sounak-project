// my-angular-node-backend/src/middleware/errorMiddleware.js

const errorHandler = (err, req, res, next) => {
  console.error(err.stack); // Log the error stack for debugging
  // `err.statusCode` takes precedence so a service can throw a 404/403 without
  // reaching for `res` — services have no response object, and previously any
  // error they raised arrived here as a bare Error and became a 500. Existing
  // controllers set `res.status(...)` before throwing and never set
  // `err.statusCode`, so they keep the old behaviour untouched.
  const statusCode = err.statusCode || (res.statusCode === 200 ? 500 : res.statusCode);
  res.status(statusCode).json({
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack // Don't expose stack in production
  });
};

module.exports = { errorHandler }; // Correctly export the function