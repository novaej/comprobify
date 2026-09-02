const adminService = require('../services/admin.service');
const notificationSchedulerService = require('../services/notification-scheduler.service');
const subscriptionService = require('../services/subscription.service');
const tenantQuotaService = require('../services/tenant-quota.service');
const queueReconciliationService = require('../services/queue-reconciliation.service');
const payphonePaymentService = require('../services/payphone-payment.service');
const agreementService = require('../services/agreement.service');
const tenantAgreementService = require('../services/tenant-agreement.service');
const notificationEmailTemplateService = require('../services/notification-email-template.service');
const pricingService = require('../services/pricing.service');
const rideService = require('../services/ride.service');
const issuerModel = require('../models/issuer.model');
const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');

// Tenants
const createTenant = async (req, res) => {
  const tenant = await adminService.createTenant(req.body);
  res.status(201).json({ ok: true, tenant });
};

const listTenants = async (req, res) => {
  const tenants = await adminService.listTenants();
  res.json({ ok: true, tenants });
};

const updateTenantTier = async (req, res) => {
  const tenant = await adminService.updateTenantTier(req.params.id, req.body.subscriptionTier);
  res.json({ ok: true, tenant });
};

const updateTenantStatus = async (req, res) => {
  const tenant = await adminService.updateTenantStatus(req.params.id, req.body.status, req.body.suspensionReasonCode ?? null);
  res.json({ ok: true, tenant });
};

const verifyTenant = async (req, res) => {
  const tenant = await adminService.verifyTenant(req.params.id);
  res.json({ ok: true, tenant });
};

const listTenantEvents = async (req, res) => {
  const events = await adminService.listTenantEvents(req.params.id);
  res.json({ ok: true, events });
};

// Issuers
const createIssuer = async (req, res) => {
  const { issuer } = await adminService.createIssuer(
    req.body,
    req.file?.buffer,
    req.body.certPassword,
    req.body.sourceIssuerId,
  );
  res.status(201).json({ ok: true, issuer });
};

const listIssuers = async (req, res) => {
  const issuers = await adminService.listIssuers();
  res.json({ ok: true, issuers });
};

const renewIssuerCertificate = async (req, res) => {
  if (!req.file) {
    throw new AppError('A P12 certificate file is required', 400, ErrorCodes.INVALID_FILE_UPLOAD);
  }
  const { certFingerprint, certExpiry } = await adminService.renewIssuerCertificate(
    req.params.id,
    req.file.buffer,
    req.body.certPassword,
  );
  res.json({ ok: true, certFingerprint, certExpiry });
};

const promoteTenant = async (req, res) => {
  const { apiKeys } = await adminService.promoteTenant(
    req.params.id,
    req.body.initialSequentials || [],
  );
  res.json({ ok: true, apiKeys });
};

// API keys
const createApiKey = async (req, res) => {
  const tenantId = req.params.id;
  const apiKey = await adminService.createApiKey(
    tenantId,
    req.body.label,
    req.body.environment,
    req.body.revokeExisting === true,
  );
  res.status(201).json({ ok: true, apiKey });
};

const listApiKeys = async (req, res) => {
  const keys = await adminService.listApiKeys(req.params.id);
  res.json({ ok: true, keys });
};

const getApiKeyUsage = async (req, res) => {
  const days = req.query.days ? parseInt(req.query.days, 10) : 30;
  const usage = await adminService.getApiKeyUsage(req.params.id, req.params.keyId, days);
  res.json({ ok: true, usage });
};

const revokeApiKey = async (req, res) => {
  await adminService.revokeApiKey(req.params.id);
  res.json({ ok: true });
};

// Subscriptions & payments
const createSubscription = async (req, res) => {
  const result = await subscriptionService.createSubscription(
    req.params.id,
    req.body.tier,
    req.body.billingInterval,
  );
  res.status(201).json({ ok: true, ...result });
};

const listSubscriptions = async (req, res) => {
  const subscriptions = await subscriptionService.listByTenant(req.params.id);
  res.json({ ok: true, subscriptions });
};

const linkInvoice = async (req, res) => {
  const subscription = await subscriptionService.linkInvoice(req.params.id, req.body.accessKey);
  res.json({ ok: true, subscription });
};

const cancelSubscription = async (req, res) => {
  const subscription = await subscriptionService.cancelSubscription(req.params.id);
  res.json({ ok: true, subscription });
};

const reviewPayment = async (req, res) => {
  const result = await subscriptionService.reviewPayment(
    req.params.id,
    req.body.decision,
    req.body.rejectionReasonCode,
  );
  res.json({ ok: true, ...result });
};

const listPaymentProofs = async (req, res) => {
  const proofs = await subscriptionService.listPaymentProofsForAdmin(req.params.id);
  res.json({ ok: true, proofs });
};

// Streams any proof file (active or soft-deleted) for full audit visibility.
const getPaymentProof = async (req, res) => {
  const { buffer, filename, mimeType } = await subscriptionService.getPaymentProofFile(
    req.params.id,
    req.params.proofId,
  );
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
};

const listPayments = async (req, res) => {
  const payments = await subscriptionService.listPendingPayments(req.query.status || 'REPORTED');
  res.json({ ok: true, payments });
};

// The operator's invoicing work queue — verified payments whose factura is
// still owed. Since ADR-027 this is what tracks the invoice obligation, rather
// than the tenant's access being withheld until it clears.
const listPendingInvoices = async (req, res) => {
  const result = await subscriptionService.listPendingInvoices();
  res.json({ ok: true, ...result });
};

const refundPayment = async (req, res) => {
  const result = await subscriptionService.refundPayment(req.params.id, req.body.reason ?? null);
  res.json({ ok: true, ...result });
};

// Legal documents

const generateTenantAgreements = async (req, res) => {
  const tenantId = req.params.id;
  const issuer = await issuerModel.findByTenantId(tenantId);
  const created = await tenantAgreementService.generateForTenant(tenantId, issuer);
  res.status(201).json({ ok: true, generated: created.length, documents: created.map((d) => ({
    id: d.id, documentType: d.document_type, templateVersion: d.template_version, status: d.status,
  }))});
};

const publishAgreement = async (req, res) => {
  const document = await agreementService.publish(
    req.body.documentType,
    req.body.version,
    req.body.contentMarkdown ?? null,
  );
  res.status(201).json({
    ok: true,
    document: { id: document.id, documentType: document.document_type, version: document.version, createdAt: document.created_at, isCurrent: true },
  });
};

const activateAgreement = async (req, res) => {
  const document = await agreementService.activateVersion(req.params.id);
  res.json({ ok: true, document: { id: document.id, documentType: document.document_type, version: document.version, isCurrent: document.is_current } });
};

const listAgreementVersions = async (req, res) => {
  const versions = await agreementService.listVersionsByType(req.params.type);
  res.json({ ok: true, versions });
};

const getAgreementVersion = async (req, res) => {
  const document = await agreementService.getById(req.params.id);
  res.json({
    ok: true,
    document: {
      id: document.id,
      documentType: document.document_type,
      version: document.version,
      contentMarkdown: document.content_markdown,
      isCurrent: document.is_current,
      createdAt: document.created_at,
    },
  });
};

const listCurrentNotificationEmailTemplates = async (req, res) => {
  const templates = await notificationEmailTemplateService.listCurrent();
  res.json({ ok: true, templates });
};

const publishNotificationEmailTemplate = async (req, res) => {
  const template = await notificationEmailTemplateService.publish(
    req.body.notificationType,
    req.body.language,
    req.body.version,
    req.body.rawContent ?? null,
  );
  res.status(201).json({
    ok: true,
    template: { id: template.id, notificationType: template.notification_type, language: template.language, version: template.version, createdAt: template.created_at, isCurrent: true },
  });
};

const activateNotificationEmailTemplate = async (req, res) => {
  const template = await notificationEmailTemplateService.activateVersion(req.params.id);
  res.json({ ok: true, template: { id: template.id, notificationType: template.notification_type, language: template.language, version: template.version, isCurrent: template.is_current } });
};

const listNotificationEmailTemplateVersions = async (req, res) => {
  const versions = await notificationEmailTemplateService.listVersions(req.params.type, req.params.language);
  res.json({ ok: true, versions });
};

const getNotificationEmailTemplateVersion = async (req, res) => {
  const template = await notificationEmailTemplateService.getById(req.params.id);
  res.json({
    ok: true,
    template: {
      id: template.id,
      notificationType: template.notification_type,
      language: template.language,
      version: template.version,
      subjectTemplate: template.subject_template,
      htmlTemplate: template.html_template,
      textTemplate: template.text_template,
      isCurrent: template.is_current,
      createdAt: template.created_at,
    },
  });
};

// Tier prices

function formatTierPrice(row) {
  return {
    id: row.id,
    tier: row.tier,
    billingInterval: row.billing_interval,
    priceUsd: parseFloat(row.price_usd),
    status: row.status,
    effectiveAt: row.effective_at,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  };
}

const createTierPrice = async (req, res) => {
  const row = await pricingService.createDraft({
    tier: req.body.tier,
    billingInterval: req.body.billingInterval,
    priceUsd: req.body.priceUsd,
  });
  res.status(201).json({ ok: true, price: formatTierPrice(row) });
};

const updateTierPrice = async (req, res) => {
  const row = await pricingService.updateDraft(req.params.id, req.body.priceUsd);
  res.json({ ok: true, price: formatTierPrice(row) });
};

const publishTierPrice = async (req, res) => {
  const row = await pricingService.publishPrice(req.params.id, { noticeDays: req.body.noticeDays });
  res.json({ ok: true, price: formatTierPrice(row) });
};

const listTierPrices = async (req, res) => {
  const rows = await pricingService.listPrices({ tier: req.query.tier });
  res.json({ ok: true, prices: rows.map(formatTierPrice) });
};

const getTierPrice = async (req, res) => {
  const row = await pricingService.getPriceById(req.params.id);
  res.json({ ok: true, price: formatTierPrice(row) });
};

// Seat prices (ADR-032) — same shape as tier prices, minus `tier`: the
// extra-seat add-on's price is flat across every tier.

function formatSeatPrice(row) {
  return {
    id: row.id,
    billingInterval: row.billing_interval,
    priceUsd: parseFloat(row.price_usd),
    status: row.status,
    effectiveAt: row.effective_at,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  };
}

const createSeatPrice = async (req, res) => {
  const row = await pricingService.createSeatPriceDraft({
    billingInterval: req.body.billingInterval,
    priceUsd: req.body.priceUsd,
  });
  res.status(201).json({ ok: true, price: formatSeatPrice(row) });
};

const updateSeatPrice = async (req, res) => {
  const row = await pricingService.updateSeatPriceDraft(req.params.id, req.body.priceUsd);
  res.json({ ok: true, price: formatSeatPrice(row) });
};

const publishSeatPrice = async (req, res) => {
  const row = await pricingService.publishSeatPrice(req.params.id, { noticeDays: req.body.noticeDays });
  res.json({ ok: true, price: formatSeatPrice(row) });
};

const listSeatPrices = async (req, res) => {
  const rows = await pricingService.listSeatPrices();
  res.json({ ok: true, prices: rows.map(formatSeatPrice) });
};

const getSeatPrice = async (req, res) => {
  const row = await pricingService.getSeatPriceById(req.params.id);
  res.json({ ok: true, price: formatSeatPrice(row) });
};

// Jobs

/**
 * POST /api/admin/jobs/notifications
 *
 * Run all periodic notification jobs across every non-suspended tenant:
 *   1. Certificate expiry checks — upsert CERT_EXPIRING / CERT_EXPIRED alerts.
 *   2. Webhook retry queue — re-attempt failed webhook deliveries past their
 *      scheduled next_retry_at time.
 *
 * This endpoint is designed to be called by an external scheduler (cron,
 * infrastructure-level job, etc.) on a regular schedule (e.g. every 5 minutes).
 * The job is idempotent — running it multiple times is safe.
 */
const runNotificationJobs = async (req, res) => {
  const result = await notificationSchedulerService.runAll();
  res.json({ ok: true, ...result });
};

/**
 * POST /api/admin/jobs/subscriptions
 *
 * First, reconciles subscriptions/payments that were linked to a self-billed
 * invoice (via the admin link-invoice endpoint) before SRI had authorized it
 * yet — linkInvoice() itself already applies immediately when the invoice is
 * already AUTHORIZED at link time, so this only ever matters for admins who
 * link before authorization completes. See ADR-022's addendum for why this
 * is a periodic scan rather than a RabbitMQ effect fired on every document
 * authorization system-wide.
 *
 * Then applies every subscription downgrade scheduled via the tenant-facing
 * change-tier endpoint whose current_period_end has passed (and rolls that
 * subscription's period forward so it re-enters the renewal cycle at its new
 * tier). Upgrades apply immediately on invoice authorization and need no
 * scheduled job — only downgrades wait for the period to end.
 *
 * Then opens a renewal payment + reminder for every subscription approaching
 * current_period_end, and downgrades to FREE any subscription that ran past
 * its renewal grace period with no verified renewal. Must run after the
 * downgrade step above in the same tick — see processDueRenewals.
 *
 * Designed to be called by an external scheduler on a daily cadence (no need
 * for the minute-level frequency the notification job uses).
 */
const runSubscriptionJobs = async (req, res) => {
  // Order matters, seats -> tiers -> renewals (CLAUDE.md Common Mistake #50,
  // sibling of #27): applyScheduledTierChanges rolls current_period_end
  // forward, and applyScheduledSeatChanges' due-query is keyed on
  // current_period_end <= NOW() — running tiers first would make a due seat
  // decrease invisible for a whole extra period. Then tiers before renewals:
  // a downgrade applied here also rolls its period forward, and
  // processDueRenewals' warning/expiry checks read that same
  // current_period_end in this tick. Reversing either pair would flag every
  // subscription changing today as freshly expired (or silently skip a due
  // seat decrease for a full cycle).
  const seatChanges = await subscriptionService.applyScheduledSeatChanges();
  const tierChanges = await subscriptionService.applyScheduledTierChanges();
  const renewals = await subscriptionService.processDueRenewals();
  res.json({ ok: true, ...seatChanges, ...tierChanges, ...renewals });
};

/**
 * POST /api/admin/jobs/quota
 *
 * Rolls over every tenant's document-quota period whose period_end has
 * passed — resets document_count to 0 for a new monthly cycle, using the
 * tenant's current subscription_tier to size the new cap. Independent of the
 * billing cycle (subscriptions.current_period_end) on purpose — see
 * CLAUDE.md's quota-enforcement entry.
 *
 * Designed to be called by an external scheduler on a daily cadence.
 * Recommended to run after jobs/subscriptions in the same tick, since a
 * same-day tier change should be reflected in the rolled-over cap — but a
 * one-day-stale cap self-corrects on the next cycle, so this isn't a hard
 * ordering requirement.
 */
const runQuotaJobs = async (req, res) => {
  const result = await tenantQuotaService.resetDuePeriods();
  res.json({ ok: true, ...result });
};

/**
 * POST /api/admin/jobs/queue-reconciliation
 *
 * Re-publishes to RabbitMQ any document whose send/authorize-check dispatch
 * was never confirmed or has gone stale (see ADR-019) — never calls
 * SRI itself, only ensures a message exists for workers/worker.js to
 * eventually pick up. See queue-reconciliation.service.js.
 *
 * Designed to be called by an external scheduler every 5 minutes (matches
 * config.queueReconciliation.effectStaleMinutes' default, and the actual
 * droplet cron — see docs/terraform-digitalocean-setup.md) — more frequent
 * than the daily jobs above, since this is the mechanism that recovers
 * from a RabbitMQ outage or a missed publish. CloudAMQP is a managed
 * broker that rarely fails outright, and the worker already processes
 * anything actually queued near-instantly, so this cadence only bounds
 * how long a document can sit unprocessed if nothing ever queued a
 * message for it at all.
 */
/**
 * POST /api/admin/jobs/payphone-reconciliation
 *
 * Two idempotent sweeps over card-payment attempts (ADR-028):
 *
 * 1. Attempts still PENDING past Payphone's 5-minute auto-reversal window —
 *    the payer's browser never reached the return page, so confirm never fired.
 *    Confirms them purely to learn and record the final outcome.
 * 2. Attempts APPROVED but never applied — the two-phase gap where the vendor
 *    outcome committed but the process died before granting access. Money in,
 *    tenant not credited; this is what finishes the job.
 *
 * Designed for an external scheduler on a 5-minute cadence, the same as queue
 * reconciliation — it is the recovery path for real captured money, so it wants
 * the tightest cadence of the jobs.
 */
const runPayphoneReconciliationJob = async (req, res) => {
  const result = await payphonePaymentService.reconcileStaleTransactions();
  res.json({ ok: true, ...result });
};

const runQueueReconciliationJob = async (req, res) => {
  const result = await queueReconciliationService.runAll();
  res.json({ ok: true, ...result });
};

const getDocumentRide = async (req, res) => {
  const buffer = await rideService.generate(req.params.accessKey);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="RIDE-${req.params.accessKey}.pdf"`);
  res.send(buffer);
};

module.exports = {
  createTenant, listTenants, updateTenantTier, updateTenantStatus, verifyTenant, promoteTenant, listTenantEvents,
  createIssuer, listIssuers, renewIssuerCertificate, createApiKey, listApiKeys, getApiKeyUsage, revokeApiKey, runNotificationJobs,
  runSubscriptionJobs, runQuotaJobs, runQueueReconciliationJob, runPayphoneReconciliationJob,
  createSubscription, listSubscriptions, linkInvoice, cancelSubscription,
  reviewPayment, getPaymentProof, listPaymentProofs, listPayments, listPendingInvoices, refundPayment,
  publishAgreement, activateAgreement, listAgreementVersions, getAgreementVersion, generateTenantAgreements,
  publishNotificationEmailTemplate, activateNotificationEmailTemplate, listNotificationEmailTemplateVersions, getNotificationEmailTemplateVersion,
  listCurrentNotificationEmailTemplates,
  getDocumentRide,
  createTierPrice, updateTierPrice, publishTierPrice, listTierPrices, getTierPrice,
  createSeatPrice, updateSeatPrice, publishSeatPrice, listSeatPrices, getSeatPrice,
};
