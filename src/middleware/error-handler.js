const AppError = require('../errors/app-error');

const errorHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    const body = { ok: false, message: err.message };

    if (err.errors) {
      body.errors = err.errors;
    }
    if (err.sriMessages) {
      body.sriMessages = err.sriMessages;
    }

    return res.status(err.statusCode).json(body);
  }

  console.error('Unhandled error:', err);
  res.status(500).json({ ok: false, message: 'Internal server error' });
};

module.exports = errorHandler;
