const winston = require('winston');
const { Logtail } = require('@logtail/node');
const { LogtailTransport } = require('@logtail/winston');
const config = require('../config');

// Single shared winston instance — used by both src/middleware/request-logger.js
// (HTTP requests, via express-winston) and pending-effect.service.js's process()
// (worker-side, no req/res available there) so the Betterstack wiring exists in
// exactly one place. Console transport always runs (structured JSON still prints
// locally / to `docker compose logs` with no config); the Betterstack transport
// is added only when BETTERSTACK_SOURCE_TOKEN is set — same optional,
// no-op-when-unset treatment as SENTRY_DSN/REDIS_URL.
const transports = [new winston.transports.Console()];

if (config.logging.betterstackSourceToken) {
  const logtail = new Logtail(config.logging.betterstackSourceToken);
  transports.push(new LogtailTransport(logtail));
}

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports,
});

module.exports = logger;
