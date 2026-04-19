const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const config = require('../config');

const createRateLimiter = (maxRequests) => rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: maxRequests,
  keyGenerator: (req) => {
    // Use keyHash as the key for rate limiting, fallback to IP with proper IPv6 handling
    if (req.keyHash) {
      return req.keyHash;
    }
    return ipKeyGenerator(req);
  },
  handler: (req, res) => {
    res.status(429).json({
      type: 'https://example.com/errors/too-many-requests',
      title: 'Too Many Requests',
      status: 429,
      code: 'TOO_MANY_REQUESTS',
      detail: 'Rate limit exceeded for this API key',
      instance: req.originalUrl,
    });
  },
  skip: (req) => {
    // Skip rate limiting if no keyHash (e.g., webhook endpoints)
    return !req.keyHash;
  },
});

// Rate limiter for write endpoints: 60 req/min per key
const writeLimiter = createRateLimiter(60);

// Rate limiter for read endpoints: 300 req/min per key
const readLimiter = createRateLimiter(300);

module.exports = { writeLimiter, readLimiter };
