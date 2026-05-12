const crypto = require('crypto');
const apiKeyModel = require('../models/api-key.model');
const AppError = require('../errors/app-error');
const TenantStatus = require('../constants/tenant-status');

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function formatKey(row) {
  return {
    id: row.id,
    label: row.label,
    environment: row.environment,
    active: row.active,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

async function listKeys(tenantId) {
  const rows = await apiKeyModel.findActiveByTenantId(tenantId);
  return rows.map(formatKey);
}

async function createKey(tenant, { label, environment }) {
  if (tenant.status !== TenantStatus.ACTIVE) {
    throw new AppError('Email verification required before creating API keys. Check your inbox.', 403);
  }
  if (environment === 'production') {
    // Block self-service minting of a production key unless the tenant already has one — that
    // means they've gone through promote at least once.
    const existing = (await apiKeyModel.findActiveByTenantId(tenant.id))
      .filter((k) => k.environment === 'production');
    if (existing.length === 0) {
      throw new AppError(
        'Production keys can only be created after promoting at least one issuer to production',
        403
      );
    }
  }
  const plainToken = crypto.randomBytes(32).toString('hex');
  await apiKeyModel.create({
    tenantId: tenant.id,
    keyHash: sha256Hex(plainToken),
    label: label || null,
    environment: environment || 'sandbox',
  });
  return plainToken;
}

async function revokeKey(tenantId, keyId, currentApiKeyId) {
  const row = await apiKeyModel.findByIdAndTenantId(keyId, tenantId);
  if (!row || !row.active) {
    throw new AppError('API key not found', 404);
  }
  if (row.id === currentApiKeyId) {
    throw new AppError('Cannot revoke the API key used for this request. Use a different key to revoke this one.', 400);
  }
  await apiKeyModel.revoke(row.id);
}

module.exports = { listKeys, createKey, revokeKey };
