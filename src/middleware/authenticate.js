const crypto = require('crypto');
const apiKeyModel = require('../models/api-key.model');
const AppError = require('../errors/app-error');

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
    return next(new AppError('Invalid or revoked API key', 401));
  }

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
