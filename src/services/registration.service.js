const crypto = require('crypto');
const tenantModel = require('../models/tenant.model');
const issuerModel = require('../models/issuer.model');
const apiKeyModel = require('../models/api-key.model');
const sequentialService = require('./sequential.service');
const cryptoService = require('./crypto.service');
const certificateService = require('./certificate.service');
const emailService = require('./email.service');
const tenantEventModel = require('../models/tenant-event.model');
const issuerDocumentTypeModel = require('../models/issuer-document-type.model');
const ConflictError = require('../errors/conflict-error');
const TIERS = require('../constants/subscription-tiers');
const TenantStatus = require('../constants/tenant-status');
const config = require('../config');

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

async function register(fields, p12Buffer, p12Password) {
  const existing = await tenantModel.findByEmail(fields.email);
  if (existing) {
    if (existing.status === TenantStatus.SUSPENDED) {
      throw new Error('SUSPENDED');
    }
    const issuer = await issuerModel.findByTenantId(existing.id);
    if (!issuer) {
      throw new ConflictError(`An account with email ${fields.email} already exists`);
    }
    await apiKeyModel.revokeAllByIssuerIdAndEnvironment(issuer.id, 'sandbox');
    const plainToken = crypto.randomBytes(32).toString('hex');
    await apiKeyModel.create({
      issuerId: issuer.id,
      keyHash: sha256Hex(plainToken),
      label: 'Recovery sandbox key',
      environment: 'sandbox',
    });
    return {
      tenant: formatTenant(existing),
      issuer: {
        id: issuer.id,
        ruc: issuer.ruc,
        businessName: issuer.business_name,
        tradeName: issuer.trade_name,
        environment: issuer.environment,
        branchCode: issuer.branch_code,
        issuePointCode: issuer.issue_point_code,
        certFingerprint: issuer.cert_fingerprint,
        certExpiry: issuer.cert_expiry,
        sandbox: issuer.sandbox,
      },
      apiKey: plainToken,
      recovered: true,
    };
  }

  const existingIssuer = await issuerModel.findByRuc(fields.ruc);
  if (existingIssuer) {
    throw new ConflictError(`RUC ${fields.ruc} is already registered`);
  }

  const parsed = certificateService.parseCertificate(p12Buffer, p12Password || '');
  const encryptedPrivateKey = cryptoService.encrypt(parsed.privateKeyPem);

  const verificationToken = crypto.randomBytes(32).toString('hex');
  const verificationTokenExpiresAt = new Date(Date.now() + config.verificationTokenTtlHours * 60 * 60 * 1000);

  const tier = TIERS.FREE;

  let tenant, issuer, plainToken;
  try {
    tenant = await tenantModel.create({
      email: fields.email,
      subscriptionTier: 'FREE',
      status: TenantStatus.PENDING_VERIFICATION,
      invoiceQuota: tier.invoiceQuota,
      verificationToken,
      verificationTokenExpiresAt,
      verificationRedirectUrl: fields.verificationRedirectUrl || null,
      preferredLanguage: fields.language || 'es',
    });

    issuer = await issuerModel.create({
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
      certificatePem: parsed.certPem,
      certFingerprint: parsed.certFingerprint,
      certExpiry: parsed.certExpiry,
      sandbox: true,
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
  await issuerDocumentTypeModel.bulkCreate(issuer.id, documentTypes);

  const sequentialMap = {};
  if (Array.isArray(fields.initialSequentials)) {
    for (const entry of fields.initialSequentials) {
      sequentialMap[entry.documentType] = parseInt(entry.sequential, 10);
    }
  }
  for (const docType of documentTypes) {
    await sequentialService.initialize(
      issuer.id,
      issuer.branch_code,
      issuer.issue_point_code,
      docType,
      sequentialMap[docType] || 1,
      true,
    );
  }

  plainToken = crypto.randomBytes(32).toString('hex');
  await apiKeyModel.create({
    issuerId: issuer.id,
    keyHash: sha256Hex(plainToken),
    label: 'Initial sandbox key',
    environment: 'sandbox',
  });

  // Fire-and-forget — don't fail registration if email sending fails
  if (config.email.provider !== 'none') {
    emailService.sendVerificationEmail(fields.email, verificationToken, fields.verificationRedirectUrl || null, fields.language || 'es')
      .then(({ messageId }) => Promise.all([
        tenantModel.updateVerificationEmailSent(tenant.id, messageId),
        tenantEventModel.create(tenant.id, 'VERIFICATION_EMAIL_SENT'),
      ]))
      .catch((err) => tenantEventModel.create(tenant.id, 'VERIFICATION_EMAIL_FAILED', { error: err.message }).catch(() => {}));
  }

  return {
    tenant: formatTenant(tenant),
    issuer: {
      id: issuer.id,
      ruc: issuer.ruc,
      businessName: issuer.business_name,
      tradeName: issuer.trade_name,
      environment: issuer.environment,
      branchCode: issuer.branch_code,
      issuePointCode: issuer.issue_point_code,
      certFingerprint: issuer.cert_fingerprint,
      certExpiry: issuer.cert_expiry,
      sandbox: issuer.sandbox,
    },
    apiKey: plainToken,
  };
}

const RESEND_COOLDOWN_MS = 60 * 1000;

async function resendVerification(email) {
  const tenant = await tenantModel.findByEmail(email);
  if (!tenant) return; // don't leak whether email exists

  if (tenant.status === TenantStatus.ACTIVE) {
    const err = new Error('ALREADY_VERIFIED');
    err.tenantStatus = tenant.status;
    throw err;
  }
  if (tenant.status === TenantStatus.SUSPENDED) {
    const err = new Error('SUSPENDED');
    err.tenantStatus = tenant.status;
    throw err;
  }

  if (tenant.verification_email_sent_at) {
    const elapsed = Date.now() - new Date(tenant.verification_email_sent_at).getTime();
    if (elapsed < RESEND_COOLDOWN_MS) {
      throw new Error('RESEND_COOLDOWN');
    }
  }

  const verificationToken = crypto.randomBytes(32).toString('hex');
  const verificationTokenExpiresAt = new Date(Date.now() + config.verificationTokenTtlHours * 60 * 60 * 1000);
  await tenantModel.updateVerificationToken(tenant.id, verificationToken, verificationTokenExpiresAt);

  if (config.email.provider !== 'none') {
    emailService.sendVerificationEmail(email, verificationToken, tenant.verification_redirect_url || null, tenant.preferred_language || 'es')
      .then(({ messageId }) => Promise.all([
        tenantModel.updateVerificationEmailSent(tenant.id, messageId),
        tenantEventModel.create(tenant.id, 'VERIFICATION_EMAIL_SENT'),
      ]))
      .catch((err) => tenantEventModel.create(tenant.id, 'VERIFICATION_EMAIL_FAILED', { error: err.message }).catch(() => {}));
  }
}

async function verifyEmail(token) {
  const tenant = await tenantModel.findByVerificationToken(token);
  if (!tenant) {
    throw new Error('INVALID_TOKEN');
  }
  await tenantModel.activate(tenant.id);
  await tenantEventModel.create(tenant.id, 'EMAIL_VERIFIED');
}

module.exports = { register, resendVerification, verifyEmail, formatTenant };
