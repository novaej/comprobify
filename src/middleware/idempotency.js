const AppError = require('../errors/app-error');

const MAX_KEY_LENGTH = 255;

const extractIdempotencyKey = (req, _res, next) => {
  const key = req.headers['idempotency-key'];

  if (key === undefined) {
    req.idempotencyKey = null;
    return next();
  }

  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new AppError('Idempotency-Key header must be a non-empty string', 400);
  }

  if (key.length > MAX_KEY_LENGTH) {
    throw new AppError(`Idempotency-Key header must not exceed ${MAX_KEY_LENGTH} characters`, 400);
  }

  req.idempotencyKey = key;
  next();
};

module.exports = extractIdempotencyKey;
