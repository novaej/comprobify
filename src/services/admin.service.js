const crypto = require('crypto');
const tenantModel = require('../models/tenant.model');
const issuerModel = require('../models/issuer.model');
const apiKeyModel = require('../models/api-key.model');
const issuerDocumentTypeModel = require('../models/issuer-document-type.model');
const sequentialService = require('./sequential.service');
const cryptoService = require('./crypto.service');
const certificateService = require('./certificate.service');
const AppError = require('../errors/app-error');
const ConflictError = require('../errors/conflict-error');
const TIERS = require('../constants/subscription-tiers');
const TenantStatus = require('../constants/tenant-status');

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function formatTenant(row) {
  return {
    id: row.id,
    email: row.email,
    subscriptionTier: row.subscription_tier,
    status: row.status,
    invoiceQuota: row.invoice_quota,
    invoiceCount: row.invoice_count,
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
    environment: row.environment,
    branchCode: row.branch_code,
    issuePointCode: row.issue_point_code,
    certFingerprint: row.cert_fingerprint,
    certExpiry: row.cert_expiry,
    sandbox: row.sandbox,
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
  const row = await tenantModel.create({
    email: fields.email,
    subscriptionTier: tier,
    status: TenantStatus.ACTIVE,
    invoiceQuota: TIERS[tier]?.invoiceQuota ?? 100,
  });
  return formatTenant(row);
}

async function listTenants() {
  const rows = await tenantModel.findAll();
  return rows.map(formatTenant);
}

async function updateTenantTier(id, tier) {
  if (!TIERS[tier]) {
    throw new AppError(`Unknown tier: ${tier}`, 400);
  }
  const row = await tenantModel.updateTier(id, tier, TIERS[tier].invoiceQuota);
  if (!row) throw new AppError('Tenant not found', 404);
  return formatTenant(row);
}

async function updateTenantStatus(id, status) {
  const allowed = Object.values(TenantStatus);
  if (!allowed.includes(status)) {
    throw new AppError(`Invalid status: ${status}`, 400);
  }
  const row = await tenantModel.updateStatus(id, status);
  if (!row) throw new AppError('Tenant not found', 404);
  return formatTenant(row);
}

async function verifyTenant(id) {
  const row = await tenantModel.activate(id);
  if (!row) throw new AppError('Tenant not found', 404);
  return formatTenant(row);
}

// --- Issuer management ---

async function createIssuer(fields, p12Buffer, p12Password, sourceIssuerId) {
  const tenant = await tenantModel.findById(fields.tenantId);
  if (!tenant) throw new AppError('Tenant not found', 404);

  const tierConfig = TIERS[tenant.subscription_tier];
  if (tierConfig.maxIssuers !== null) {
    const count = await tenantModel.countIssuersByTenantId(tenant.id);
    if (count >= tierConfig.maxIssuers) {
      throw new AppError(
        `Tenant has reached the issuer limit for the ${tenant.subscription_tier} plan (${tierConfig.maxIssuers})`,
        402
      );
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
    if (!source) throw new AppError('Source issuer not found', 404);
    if (source.ruc !== fields.ruc) {
      throw new AppError('RUC mismatch: source issuer RUC does not match the supplied RUC', 400);
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
      environment: fields.environment,
      emissionType: fields.emissionType,
      requiredAccounting: [true, 'true', '1', 1].includes(fields.requiredAccounting) ? 'SI' : 'NO',
      specialTaxpayer: fields.specialTaxpayer || null,
      branchAddress: fields.branchAddress || null,
      encryptedPrivateKey,
      certificatePem,
      certFingerprint,
      certExpiry,
      sandbox: fields.sandbox === false || fields.sandbox === 'false' || fields.sandbox === 0 || fields.sandbox === '0' ? false : true,
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
      newIssuer.sandbox,
    );
  }

  const plainToken = crypto.randomBytes(32).toString('hex');
  await apiKeyModel.create({
    issuerId: newIssuer.id,
    keyHash: sha256Hex(plainToken),
    label: 'Initial key',
    environment: newIssuer.sandbox ? 'sandbox' : 'production',
  });

  return { issuer: formatIssuer(newIssuer), apiKey: plainToken };
}

async function listIssuers() {
  const rows = await issuerModel.findAll();
  return rows.map(formatIssuer);
}

async function createApiKey(issuerId, label, revokeExisting = false) {
  const issuer = await issuerModel.findById(issuerId);
  if (!issuer) throw new AppError('Issuer not found', 404);
  if (revokeExisting) {
    await apiKeyModel.revokeAllByIssuerId(issuerId);
  }
  const plainToken = crypto.randomBytes(32).toString('hex');
  await apiKeyModel.create({
    issuerId,
    keyHash: sha256Hex(plainToken),
    label: label || null,
    environment: issuer.sandbox ? 'sandbox' : 'production',
  });
  return plainToken;
}

async function promoteIssuer(id, initialSequentials = []) {
  const issuer = await issuerModel.findById(id);
  if (!issuer) throw new AppError('Issuer not found', 404);
  if (!issuer.sandbox) throw new ConflictError('Issuer is already in production');

  await issuerModel.promote(id);
  await apiKeyModel.revokeAllByIssuerIdAndEnvironment(id, 'sandbox');

  const documentTypes = await issuerDocumentTypeModel.findActiveByIssuerId(id);
  const sequentialMap = {};
  for (const entry of initialSequentials) {
    sequentialMap[entry.documentType] = parseInt(entry.sequential, 10);
  }
  for (const docType of documentTypes) {
    await sequentialService.initialize(
      id,
      issuer.branch_code,
      issuer.issue_point_code,
      docType,
      sequentialMap[docType] || 1,
      false,
    );
  }

  const plainToken = crypto.randomBytes(32).toString('hex');
  await apiKeyModel.create({
    issuerId: id,
    keyHash: sha256Hex(plainToken),
    label: 'Production key',
    environment: 'production',
  });

  return { issuer: formatIssuer({ ...issuer, sandbox: false }), apiKey: plainToken };
}

async function revokeApiKey(id) {
  const row = await apiKeyModel.revoke(id);
  if (!row) throw new AppError('API key not found', 404);
  return row;
}

module.exports = {
  createTenant, listTenants, updateTenantTier, updateTenantStatus, verifyTenant,
  createIssuer, listIssuers, createApiKey, revokeApiKey, promoteIssuer,
};
