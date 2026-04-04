const AppError = require('../errors/app-error');

const errorHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    const body = {
      type: err.type,
      title: err.title,
      status: err.statusCode,
      code: err.code,
      detail: err.message,
      instance: req.originalUrl,
    };

    if (err.errors) {
      body.errors = err.errors;
    }
    if (err.sriMessages) {
      body.sriMessages = err.sriMessages;
    }

    return res
      .set('Content-Type', 'application/problem+json')
      .status(err.statusCode)
      .json(body);
  }

  console.error('Unhandled error:', err);
  res
    .set('Content-Type', 'application/problem+json')
    .status(500)
    .json({
      type: '/problems/internal-error',
      title: 'Internal Server Error',
      status: 500,
      code: 'INTERNAL_ERROR',
      instance: req.originalUrl,
    });
};

module.exports = errorHandler;
