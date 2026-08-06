const crypto = require('crypto');
const config = require('../config');

// Lets a trusted first-party caller (comprobify-web's BFF) override req.ip with
// the real visitor IP it resolved from its own ingress - without this, every
// server-proxied call (register/recover/agreements acceptance) shows the BFF's
// own shared egress IP instead. Only takes effect when X-Internal-Service-Secret
// matches config.internalServiceSecret; a client-supplied X-Forwarded-Visitor-Ip
// is otherwise ignored - trusting it blindly would let anyone bypass
// registrationLimiter by claiming a fresh fake IP per request. See NEXT_STEPS.md #8.
function trustedForwardedIp(req, res, next) {
  const secret = config.internalServiceSecret;
  const presented = req.headers['x-internal-service-secret'];
  const visitorIp = req.headers['x-forwarded-visitor-ip'];

  if (secret && presented && visitorIp) {
    const secretBuf = Buffer.from(secret, 'utf8');
    const presentedBuf = Buffer.from(presented, 'utf8');
    if (secretBuf.length === presentedBuf.length && crypto.timingSafeEqual(secretBuf, presentedBuf)) {
      Object.defineProperty(req, 'ip', { value: visitorIp, configurable: true, enumerable: true });
    }
  }

  next();
}

module.exports = trustedForwardedIp;
