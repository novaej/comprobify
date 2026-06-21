const adminService = require('../services/admin.service');
const notificationSchedulerService = require('../services/notification-scheduler.service');

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
  createIssuer, listIssuers, createApiKey, revokeApiKey, runNotificationJobs,
};
