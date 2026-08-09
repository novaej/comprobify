const crypto = require('crypto');
const apiKeyModel = require('../models/api-key.model');
const AppError = require('../errors/app-error');
const NotFoundError = require('../errors/not-found-error');
const TenantStatus = require('../constants/tenant-status');
const ErrorCodes = require('../constants/error-codes');

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function formatKey(row) {
  return {
    id: row.id,
    label: row.label,
    environment: row.environment,
    scopes: row.scopes,
    active: row.active,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
    requestCount: Number(row.request_count),
  };
}

async function listKeys(tenantId) {
  const rows = await apiKeyModel.findActiveByTenantId(tenantId);
  return rows.map(formatKey);
}

// requestingScopes is the scopes array of the key making this request
// (req.apiKey.scopes, always populated by authenticate.js). Omitting `scopes`
// in the request body defaults to a copy of the requesting key's own scopes
// — not a blanket full-access default — so a scoped-down key's "just mint me
// a key" call can't silently come back broader than itself. An explicit
// `scopes` array is still honored, but every entry must already be held by
// the requesting key (privilege containment): otherwise a key that can only
// manage keys could mint itself a new one with, say, tenant:promote, which
// it never had. See CLAUDE.md "Tenant-scoped API key permissions".
async function createKey(tenant, { label, environment, scopes }, requestingScopes) {
  if (tenant.status !== TenantStatus.ACTIVE) {
    throw new AppError(
      'Email verification is required before creating API keys. Check your inbox.',
      403,
      ErrorCodes.EMAIL_VERIFICATION_REQUIRED
    );
  }
  if (environment === 'production') {
    // Block self-service minting of a production key unless the tenant already has one — that
    // means they've gone through promote at least once.
    const existing = (await apiKeyModel.findActiveByTenantId(tenant.id))
      .filter((k) => k.environment === 'production');
    if (existing.length === 0) {
      throw new AppError(
        'Production keys can only be created after promoting to production. Call POST /api/tenants/promote first.',
        403,
        ErrorCodes.PRODUCTION_KEY_REQUIRES_PROMOTION
      );
    }
  }
  const grantedScopes = Array.isArray(scopes) && scopes.length > 0 ? scopes : requestingScopes;
  const disallowed = grantedScopes.filter((s) => !requestingScopes.includes(s));
  if (disallowed.length > 0) {
    throw new AppError(
      `Cannot mint a key with scopes the requesting key does not itself have: ${disallowed.join(', ')}`,
      403,
      ErrorCodes.SCOPE_ESCALATION_FORBIDDEN
    );
  }
  const plainToken = crypto.randomBytes(32).toString('hex');
  await apiKeyModel.create({
    tenantId: tenant.id,
    keyHash: sha256Hex(plainToken),
    label: label || null,
    environment: environment || 'sandbox',
    scopes: grantedScopes,
  });
  return { token: plainToken, scopes: grantedScopes };
}

async function getDailyUsage(tenantId, keyId, days = 30) {
  const row = await apiKeyModel.findByIdAndTenantId(keyId, tenantId);
  if (!row) {
    throw new NotFoundError('API key');
  }
  const rows = await apiKeyModel.findDailyUsage(keyId, days);
  return rows.map((r) => ({ date: r.usage_date, requestCount: Number(r.request_count) }));
}

async function revokeKey(tenantId, keyId, currentApiKeyId) {
  const row = await apiKeyModel.findByIdAndTenantId(keyId, tenantId);
  if (!row || !row.active) {
    throw new NotFoundError('API key');
  }
  if (row.id === currentApiKeyId) {
    throw new AppError(
      'Cannot revoke the API key used for this request. Use a different key to revoke this one.',
      400,
      ErrorCodes.SELF_REVOCATION_FORBIDDEN
    );
  }
  await apiKeyModel.revoke(row.id);
}

module.exports = { listKeys, createKey, revokeKey, formatKey, getDailyUsage };
