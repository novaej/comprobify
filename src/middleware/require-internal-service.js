const crypto = require('crypto');
const { ipKeyGenerator } = require('express-rate-limit');
const config = require('../config');
const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');
const attemptTrackerService = require('../services/attempt-tracker.service');
const AttemptEventTypes = require('../constants/attempt-event-types');

// Gates account creation/recovery/activation routes (ADR-035) so only
// comprobify-web's own server-side BFF can call them directly — a real
// end user always goes through the web app, never a bare curl/Postman call.
// Deliberately the OPPOSITE failure mode from trusted-forwarded-ip.js's
// optional IP override: that one no-ops when INTERNAL_SERVICE_SECRET is
// unset (safe — it only affects logged IPs/rate-limit keys), but this gate
// must fail CLOSED when unset, since the whole point is that these routes
// are unreachable without it. config.internalServiceSecret is validated as
// required in src/config/validate.js specifically because of this.
function requireInternalService(req, res, next) {
  const secret = config.internalServiceSecret;
  const presented = req.headers['x-internal-service-secret'];

  const secretBuf = Buffer.from(secret || '', 'utf8');
  const presentedBuf = Buffer.from(presented || '', 'utf8');
  const matches = secret && presented
    && secretBuf.length === presentedBuf.length
    && crypto.timingSafeEqual(secretBuf, presentedBuf);

  if (!matches) {
    if (presented) {
      // Fire-and-forget — recordEvent never throws, must not add latency here.
      attemptTrackerService.recordEvent(AttemptEventTypes.INTERNAL_SERVICE_AUTH_FAILURE, ipKeyGenerator(req.ip));
    }
    return next(new AppError(
      'This endpoint can only be called by the Comprobify web app.',
      403,
      ErrorCodes.INTERNAL_SERVICE_ONLY
    ));
  }

  next();
}

module.exports = requireInternalService;
