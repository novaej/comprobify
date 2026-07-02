const crypto = require('crypto');
const tenantModel = require('../models/tenant.model');
const issuerModel = require('../models/issuer.model');
const apiKeyModel = require('../models/api-key.model');
const issuerDocumentTypeModel = require('../models/issuer-document-type.model');
const tenantEventModel = require('../models/tenant-event.model');
const { formatTenantEvent } = require('../presenters/tenant-event.presenter');
const sequentialService = require('./sequential.service');
const cryptoService = require('./crypto.service');
const certificateService = require('./certificate.service');
const AppError = require('../errors/app-error');
const ConflictError = require('../errors/conflict-error');
const NotFoundError = require('../errors/not-found-error');
const { TIERS } = require('../constants/subscription-tiers');
const TenantStatus = require('../constants/tenant-status');
const ErrorCodes = require('../constants/error-codes');

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function formatTenant(row) {
  return {
    id: row.id,
    email: row.email,
    subscriptionTier: row.subscription_tier,
    status: row.status,
    documentQuota: row.document_quota,
    documentCount: row.document_count,
    createdAt: row.created_at,
  };
}

function formatIssuer(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ruc: row.ruc,
    businessName: row.business_name,
    tradeName: row.trade_name,
    branchCode: row.branch_code,
    issuePointCode: row.issue_point_code,
    certFingerprint: row.cert_fingerprint,
    certExpiry: row.cert_expiry,
    active: row.active,
  };
}

// --- Tenant management ---

async function createTenant(fields) {
  const existing = await tenantModel.findByEmail(fields.email);
  if (existing) {
    throw new ConflictError(`A tenant with email ${fields.email} already exists`);
  }
  const tier = fields.subscriptionTier || 'FREE';
  if (!TIERS[tier]) {
    throw new AppError(`Unknown subscription tier: '${tier}'. Valid tiers: ${Object.keys(TIERS).join(', ')}`, 400, ErrorCodes.INVALID_TIER);
  }
  const row = await tenantModel.create({
    email: fields.email,
    subscriptionTier: tier,
    status: TenantStatus.ACTIVE,
    documentQuota: TIERS[tier]?.documentQuota ?? TIERS.FREE.documentQuota,
  });
  return formatTenant(row);
}

async function listTenants() {
  const rows = await tenantModel.findAll();
  return rows.map(formatTenant);
}

async function updateTenantTier(id, tier) {
  if (!TIERS[tier]) {
    throw new AppError(`Unknown subscription tier: '${tier}'. Valid tiers: ${Object.keys(TIERS).join(', ')}`, 400, ErrorCodes.INVALID_TIER);
  }
  const previous = await tenantModel.findById(id);
  if (!previous) throw new NotFoundError('Tenant');

  const row = await tenantModel.updateTier(id, tier, TIERS[tier].documentQuota);
  await tenantEventModel.create(id, 'TIER_CHANGED', { from: previous.subscription_tier, to: tier });
  return formatTenant(row);
}

async function updateTenantStatus(id, status) {
  const allowed = Object.values(TenantStatus);
  if (!allowed.includes(status)) {
    throw new AppError(`Invalid status: '${status}'. Valid values: ${allowed.join(', ')}`, 400, ErrorCodes.INVALID_TENANT_STATUS);
  }
  const row = await tenantModel.updateStatus(id, status);
  if (!row) throw new NotFoundError('Tenant');
  return formatTenant(row);
}

async function verifyTenant(id) {
  const row = await tenantModel.activate(id);
  if (!row) throw new NotFoundError('Tenant');
  return formatTenant(row);
}

async function listTenantEvents(id) {
  const tenant = await tenantModel.findById(id);
  if (!tenant) throw new NotFoundError('Tenant');
  const events = await tenantEventModel.findByTenantId(id);
  return events.map(formatTenantEvent);
}

// --- Issuer management ---

async function createIssuer(fields, p12Buffer, p12Password, sourceIssuerId) {
  const tenant = await tenantModel.findById(fields.tenantId);
  if (!tenant) throw new NotFoundError('Tenant');

  const tierConfig = TIERS[tenant.subscription_tier];
  const issuePointCount = await tenantModel.countIssuePointsByBranch(tenant.id, fields.branchCode);
  if (issuePointCount === 0) {
    if (tierConfig.maxBranches !== null) {
      const branchCount = await tenantModel.countBranchesByTenantId(tenant.id);
      if (branchCount >= tierConfig.maxBranches) {
        throw new AppError(
          `Tenant has reached the branch limit for the ${tenant.subscription_tier} plan (${tierConfig.maxBranches}).`,
          402,
          ErrorCodes.BRANCH_LIMIT_REACHED
        );
      }
    }
  } else {
    if (tierConfig.maxIssuePointsPerBranch !== null) {
      if (issuePointCount >= tierConfig.maxIssuePointsPerBranch) {
        throw new AppError(
          `Branch ${fields.branchCode} has reached the issue point limit for the ${tenant.subscription_tier} plan (${tierConfig.maxIssuePointsPerBranch}).`,
          402,
          ErrorCodes.ISSUE_POINT_LIMIT_REACHED
        );
      }
    }
  }

  let encryptedPrivateKey, certificatePem, certFingerprint, certExpiry;

  if (p12Buffer) {
    const parsed = certificateService.parseCertificate(p12Buffer, p12Password || '');
    encryptedPrivateKey = cryptoService.encrypt(parsed.privateKeyPem);
    certificatePem = parsed.certPem;
    certFingerprint = parsed.certFingerprint;
    certExpiry = parsed.certExpiry;
  } else {
    const source = await issuerModel.findById(sourceIssuerId);
    if (!source) throw new NotFoundError('Source issuer', ErrorCodes.SOURCE_ISSUER_NOT_FOUND);
    if (source.ruc !== fields.ruc) {
      throw new AppError(
        `RUC mismatch: source issuer RUC (${source.ruc}) does not match the supplied RUC (${fields.ruc}).`,
        400,
        ErrorCodes.RUC_MISMATCH
      );
    }
    encryptedPrivateKey = source.encrypted_private_key;
    certificatePem = source.certificate_pem;
    certFingerprint = source.cert_fingerprint;
    certExpiry = source.cert_expiry;
  }

  let newIssuer;
  try {
    newIssuer = await issuerModel.create({
      tenantId: tenant.id,
      ruc: fields.ruc,
      businessName: fields.businessName,
      tradeName: fields.tradeName || null,
      mainAddress: fields.mainAddress || null,
      branchCode: fields.branchCode,
      issuePointCode: fields.issuePointCode,
      emissionType: fields.emissionType,
      requiredAccounting: [true, 'true', '1', 1].includes(fields.requiredAccounting) ? 'SI' : 'NO',
      specialTaxpayer: fields.specialTaxpayer || null,
      branchAddress: fields.branchAddress || null,
      encryptedPrivateKey,
      certificatePem,
      certFingerprint,
      certExpiry,
    });
  } catch (err) {
    if (err.code === '23505') {
      throw new ConflictError(`Issuer with RUC ${fields.ruc}, branch ${fields.branchCode}, issue point ${fields.issuePointCode} already exists`);
    }
    throw err;
  }

  const documentTypes = Array.isArray(fields.documentTypes) && fields.documentTypes.length > 0
    ? [...new Set(fields.documentTypes)]
    : ['01'];
  await issuerDocumentTypeModel.bulkCreate(newIssuer.id, documentTypes);

  const sequentialMap = {};
  if (Array.isArray(fields.initialSequentials)) {
    for (const entry of fields.initialSequentials) {
      sequentialMap[entry.documentType] = parseInt(entry.sequential, 10);
    }
  }
  for (const docType of documentTypes) {
    await sequentialService.initialize(
      newIssuer.id,
      newIssuer.branch_code,
      newIssuer.issue_point_code,
      docType,
      sequentialMap[docType] || 1,
      tenant.sandbox,
    );
  }

  // Admin issuer creation does NOT mint an API key — the tenant already has its own keys.
  // If this is the first issuer for a brand-new admin-created tenant, mint a key separately
  // via createApiKey.

  return { issuer: formatIssuer(newIssuer) };
}

async function listIssuers() {
  const rows = await issuerModel.findAll();
  return rows.map(formatIssuer);
}

async function createApiKey(tenantId, label, environment, revokeExistingInEnv = false) {
  const tenant = await tenantModel.findById(tenantId);
  if (!tenant) throw new NotFoundError('Tenant');

  // Default to the tenant's current active environment rather than hardcoding
  // 'sandbox' — a tenant already promoted to production should get production
  // keys by default unless the admin explicitly asks for sandbox.
  const resolvedEnvironment = environment || (tenant.sandbox ? 'sandbox' : 'production');
  if (!['sandbox', 'production'].includes(resolvedEnvironment)) {
    throw new AppError(`environment must be 'sandbox' or 'production', got: '${resolvedEnvironment}'`, 400);
  }
  if (revokeExistingInEnv) {
    await apiKeyModel.revokeAllByTenantIdAndEnvironment(tenantId, resolvedEnvironment);
  }
  const plainToken = crypto.randomBytes(32).toString('hex');
  await apiKeyModel.create({
    tenantId,
    keyHash: sha256Hex(plainToken),
    label: label || null,
    environment: resolvedEnvironment,
  });
  return plainToken;
}

// Promotes a tenant to production. No tenant-status check — admin can override.
// For the user-facing version (which enforces ACTIVE status), see tenant.service.js.
async function promoteTenant(tenantId, initialSequentials = []) {
  const tenant = await tenantModel.findById(tenantId);
  if (!tenant) throw new NotFoundError('Tenant');
  if (!tenant.sandbox) throw new ConflictError('Tenant is already in production');

  // Build lookup: { issuerId: { documentType: sequential } }
  const seqMap = {};
  for (const entry of initialSequentials) {
    if (!seqMap[entry.issuerId]) seqMap[entry.issuerId] = {};
    seqMap[entry.issuerId][entry.documentType] = parseInt(entry.sequential, 10);
  }

  // Seed production sequentials for every issuer × document type.
  const issuers = await issuerModel.findAllByTenantId(tenantId);
  for (const issuer of issuers) {
    const docTypes = await issuerDocumentTypeModel.findActiveByIssuerId(issuer.id);
    for (const docType of docTypes) {
      const seq = seqMap[issuer.id]?.[docType] || 1;
      await sequentialService.initialize(issuer.id, issuer.branch_code, issuer.issue_point_code, docType, seq, false);
    }
  }

  // Revoke all sandbox keys and create matching production keys (same labels).
  // KEY_MIRRORING: the tenant receives one new production token per sandbox key
  // that was active at the time of promotion. All tokens are returned in the
  // response and shown once — store them immediately.
  const sandboxKeys = await apiKeyModel.findActiveByTenantId(tenantId);
  await apiKeyModel.revokeAllByTenantIdAndEnvironment(tenantId, 'sandbox');
  const apiKeys = [];
  for (const key of sandboxKeys) {
    const plainToken = crypto.randomBytes(32).toString('hex');
    await apiKeyModel.create({ tenantId, keyHash: sha256Hex(plainToken), label: key.label, environment: 'production' });
    apiKeys.push({ label: key.label, apiKey: plainToken });
  }

  await tenantModel.promote(tenantId);
  return { apiKeys };
}

async function revokeApiKey(id) {
  const row = await apiKeyModel.revoke(id);
  if (!row) throw new NotFoundError('API key');
  return row;
}

async function renewIssuerCertificate(issuerId, p12Buffer, p12Password) {
  const issuer = await issuerModel.findById(issuerId);
  if (!issuer) throw new NotFoundError('Issuer', ErrorCodes.ISSUER_NOT_FOUND);

  const parsed = certificateService.parseCertificate(p12Buffer, p12Password || '');
  const updated = await issuerModel.updateCertificate(issuer.id, issuer.tenant_id, {
    encryptedPrivateKey: cryptoService.encrypt(parsed.privateKeyPem),
    certificatePem: parsed.certPem,
    certFingerprint: parsed.certFingerprint,
    certExpiry: parsed.certExpiry,
  });
  return { certFingerprint: updated.cert_fingerprint, certExpiry: updated.cert_expiry };
}

module.exports = {
  createTenant, listTenants, updateTenantTier, updateTenantStatus, verifyTenant, listTenantEvents,
  createIssuer, listIssuers, createApiKey, revokeApiKey, promoteTenant, renewIssuerCertificate,
};
