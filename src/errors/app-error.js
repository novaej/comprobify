const STATUS_METADATA = {
  400: { code: 'BAD_REQUEST',        title: 'Bad Request',           typeSlug: 'bad-request' },
  401: { code: 'UNAUTHORIZED',       title: 'Unauthorized',          typeSlug: 'unauthorized' },
  402: { code: 'PAYMENT_REQUIRED',   title: 'Payment Required',      typeSlug: 'payment-required' },
  403: { code: 'FORBIDDEN',          title: 'Forbidden',             typeSlug: 'forbidden' },
  404: { code: 'NOT_FOUND',          title: 'Not Found',             typeSlug: 'not-found' },
  409: { code: 'CONFLICT',           title: 'Conflict',              typeSlug: 'conflict' },
  429: { code: 'TOO_MANY_REQUESTS',  title: 'Too Many Requests',     typeSlug: 'too-many-requests' },
  500: { code: 'INTERNAL_ERROR',     title: 'Internal Server Error', typeSlug: 'internal-error' },
  502: { code: 'BAD_GATEWAY',        title: 'Bad Gateway',           typeSlug: 'bad-gateway' },
};

const DEFAULT_META = { code: 'ERROR', title: 'Error', typeSlug: 'error' };

class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    const meta = STATUS_METADATA[statusCode] || DEFAULT_META;
    this.code = meta.code;
    this.typeSlug = meta.typeSlug;
    this.title = meta.title;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
