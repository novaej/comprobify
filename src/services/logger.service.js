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
  // @logtail/node defaults `endpoint` to the shared https://in.logs.betterstack.com
  // host, but Betterstack assigns each source its own regional ingesting host
  // (e.g. https://s123456.eu-central-1a.betterstackdata.com, shown on the
  // source's setup page) — without overriding it here, every sync attempt
  // 401s against a host that was never issued this token. Only passed when
  // set; omitting it lets the library's own default apply, for whichever
  // source actually does use the shared host.
  const logtailOptions = config.logging.betterstackIngestingHost
    ? { endpoint: config.logging.betterstackIngestingHost }
    : undefined;
  const logtail = new Logtail(config.logging.betterstackSourceToken, logtailOptions);
  transports.push(new LogtailTransport(logtail));
}

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports,
});

module.exports = logger;
