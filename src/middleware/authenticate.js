const crypto = require('crypto');
const apiKeyModel = require('../models/api-key.model');
const AppError = require('../errors/app-error');

const authenticate = async (req, _res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('Missing or invalid Authorization header. Expected: Bearer <token>', 401));
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return next(new AppError('Bearer token must not be empty', 401));
  }

  const keyHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = await apiKeyModel.findByKeyHash(keyHash);

  if (!row) {
    return next(new AppError('Invalid or revoked API key', 401));
  }

  req.issuer = row;
  next();
};

module.exports = authenticate;
