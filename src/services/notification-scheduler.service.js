/**
 * Notification scheduler service.
 *
 * Runs all periodic notification work in a single admin-triggered job
 * (POST /api/admin/jobs/notifications).
 *
 * What it does:
 *   1. Cert expiry checks — for every non-suspended tenant, checks all their
 *      active issuers and upserts CERT_EXPIRING / CERT_EXPIRED alerts.
 *   2. Webhook retries — processes all RETRYING delivery rows past their
 *      scheduled next_retry_at time.
 *
 * The caller (admin endpoint) triggers this on a schedule (e.g. cron). It is
 * idempotent — running it multiple times is safe.
 *
 * Cert check thresholds are defined in notification.service.js and shared via
 * the `runCertChecksForTenant` function. The scheduler only orchestrates across
 * all tenants; per-tenant logic lives in the notification service.
 */
const tenantModel = require('../models/tenant.model');
const notificationPreferenceModel = require('../models/notification-preference.model');
const webhookDeliveryService = require('./webhook-delivery.service');

// Import private function via the notification service
const notificationService = require('./notification.service');

/**
 * Run all periodic notification jobs across every non-suspended tenant.
 *
 * @returns {Promise<{
 *   tenantsChecked: number,
 *   retries: { attempted: number, succeeded: number, failed: number, exhausted: number }
 * }>}
 */
async function runAll() {
  // --- 1. Cert expiry checks ---
  const tenants = await tenantModel.findAllActive();

  let tenantsChecked = 0;
  for (const tenant of tenants) {
    try {
      const prefs = await notificationPreferenceModel.findByTenantId(tenant.id);
      await notificationService.runCertChecksForTenant(tenant.id, prefs);
      tenantsChecked++;
    } catch (err) {
      console.error(`[scheduler] Cert check failed for tenant ${tenant.id}:`, err.message);
    }
  }

  // --- 2. Webhook retries ---
  const retries = await webhookDeliveryService.processDueRetries();

  return { tenantsChecked, retries };
}

module.exports = { runAll };
