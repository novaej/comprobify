const Sentry = require('@sentry/node');
const config = require('./src/config');

Sentry.init({
  dsn: config.sentry.dsn,
  environment: config.appEnv,
  // Falsy (unset locally) must stay `undefined`, not `''` — an empty string
  // is not `undefined` to the SDK's own release-detection fallback, so it
  // would short-circuit that fallback instead of leaving it to auto-detect.
  release: config.sentry.release || undefined,
  sendDefaultPii: false,
});

module.exports = Sentry;
