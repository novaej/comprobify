const expressWinston = require('express-winston');
const logger = require('../services/logger.service');

// Builds every field logged for a request, entirely by hand rather than via
// express-winston's built-in requestWhitelist/responseWhitelist mechanism —
// see the security note on the middleware config below for why.
function buildLogMeta(req, res) {
  return {
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path, // req.path, NOT req.originalUrl/req.url — strips the query
    // string, which can carry secrets (e.g. GET /v1/verify-email/check?token=...)
    statusCode: res.statusCode,
    durationMs: res.responseTime, // set by express-winston itself before dynamicMeta runs
    ip: req.ip,
    requestId: req.requestId,
    keyHash: req.keyHash || null,
    apiKeyId: req.apiKey?.id || null,
    tenantId: req.tenant?.id || null,
    issuerId: req.issuer?.id || null,
  };
}

function buildLogMessage(req, res) {
  return `${req.method} ${req.path} ${res.statusCode}`;
}

// Mounted ahead of authenticate — dynamicMeta runs when the response actually
// finishes, not when this middleware is invoked, so req.tenant/req.apiKey/
// req.issuer/req.keyHash are correctly populated by then if authenticate ran
// at all; they're simply null on public routes.
//
// SECURITY: express-winston's default requestWhitelist includes `headers` and
// `originalUrl`/`query` — logging those as-is would ship the raw
// `Authorization: Bearer <token>` header and any query-string secrets straight
// to a third-party SaaS. requestWhitelist/responseWhitelist are emptied out
// here and every logged field is built explicitly via buildLogMeta/
// buildLogMessage instead — never rely on express-winston's defaults for this
// project. headerBlacklist is kept as defense in depth in case that ever changes.
const requestLogger = expressWinston.logger({
  winstonInstance: logger,
  requestWhitelist: [],
  responseWhitelist: [],
  headerBlacklist: ['authorization', 'cookie'],
  metaField: null,
  msg: buildLogMessage,
  dynamicMeta: buildLogMeta,
});

module.exports = { requestLogger, buildLogMeta, buildLogMessage };
