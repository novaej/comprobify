const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const config = require('../config');
const TIERS = require('../constants/subscription-tiers');

const handler = (req, res) => {
  res.status(429).json({
    type: 'https://example.com/errors/too-many-requests',
    title: 'Too Many Requests',
    status: 429,
    code: 'TOO_MANY_REQUESTS',
    detail: 'Rate limit exceeded. See Retry-After header.',
    instance: req.originalUrl,
  });
};

const keyGenerator = (req) => req.keyHash || ipKeyGenerator(req);

// Tier-aware limiters for document endpoints
const writeLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: (req) => {
    const tier = TIERS[req.tenant?.subscriptionTier];
    return tier ? tier.writeRateLimit : TIERS.FREE.writeRateLimit;
  },
  keyGenerator,
  handler,
  skip: (req) => !req.keyHash,
});

const readLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: (req) => {
    const tier = TIERS[req.tenant?.subscriptionTier];
    return tier ? tier.readRateLimit : TIERS.FREE.readRateLimit;
  },
  keyGenerator,
  handler,
  skip: (req) => !req.keyHash,
});

// Fixed IP-based limiter for admin endpoints: 20 req/min
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => ipKeyGenerator(req),
  handler,
});

module.exports = { writeLimiter, readLimiter, adminLimiter };
