const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const config = require('../config');
const { TIERS } = require('../constants/subscription-tiers');
const redisService = require('../services/redis.service');

// Returns a RedisStore (shared across API instances) when REDIS_URL is
// configured, or undefined (express-rate-limit's own in-memory store,
// correct only for a single instance) otherwise. Each limiter passes its
// own prefix so their counters never collide in the same Redis keyspace.
function buildStore(prefix) {
  const client = redisService.getClient();
  if (!client) {
    return undefined;
  }
  return new RedisStore({
    prefix,
    sendCommand: (...args) => client.call(...args),
  });
}

const handler = (req, res) => {
  res.status(429).json({
    type: 'https://docs.comprobify.com/errors/too-many-requests',
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
  store: buildStore('rl:write:'),
  passOnStoreError: true,
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
  store: buildStore('rl:read:'),
  passOnStoreError: true,
});

// Fixed IP-based limiter for admin endpoints: 20 req/min
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => ipKeyGenerator(req),
  handler,
  store: buildStore('rl:admin:'),
  passOnStoreError: true,
});

// Strict IP-based limiter for registration: 5 req/hour
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => ipKeyGenerator(req),
  handler,
  store: buildStore('rl:registration:'),
  passOnStoreError: true,
});

module.exports = { writeLimiter, readLimiter, adminLimiter, registrationLimiter, buildStore };
