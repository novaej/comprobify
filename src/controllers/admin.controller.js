const adminService = require('../services/admin.service');
const notificationSchedulerService = require('../services/notification-scheduler.service');
const subscriptionService = require('../services/subscription.service');
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
  const result = await subscriptionService.reviewPayment(parseInt(req.params.id, 10), req.body.decision);
  res.json({ ok: true, ...result });
};

const getPaymentProof = async (req, res) => {
  const { buffer, filename, mimeType } = await subscriptionService.getPaymentProof(parseInt(req.params.id, 10));
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
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

module.exports = {
  createTenant, listTenants, updateTenantTier, updateTenantStatus, verifyTenant, promoteTenant,
  createIssuer, listIssuers, renewIssuerCertificate, createApiKey, revokeApiKey, runNotificationJobs,
  createSubscription, listSubscriptions, linkInvoice, cancelSubscription,
  reviewPayment, getPaymentProof,
};
