const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const Sentry = require('@sentry/node');
const config = require('./config');
const errorHandler = require('./middleware/error-handler');
const requestId = require('./middleware/request-id');
const { requestLogger } = require('./middleware/request-logger');

class Server {
  constructor() {
    this.app = express();
    this.port = config.port;

    // Trust exactly 1 hop: Caddy (the droplet's reverse proxy in front of this
    // container - see deploy/docker-compose.yml), which forwards Cloudflare's
    // CF-Connecting-IP header as X-Forwarded-For (see deploy/Caddyfile) - so
    // req.ip reflects the real client IP for IP-based rate limiting. Was `2`
    // (Cloudflare + Caddy) under the assumption Caddy would append to Cloudflare's
    // inbound X-Forwarded-For, but Caddy doesn't trust that header without
    // trusted_proxies configured and replaces it with its own peer (Cloudflare's
    // edge IP) - which, combined with `2`, made req.ip resolve to that edge IP
    // instead of the real client. adminLimiter/registrationLimiter in
    // rate-limit.js key purely off req.ip with no fallback, so getting this wrong
    // silently pools all traffic into one rate-limit bucket instead of limiting
    // per-client. If the proxy chain ever changes again, verify by logging req.ip
    // in staging and confirming it shows real external client IPs, not an
    // internal/edge address.
    this.app.set('trust proxy', 1);

    this.requestLogging();
    this.middlewares();
    this.routes();
    this.errorHandling();
  }

  // Mounted first, ahead of everything else (including authenticate, which is
  // per-router further down) — every request gets a correlation id and a log
  // line regardless of whether it ever authenticates. See CLAUDE.md's
  // "Structured request logging" entry.
  requestLogging() {
    this.app.use(requestId);
    this.app.use(requestLogger);
  }

  middlewares() {
    this.app.use(helmet());
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static('public'));
  }

  routes() {
    this.app.use('/health', require('./routes/health.routes'));
    this.app.use('/v1', require('./routes'));
  }

  errorHandling() {
    Sentry.setupExpressErrorHandler(this.app);
    this.app.use(errorHandler);
  }

  listen() {
    this.app.listen(this.port, () => {
      console.log(`Server running on port ${this.port}`);
    });
  }
}

module.exports = Server;
