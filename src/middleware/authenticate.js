const crypto = require('crypto');
const apiKeyModel = require('../models/api-key.model');
const attemptTrackerService = require('../services/attempt-tracker.service');
const AttemptEventTypes = require('../constants/attempt-event-types');
const AppError = require('../errors/app-error');
const logger = require('../services/logger.service');

// Identity only — does NOT reject a SUSPENDED tenant. That check lives in
// require-not-suspended.js, applied selectively per-route so some read-only
// endpoints can stay reachable while suspended. See CLAUDE.md "Tenant model."
const authenticate = async (req, _res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('Missing or invalid Authorization header. Expected: Bearer <token>', 401));
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return next(new AppError('Bearer token must not be empty', 401));
  }

  const keyHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = await apiKeyModel.findByKeyHash(keyHash);

  if (!row) {
    // Repeated failed lookups for the same keyHash can indicate someone
    // testing a leaked/scraped key.
    await attemptTrackerService.recordEvent(AttemptEventTypes.API_KEY_AUTH_FAILURE, keyHash);
    return next(new AppError('Invalid or revoked API key', 401));
  }

  // Fire-and-forget — must not add latency to the hot auth path. Unlike
  // attemptTrackerService.recordEvent() below (which never throws), a raw
  // db.query() can reject, so this gets its own .catch() to avoid an
  // unhandled rejection instead of being left to crash the process.
  apiKeyModel.touchUsage(row.key_id).catch((err) =>
    logger.error('api_key_usage_update_failed', { error: err.message, keyId: row.key_id })
  );

  req.keyHash = keyHash;
  req.apiKey = {
    id: row.key_id,
    label: row.label,
    environment: row.key_environment,
  };
  req.tenant = {
    id: row.tenant_id,
    email: row.tenant_email,
    subscriptionTier: row.tenant_subscription_tier,
    status: row.tenant_status,
    documentCount: row.tenant_document_count,
    documentQuota: row.tenant_document_quota,
    sandbox: row.tenant_sandbox,
    agreementAcceptedAt: row.tenant_agreement_accepted_at,
    agreementVersion: row.tenant_agreement_version,
  };

  next();
};

module.exports = authenticate;
