const crypto = require('crypto');
const Sentry = require('../../instrument');

// Mounted first, ahead of everything else — every request gets a correlation
// id regardless of whether it ever authenticates. Returned via X-Request-Id so
// a client can report it back when filing a support ticket. Also tagged onto
// Sentry's current request-isolated scope (Sentry's Node http auto-instrumentation
// already isolates one scope per request by the time this middleware runs,
// since instrument.js is required before express — see app.js), so a captured
// exception can be searched by the same id: this is what ties a Sentry error
// back to its exact structured log line (console/Betterstack), which otherwise
// share no common identifier.
function requestId(req, res, next) {
  req.requestId = crypto.randomUUID();
  res.set('X-Request-Id', req.requestId);
  Sentry.setTag('requestId', req.requestId);
  next();
}

module.exports = requestId;
