const crypto = require('crypto');
const { ipKeyGenerator } = require('express-rate-limit');
const config = require('../config');
const AppError = require('../errors/app-error');
const attemptTrackerService = require('../services/attempt-tracker.service');
const AttemptEventTypes = require('../constants/attempt-event-types');

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

  // Constant-time comparison prevents timing attacks
  const tokenBuf  = Buffer.from(token,  'utf8');
  const secretBuf = Buffer.from(secret, 'utf8');

  if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
    // Fire-and-forget — recordEvent never throws, and this must never add
    // latency to the auth-rejection path.
    attemptTrackerService.recordEvent(AttemptEventTypes.ADMIN_AUTH_FAILURE, ipKeyGenerator(req.ip));
    return next(new AppError('Unauthorized', 401));
  }

  next();
};

module.exports = authenticateAdmin;
