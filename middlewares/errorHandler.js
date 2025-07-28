// middlewares/errorHandler.js
function ErrHandler(Error, req, res, next) {
  console.error('❌ Error:', Error.stack); // Log the error stack for debugging
  const status = Error.status || 500;
  const message = Error.message || 'Internal Server Error Occurred'; // Fixed typo
  res.status(status).send({ error: true, message });
}

module.exports = ErrHandler;

// return next({ status: 111, message: '' });
