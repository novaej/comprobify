const crypto = require('crypto');
const db = require('../config/database');
const tenantModel = require('../models/tenant.model');
const issuerModel = require('../models/issuer.model');
const apiKeyModel = require('../models/api-key.model');
const sequentialService = require('./sequential.service');
const tenantQuotaService = require('./tenant-quota.service');
const cryptoService = require('./crypto.service');
const certificateService = require('./certificate.service');
const emailService = require('./email.service');
const tenantEventModel = require('../models/tenant-event.model');
const issuerDocumentTypeModel = require('../models/issuer-document-type.model');
const tenantAgreementService = require('./tenant-agreement.service');
const AppError = require('../errors/app-error');
const ConflictError = require('../errors/conflict-error');
const { TIERS } = require('../constants/subscription-tiers');
const TenantStatus = require('../constants/tenant-status');
const ErrorCodes = require('../constants/error-codes');
const config = require('../config');

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function formatTenant(row, quotaRow = null) {
  return {
    id: row.id,
    email: row.email,
    subscriptionTier: row.subscription_tier,
    status: row.status,
    documentQuota: quotaRow?.document_quota ?? null,
    documentCount: quotaRow?.document_count ?? null,
    createdAt: row.created_at,
    agreementAcceptedAt: row.agreement_accepted_at,
    agreementVersion: row.agreement_version,
  };
}

async function register(fields, p12Buffer, p12Password, logoBuffer = null) {
  const existing = await tenantModel.findByEmail(fields.email);
  if (existing) {
    throw new ConflictError(
      `An account with email ${fields.email} already exists. Use POST /v1/recover to regain access.`
    );
  }

  const existingIssuer = await issuerModel.findByRuc(fields.ruc);
  if (existingIssuer) {
    throw new ConflictError(`RUC ${fields.ruc} is already registered`);
  }

  // Validate against the published TERMS document, but only once something has
  // actually been published — pre-launch, before any documents exist via the
  // admin endpoint, there's nothing authoritative to check against, so
  // termsVersion is trusted as-is (matches the original "API just records it"
  // behavior for that case).
  await tenantAgreementService.validateTermsVersion(fields.termsVersion);

  const parsed = certificateService.parseCertificate(p12Buffer, p12Password || '');
  const encryptedPrivateKey = cryptoService.encrypt(parsed.privateKeyPem);

  const verificationToken = crypto.randomBytes(32).toString('hex');
  const verificationTokenExpiresAt = new Date(Date.now() + config.verificationTokenTtlHours * 60 * 60 * 1000);

  const tier = TIERS.FREE;

  let tenant, issuer, plainToken, quotaRow;
  try {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      tenant = await tenantModel.create({
        email: fields.email,
        subscriptionTier: 'FREE',
        status: TenantStatus.PENDING_VERIFICATION,
        verificationToken,
        verificationTokenExpiresAt,
        verificationRedirectUrl: fields.verificationRedirectUrl || null,
        preferredLanguage: fields.language || 'es',
        legalVersion: fields.termsVersion,
      }, client);
      quotaRow = await tenantQuotaService.initializeForTenant(tenant.id, tier.documentQuota, client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    issuer = await issuerModel.create({
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
      certificatePem: parsed.certPem,
      certFingerprint: parsed.certFingerprint,
      certExpiry: parsed.certExpiry,
      logo: logoBuffer,
    });
  } catch (err) {
    if (err.code === '23505') {
      throw new ConflictError(`Issuer with RUC ${fields.ruc}, branch ${fields.branchCode}, issue point ${fields.issuePointCode} already exists`);
    }
    throw err;
  }

  // Generate per-tenant legal document instances (PENDING) after the issuer
  // exists so we can substitute {{cliente.razonSocial}} etc. into the DPA.
  // Fire-and-forget pattern: failure does not block registration, and the
  // admin can backfill via POST /v1/admin/tenants/:id/agreements.
  tenantAgreementService.generateForTenant(tenant.id, issuer)
    .catch((err) => console.warn('[registration] generateForTenant failed:', err.message));

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
    tenantId: tenant.id,
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
    tenant: formatTenant(tenant, quotaRow),
    issuer: {
      id: issuer.id,
      ruc: issuer.ruc,
      businessName: issuer.business_name,
      tradeName: issuer.trade_name,
      branchCode: issuer.branch_code,
      issuePointCode: issuer.issue_point_code,
      certFingerprint: issuer.cert_fingerprint,
      certExpiry: issuer.cert_expiry,
    },
    apiKey: plainToken,
  };
}

// Recovery for a tenant who lost their API key. Deliberately a separate
// endpoint from register() rather than an implicit branch of it — that
// used to leak account existence (a certificate mismatch on an existing
// email returned a distinct error from a genuinely new email). A matching
// certificate is the same ownership bar fresh registration accepts, so a
// real match issues a key synchronously; anything else (unregistered
// email, no issuer, wrong certificate) returns the identical generic
// response so none of those cases are distinguishable from one another.
async function recover(email, p12Buffer, p12Password) {
  // Parse the certificate BEFORE any tenant lookup — a corrupt/wrong-password/
  // expired P12 fails identically whether or not the email is registered, so
  // certificate errors never correlate with account existence.
  const uploaded = certificateService.parseCertificate(p12Buffer, p12Password || '');

  const tenant = await tenantModel.findByEmail(email);
  const issuer = tenant ? await issuerModel.findByTenantId(tenant.id) : null;

  if (!tenant || !issuer || uploaded.certFingerprint !== issuer.cert_fingerprint) {
    return { ok: true, message: 'If this email and certificate match an existing account, a new key has been issued.' };
  }

  // Suspension is only revealed to a caller who already proved ownership via
  // a matching certificate — a caller with the wrong cert already got the
  // generic response above and learns nothing about account status.
  if (tenant.status === TenantStatus.SUSPENDED) {
    throw new AppError('This account has been suspended.', 403, ErrorCodes.ACCOUNT_SUSPENDED);
  }

  // Environment is resolved from the tenant's actual current environment,
  // not hardcoded to sandbox, so a promoted (production) tenant's real key
  // gets recovered too.
  const environment = tenant.sandbox ? 'sandbox' : 'production';
  console.warn(`[registration] recovery key issued for tenant ${tenant.id} (${environment})`);
  await apiKeyModel.revokeAllByTenantIdAndEnvironment(tenant.id, environment);
  const plainToken = crypto.randomBytes(32).toString('hex');
  await apiKeyModel.create({
    tenantId: tenant.id,
    keyHash: sha256Hex(plainToken),
    label: 'Recovery key',
    environment,
  });

  // Fire-and-forget a fresh verification email as an out-of-band notice,
  // reusing the existing token/email/redemption machinery instead of a
  // parallel one — harmless no-op if clicked by an already-ACTIVE tenant;
  // the value is the email itself landing in the inbox as a signal that
  // recovery just happened.
  if (config.email.provider !== 'none') {
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationTokenExpiresAt = new Date(Date.now() + config.verificationTokenTtlHours * 60 * 60 * 1000);
    tenantModel.updateVerificationToken(tenant.id, verificationToken, verificationTokenExpiresAt)
      .then(() => emailService.sendVerificationEmail(email, verificationToken, tenant.verification_redirect_url || null, tenant.preferred_language || 'es'))
      .then(({ messageId }) => Promise.all([
        tenantModel.updateVerificationEmailSent(tenant.id, messageId),
        tenantEventModel.create(tenant.id, 'VERIFICATION_EMAIL_SENT'),
      ]))
      .catch((err) => tenantEventModel.create(tenant.id, 'VERIFICATION_EMAIL_FAILED', { error: err.message }).catch(() => {}));
  }

  const quotaRow = await tenantQuotaService.getCurrentForTenant(tenant.id);
  return {
    ok: true,
    tenant: formatTenant(tenant, quotaRow),
    issuer: {
      id: issuer.id,
      ruc: issuer.ruc,
      businessName: issuer.business_name,
      tradeName: issuer.trade_name,
      branchCode: issuer.branch_code,
      issuePointCode: issuer.issue_point_code,
      certFingerprint: issuer.cert_fingerprint,
      certExpiry: issuer.cert_expiry,
    },
    apiKey: plainToken,
    environment,
  };
}

const RESEND_COOLDOWN_MS = 60 * 1000;

async function resendVerification(email, verificationRedirectUrl) {
  const tenant = await tenantModel.findByEmail(email);
  if (!tenant) return; // don't leak whether email exists

  if (tenant.status === TenantStatus.ACTIVE) {
    throw new ConflictError('This account is already verified.', ErrorCodes.ALREADY_VERIFIED);
  }
  if (tenant.status === TenantStatus.SUSPENDED) {
    throw new AppError('This account has been suspended.', 403, ErrorCodes.ACCOUNT_SUSPENDED);
  }

  if (tenant.verification_email_sent_at) {
    const elapsed = Date.now() - new Date(tenant.verification_email_sent_at).getTime();
    if (elapsed < RESEND_COOLDOWN_MS) {
      throw new AppError(
        'Please wait before requesting another verification email.',
        429,
        ErrorCodes.RESEND_COOLDOWN
      );
    }
  }

  const verificationToken = crypto.randomBytes(32).toString('hex');
  const verificationTokenExpiresAt = new Date(Date.now() + config.verificationTokenTtlHours * 60 * 60 * 1000);
  await tenantModel.updateVerificationToken(tenant.id, verificationToken, verificationTokenExpiresAt);

  const effectiveRedirectUrl = verificationRedirectUrl !== undefined
    ? (verificationRedirectUrl || null)
    : (tenant.verification_redirect_url || null);
  if (verificationRedirectUrl !== undefined) {
    await tenantModel.updateVerificationRedirectUrl(tenant.id, effectiveRedirectUrl);
  }

  if (config.email.provider !== 'none') {
    emailService.sendVerificationEmail(email, verificationToken, effectiveRedirectUrl, tenant.preferred_language || 'es')
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
    throw new AppError(
      'Verification token is invalid or has expired.',
      400,
      ErrorCodes.INVALID_OR_EXPIRED_TOKEN
    );
  }
  await tenantModel.activate(tenant.id);
  await tenantEventModel.create(tenant.id, 'EMAIL_VERIFIED');
  return { email: tenant.email };
}

module.exports = { register, recover, resendVerification, verifyEmail, formatTenant };
