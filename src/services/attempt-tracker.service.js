const Sentry = require('../../instrument');
const redisService = require('./redis.service');
const config = require('../config');
const logger = require('./logger.service');

// Detection, not prevention — every secret involved at every call site (API
// keys, ADMIN_SECRET, verification tokens, cert fingerprints) is already
// high-entropy and computationally infeasible to guess. This just surfaces
// repeated attempts against the same (eventType, key) pair as a signal an
// operator should see, regardless of whether the underlying attack was ever
// likely to work. No Redis configured means detection is a silent no-op —
// this must never gate or slow down the caller's actual auth/recovery flow.
async function recordEvent(eventType, key) {
  const client = redisService.getClient();
  if (!client) {
    return false;
  }

  const redisKey = `attempt:${eventType}:${key}`;
  try {
    const count = await client.incr(redisKey);
    if (count === 1) {
      await client.pexpire(redisKey, config.attemptTracker.windowMs);
    }

    if (count === config.attemptTracker.threshold) {
      const message = `[attempt-tracker] threshold crossed: eventType=${eventType} key=${key} count=${count} windowMs=${config.attemptTracker.windowMs}`;
      // logger.warn (not console.warn) — prints locally the same as before,
      // but also ships to Betterstack once BETTERSTACK_SOURCE_TOKEN is set,
      // making crossings independently queryable/aggregatable after the
      // fact, not just alerted-on once via Sentry.captureMessage below.
      logger.warn(message, { eventType, key, count });
      Sentry.captureMessage(message, { level: 'warning', tags: { eventType }, extra: { key, count } });
    }

    return count >= config.attemptTracker.threshold;
  } catch (err) {
    console.error('[attempt-tracker] redis error, failing open:', err.message);
    return false;
  }
}

module.exports = { recordEvent };
