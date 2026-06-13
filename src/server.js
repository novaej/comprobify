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

    // Trust the first proxy (Cloudflare / Render's load balancer) so that
    // req.ip reflects the real client IP for IP-based rate limiting.
    this.app.set('trust proxy', 1);

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
    this.app.use('/api', require('./routes'));
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
