const crypto = require('crypto');
const config = require('../config');
const AppError = require('../errors/app-error');

const authenticateAdmin = (req, _res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('Missing or invalid Authorization header. Expected: Bearer <secret>', 401));
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return next(new AppError('Bearer token must not be empty', 401));
  }

  const secret = config.adminSecret;
  if (!secret) {
    return next(new AppError('Admin secret not configured', 500));
  }

  // Constant-time comparison prevents timing attacks
  const tokenBuf  = Buffer.from(token,  'utf8');
  const secretBuf = Buffer.from(secret, 'utf8');

  if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
    return next(new AppError('Unauthorized', 401));
  }

  next();
};

module.exports = authenticateAdmin;
