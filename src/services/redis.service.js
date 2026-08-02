const Redis = require('ioredis');
const config = require('../config');

// Lazily created only when REDIS_URL is set — absent means every caller
// falls back to whatever in-process default it has (rate-limit.js falls
// back to express-rate-limit's own in-memory store), same optional/no-op
// pattern as SENTRY_DSN. Sits on the hot path of every rate-limited
// request, so it's tuned to fail fast rather than hang or buffer: ioredis's
// defaults (20 retries per command, queue while offline) would turn a Redis
// outage into slow/hanging requests instead of an immediate fallback.
let client = null;

function getClient() {
  if (!config.redis.url) {
    return null;
  }

  if (!client) {
    client = new Redis(config.redis.url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    client.on('error', (err) => console.error('[redis] connection error:', err.message));
  }

  return client;
}

module.exports = { getClient };
