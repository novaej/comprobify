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

const keyGenerator = (req) => req.keyHash || ipKeyGenerator(req.ip);

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

// IP-based limiter for admin endpoints. Mounted BEFORE authenticateAdmin, so
// its actual job is brute-force protection on ADMIN_SECRET — not throttling a
// legitimate operator. Those are two different populations, and counting both
// against one budget made the attacker case set the ceiling for everyone:
// every admin panel request arrives from one IP (comprobify-web is a
// server-side BFF, so the API never sees a browser IP), which exhausted a
// 20/min bucket within a couple of page renders.
//
// skipSuccessfulRequests + requestWasSuccessful fixes that by counting only
// requests whose secret did NOT check out. Brute force stays capped at
// adminMax guesses/min/IP; an authenticated operator is never throttled.
// "Successful" is deliberately req.adminAuthenticated (set by
// authenticate-admin.js), not the default status < 400 — an operator hitting
// a 404 or a validation error is not a guessing attempt.
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.rateLimit.adminMax,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req) => req.adminAuthenticated === true,
  store: buildStore('rl:admin:'),
  passOnStoreError: true,
});

// Strict IP-based limiter for registration: 5 req/hour
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler,
  store: buildStore('rl:registration:'),
  passOnStoreError: true,
});

module.exports = { writeLimiter, readLimiter, adminLimiter, registrationLimiter, buildStore, keyGenerator };
