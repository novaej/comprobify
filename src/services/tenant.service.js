const crypto = require('crypto');
const tenantModel = require('../models/tenant.model');
const subscriptionModel = require('../models/subscription.model');
const issuerModel = require('../models/issuer.model');
const apiKeyModel = require('../models/api-key.model');
const issuerDocumentTypeModel = require('../models/issuer-document-type.model');
const tenantEventModel = require('../models/tenant-event.model');
const sequentialService = require('./sequential.service');
const subscriptionService = require('./subscription.service');
const tenantAgreementService = require('./tenant-agreement.service');
const { formatTenantEvent } = require('../presenters/tenant-event.presenter');
const AppError = require('../errors/app-error');
const ConflictError = require('../errors/conflict-error');
const NotFoundError = require('../errors/not-found-error');
const TenantStatus = require('../constants/tenant-status');
const ErrorCodes = require('../constants/error-codes');

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function updateLanguage(tenantId, language) {
  await tenantModel.updatePreferredLanguage(tenantId, language);
}

async function getAgreementStatus(tenantId) {
  const tenant = await tenantModel.findById(tenantId);
  if (!tenant) throw new NotFoundError('Tenant');
  return tenantAgreementService.getStatus(tenantId);
}

// Full tenant-level audit trail — verification, subscription, payment, and
// tier/interval-change lifecycle events — so a tenant can see e.g. it had a
// GROWTH monthly subscription that later changed to STARTER yearly.
async function getEvents(tenantId) {
  const tenant = await tenantModel.findById(tenantId);
  if (!tenant) throw new NotFoundError('Tenant');
  const events = await tenantEventModel.findByTenantId(tenantId);
  return events.map(formatTenantEvent);
}

// Accepts all PENDING tenant legal document instances in one call — matches
// the single-checkbox UX. termsVersion confirms the frontend was current.
async function acceptAgreements(tenantId, termsVersion, { ip, userAgent } = {}) {
  await tenantAgreementService.validateTermsVersion(termsVersion);
  await tenantAgreementService.acceptAll(tenantId, { ip, userAgent });
  await tenantModel.updateAgreementAcceptance(tenantId, termsVersion);
}

async function promote(tenantId, initialSequentials = [], tier = null, billingInterval = 'MONTHLY') {
  const tenant = await tenantModel.findById(tenantId);
  if (!tenant) throw new NotFoundError('Tenant');
  if (tenant.status !== TenantStatus.ACTIVE) {
    throw new AppError(
      'Email verification is required before promoting to production. Check your inbox.',
      403,
      ErrorCodes.EMAIL_VERIFICATION_REQUIRED
    );
  }
  if (!tenant.sandbox) throw new ConflictError('Tenant is already in production');

  const allAccepted = await tenantAgreementService.hasAllAccepted(tenantId);
  if (!allAccepted) {
    throw new AppError(
      'All legal documents must be accepted before promoting to production. Review GET /v1/tenants/agreements.',
      403,
      ErrorCodes.AGREEMENT_ACCEPTANCE_REQUIRED
    );
  }

  const seqMap = {};
  for (const entry of initialSequentials) {
    if (!seqMap[entry.issuerId]) seqMap[entry.issuerId] = {};
    seqMap[entry.issuerId][entry.documentType] = parseInt(entry.sequential, 10);
  }

  const issuers = await issuerModel.findAllByTenantId(tenantId);
  for (const issuer of issuers) {
    const docTypes = await issuerDocumentTypeModel.findActiveByIssuerId(issuer.id);
    for (const docType of docTypes) {
      const seq = seqMap[issuer.id]?.[docType] || 1;
      await sequentialService.initialize(issuer.id, issuer.branch_code, issuer.issue_point_code, docType, seq, false);
    }
  }

  const sandboxKeys = await apiKeyModel.findActiveByTenantId(tenantId);
  await apiKeyModel.revokeAllByTenantIdAndEnvironment(tenantId, 'sandbox');
  const apiKeys = [];
  for (const key of sandboxKeys) {
    const plainToken = crypto.randomBytes(32).toString('hex');
    await apiKeyModel.create({ tenantId, keyHash: sha256Hex(plainToken), label: key.label, environment: 'production' });
    apiKeys.push({ label: key.label, apiKey: plainToken });
  }

  await tenantModel.promote(tenantId);

  // A subscription started while still in sandbox (POST /v1/subscriptions, see
  // subscriptionService.createSubscriptionForTenant) may already be ACTIVE by the
  // time promotion happens — nothing left to select, just surface what's running.
  const activeSubscription = await subscriptionModel.findActiveByTenantId(tenantId);

  // Reset the billing period to start at promotion time rather than at the
  // moment the subscription was activated in sandbox. The paid period should
  // count production usage, not sandbox testing time.
  if (activeSubscription) {
    await subscriptionService.resetPeriodOnPromotion(activeSubscription.id);
  }

  // Promotion itself never waits on payment — production access is granted on FREE
  // immediately. Requesting a paid tier here only kicks off the subscription pipeline
  // in the background; the tier/quota upgrade only lands once it's paid and authorized.
  let billing = null;
  if (activeSubscription) {
    billing = { subscription: activeSubscription };
  } else if (tier && tier !== 'FREE') {
    billing = await subscriptionService.createSubscription(tenantId, tier, billingInterval);
  }

  return { apiKeys, ...billing };
}

module.exports = { updateLanguage, promote, getAgreementStatus, acceptAgreements, getEvents };
