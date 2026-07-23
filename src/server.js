const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const Sentry = require('@sentry/node');
const config = require('./config');
const errorHandler = require('./middleware/error-handler');

class Server {
  constructor() {
    this.app = express();
    this.port = config.port;

    // Trust exactly 2 hops: Cloudflare, then Caddy (the droplet's reverse proxy in
    // front of this container - see deploy/docker-compose.yml) - so req.ip reflects
    // the real client IP for IP-based rate limiting. Was `1` when Render's load
    // balancer was the only hop; adminLimiter/registrationLimiter in rate-limit.js
    // key purely off req.ip with no fallback, so getting this wrong silently pools
    // all traffic into one rate-limit bucket instead of limiting per-client. If the
    // proxy chain ever changes again, verify by logging req.ip in staging and
    // confirming it shows real external client IPs, not an internal/edge address.
    this.app.set('trust proxy', 2);

    this.middlewares();
    this.routes();
    this.errorHandling();
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
