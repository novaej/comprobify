const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const Sentry = require('@sentry/node');
const config = require('./config');
const errorHandler = require('./middleware/error-handler');
const requestId = require('./middleware/request-id');
const { requestLogger } = require('./middleware/request-logger');
const resolveClientIp = require('./middleware/resolve-client-ip');

class Server {
  constructor() {
    this.app = express();
    this.port = config.port;

    // Fallback only (local dev with no Caddy in front) - resolveClientIp below
    // overrides req.ip from Caddy's X-Real-Client-IP when present.
    this.app.set('trust proxy', 2);

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
    this.app.use(resolveClientIp);
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
