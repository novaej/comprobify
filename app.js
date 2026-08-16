require('dotenv').config();

require('./instrument');

const { validateConfig } = require('./src/config/validate');
const config = require('./src/config');
const migrate = require('./db/migrate');
const redisService = require('./src/services/redis.service');

validateConfig(config);

// Eagerly starts connecting now (a no-op when REDIS_URL is unset) instead of waiting for
// rate-limit.js's first getClient() call, which only happens once require('./src/server')
// reaches route registration - well after this. Without a head start, the client's
// asynchronous TCP handshake had zero time to complete before RedisStore.init()'s
// module-load-time SCRIPT LOAD command fired synchronously right after construction,
// so it always raced a not-yet-writeable stream on every cold start (not just droplet
// recreations, as originally misdiagnosed - see the 0.16.4 CHANGELOG entry). The
// migration below plus src/server.js's own require chain give this connection real
// wall-clock time to finish before rate-limit.js ever needs it, with no behavior change
// if it hasn't: getClient() is idempotent, and every existing fallback (in-memory rate
// limiting when unset, fail-fast enableOfflineQueue:false semantics once connected)
// stays exactly as it was.
redisService.getClient();

async function main() {
  await migrate();

  const Server = require('./src/server');
  const server = new Server();
  server.listen();
}

main().catch((err) => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});
