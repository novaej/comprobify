const STATUS_METADATA = {
  400: { code: 'BAD_REQUEST',        title: 'Bad Request',           type: '/problems/bad-request' },
  401: { code: 'UNAUTHORIZED',       title: 'Unauthorized',          type: '/problems/unauthorized' },
  403: { code: 'FORBIDDEN',          title: 'Forbidden',             type: '/problems/forbidden' },
  404: { code: 'NOT_FOUND',          title: 'Not Found',             type: '/problems/not-found' },
  409: { code: 'CONFLICT',           title: 'Conflict',              type: '/problems/conflict' },
  429: { code: 'TOO_MANY_REQUESTS',  title: 'Too Many Requests',     type: '/problems/too-many-requests' },
  500: { code: 'INTERNAL_ERROR',     title: 'Internal Server Error', type: '/problems/internal-error' },
  502: { code: 'BAD_GATEWAY',        title: 'Bad Gateway',           type: '/problems/bad-gateway' },
};

const DEFAULT_META = { code: 'ERROR', title: 'Error', type: '/problems/error' };

class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    const meta = STATUS_METADATA[statusCode] || DEFAULT_META;
    this.code = meta.code;
    this.type = meta.type;
    this.title = meta.title;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
