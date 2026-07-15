const adminService = require('../services/admin.service');
const notificationSchedulerService = require('../services/notification-scheduler.service');
const subscriptionService = require('../services/subscription.service');
const tenantQuotaService = require('../services/tenant-quota.service');
const queueReconciliationService = require('../services/queue-reconciliation.service');
const agreementService = require('../services/agreement.service');
const tenantAgreementService = require('../services/tenant-agreement.service');
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
  const tenant = await adminService.updateTenantTier(parseInt(req.params.id, 10), req.body.subscriptionTier);
  res.json({ ok: true, tenant });
};

const updateTenantStatus = async (req, res) => {
  const tenant = await adminService.updateTenantStatus(parseInt(req.params.id, 10), req.body.status);
  res.json({ ok: true, tenant });
};

const verifyTenant = async (req, res) => {
  const tenant = await adminService.verifyTenant(parseInt(req.params.id, 10));
  res.json({ ok: true, tenant });
};

const listTenantEvents = async (req, res) => {
  const events = await adminService.listTenantEvents(parseInt(req.params.id, 10));
  res.json({ ok: true, events });
};

// Issuers
const createIssuer = async (req, res) => {
  const { issuer } = await adminService.createIssuer(
    req.body,
    req.file?.buffer,
    req.body.certPassword,
    req.body.sourceIssuerId ? parseInt(req.body.sourceIssuerId, 10) : undefined,
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
    parseInt(req.params.id, 10),
    req.file.buffer,
    req.body.certPassword,
  );
  res.json({ ok: true, certFingerprint, certExpiry });
};

const promoteTenant = async (req, res) => {
  const { apiKeys } = await adminService.promoteTenant(
    parseInt(req.params.id, 10),
    req.body.initialSequentials || [],
  );
  res.json({ ok: true, apiKeys });
};

// API keys
const createApiKey = async (req, res) => {
  const tenantId = parseInt(req.params.id, 10);
  const apiKey = await adminService.createApiKey(
    tenantId,
    req.body.label,
    req.body.environment,
    req.body.revokeExisting === true,
  );
  res.status(201).json({ ok: true, apiKey });
};

const revokeApiKey = async (req, res) => {
  await adminService.revokeApiKey(parseInt(req.params.id, 10));
  res.json({ ok: true });
};

// Subscriptions & payments
const createSubscription = async (req, res) => {
  const result = await subscriptionService.createSubscription(
    parseInt(req.params.id, 10),
    req.body.tier,
    req.body.billingInterval,
  );
  res.status(201).json({ ok: true, ...result });
};

const listSubscriptions = async (req, res) => {
  const subscriptions = await subscriptionService.listByTenant(parseInt(req.params.id, 10));
  res.json({ ok: true, subscriptions });
};

const linkInvoice = async (req, res) => {
  const subscription = await subscriptionService.linkInvoice(parseInt(req.params.id, 10), req.body.accessKey);
  res.json({ ok: true, subscription });
};

const cancelSubscription = async (req, res) => {
  const subscription = await subscriptionService.cancelSubscription(parseInt(req.params.id, 10));
  res.json({ ok: true, subscription });
};

const reviewPayment = async (req, res) => {
  const result = await subscriptionService.reviewPayment(
    parseInt(req.params.id, 10),
    req.body.decision,
    req.body.rejectionReasonCode,
  );
  res.json({ ok: true, ...result });
};

const listPaymentProofs = async (req, res) => {
  const proofs = await subscriptionService.listPaymentProofsForAdmin(parseInt(req.params.id, 10));
  res.json({ ok: true, proofs });
};

// Streams any proof file (active or soft-deleted) for full audit visibility.
const getPaymentProof = async (req, res) => {
  const { buffer, filename, mimeType } = await subscriptionService.getPaymentProofFile(
    parseInt(req.params.id, 10),
    parseInt(req.params.proofId, 10),
  );
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
};

const listPayments = async (req, res) => {
  const payments = await subscriptionService.listPendingPayments(req.query.status || 'REPORTED');
  res.json({ ok: true, payments });
};

// Legal documents

const generateTenantAgreements = async (req, res) => {
  const tenantId = parseInt(req.params.id, 10);
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
  const document = await agreementService.activateVersion(parseInt(req.params.id, 10));
  res.json({ ok: true, document: { id: document.id, documentType: document.document_type, version: document.version, isCurrent: document.is_current } });
};

const listAgreementVersions = async (req, res) => {
  const versions = await agreementService.listVersionsByType(req.params.type);
  res.json({ ok: true, versions });
};

const getAgreementVersion = async (req, res) => {
  const document = await agreementService.getById(parseInt(req.params.id, 10));
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
 * Applies every subscription downgrade scheduled via the tenant-facing
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
  const tierChanges = await subscriptionService.applyScheduledTierChanges();
  const renewals = await subscriptionService.processDueRenewals();
  res.json({ ok: true, ...tierChanges, ...renewals });
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
 * SRI itself, only ensures a message exists for workers/sri-worker.js to
 * eventually pick up. See queue-reconciliation.service.js.
 *
 * Designed to be called by an external scheduler hourly — more frequent
 * than the daily jobs above, since this is the mechanism that recovers
 * from a RabbitMQ outage or a missed publish, but not tighter than that:
 * CloudAMQP is a managed broker that rarely fails outright, and the
 * worker already processes anything actually queued near-instantly, so
 * this cadence only bounds how long a document can sit unprocessed if
 * nothing ever queued a message for it at all.
 */
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
  createIssuer, listIssuers, renewIssuerCertificate, createApiKey, revokeApiKey, runNotificationJobs,
  runSubscriptionJobs, runQuotaJobs, runQueueReconciliationJob,
  createSubscription, listSubscriptions, linkInvoice, cancelSubscription,
  reviewPayment, getPaymentProof, listPaymentProofs, listPayments,
  publishAgreement, activateAgreement, listAgreementVersions, getAgreementVersion, generateTenantAgreements,
  getDocumentRide,
};
