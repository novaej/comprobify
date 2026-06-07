const Sentry = require('@sentry/node');
const config = require('./src/config');

Sentry.init({
  dsn: config.sentry.dsn,
  environment: config.appEnv,
  sendDefaultPii: false,
});

module.exports = Sentry;
