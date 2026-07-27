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
 *   3. Price-change notification reconciliation — re-scans every ACTIVE
 *      tenant for a published tier price still inside its notice window they
 *      haven't been notified of yet. A safety net for the event-driven hooks
 *      (registration/admin services call this on every tenant->ACTIVE
 *      transition) — this catches an ACTIVE tenant who was skipped during
 *      the publish-time bulk blast (e.g. a transient failure) and would
 *      otherwise never be revisited, since nothing else re-checks a tenant
 *      who doesn't change status. See pricing.service.js.
 *
 * The caller (admin endpoint) triggers this on a schedule (e.g. cron). It is
 * idempotent — running it multiple times is safe.
 *
 * Cert check thresholds are defined in notification.service.js and shared via
 * the `runCertChecksForTenant` function. The scheduler only orchestrates across
 * all tenants; per-tenant logic lives in the notification service.
 */
const tenantModel = require('../models/tenant.model');
const webhookDeliveryService = require('./webhook-delivery.service');
const pricingService = require('./pricing.service');

// Import private function via the notification service
const notificationService = require('./notification.service');

/**
 * Run all periodic notification jobs across every non-suspended tenant.
 *
 * @returns {Promise<{
 *   tenantsChecked: number,
 *   retries: { attempted: number, succeeded: number, failed: number, exhausted: number },
 *   priceChangeReconciliation: { tenantsChecked: number, notified: number }
 * }>}
 */
async function runAll() {
  // --- 1. Cert expiry checks ---
  const tenants = await tenantModel.findAllActive();

  let tenantsChecked = 0;
  for (const tenant of tenants) {
    try {
      // runCertChecksForTenant no longer takes a `prefs` argument (ADR-024) —
      // cert-alert bookkeeping is unconditional now; preference only affects
      // GET /v1/notifications' read-time visibility.
      await notificationService.runCertChecksForTenant(tenant.id);
      tenantsChecked++;
    } catch (err) {
      console.error(`[scheduler] Cert check failed for tenant ${tenant.id}:`, err.message);
    }
  }

  // --- 2. Webhook retries ---
  const retries = await webhookDeliveryService.processDueRetries();

  // --- 3. Price-change notification reconciliation ---
  const priceChangeReconciliation = await pricingService.reconcilePendingPriceChangeNotifications();

  return { tenantsChecked, retries, priceChangeReconciliation };
}

module.exports = { runAll };
