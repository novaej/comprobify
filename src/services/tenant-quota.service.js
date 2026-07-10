const tenantQuotaModel = require('../models/tenant-quota.model');
const { TIERS } = require('../constants/subscription-tiers');
const QuotaExceededError = require('../errors/quota-exceeded-error');

const QUOTA_PERIOD_MONTHS = 1;

function addMonths(date, months) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function capForTier(tier) {
  return TIERS[tier]?.documentQuota ?? TIERS.FREE.documentQuota;
}

// Seeds a tenant's first quota period, anchored to now — there is no prior
// period to anchor to, same exception already established for
// subscription.service.js's activateIfLinked/resetPeriodOnPromotion.
async function initializeForTenant(tenantId, documentQuota, client = null) {
  const periodStart = new Date();
  const periodEnd = addMonths(periodStart, QUOTA_PERIOD_MONTHS);
  return tenantQuotaModel.create({ tenantId, periodStart, periodEnd, documentQuota }, client);
}

// The atomic quota gate — must be called with the transaction client
// document-creation.service.js already has open, so a later rollback in
// that same transaction un-consumes the quota too.
async function consumeOne(client, tenantId) {
  const ok = await tenantQuotaModel.incrementIfWithinCap(client, tenantId);
  if (!ok) throw new QuotaExceededError();
}

// Updates the CURRENT period's cap immediately — used whenever a tenant's
// tier changes. Does not touch document_count or start a new period.
async function setCap(tenantId, tier) {
  return tenantQuotaModel.updateCap(tenantId, capForTier(tier));
}

async function getCurrentForTenant(tenantId) {
  return tenantQuotaModel.findCurrentByTenantId(tenantId);
}

async function getCurrentForTenants(tenantIds) {
  const rows = await tenantQuotaModel.findCurrentByTenantIds(tenantIds);
  return new Map(rows.map((r) => [r.tenant_id, r]));
}

// Admin job (POST /v1/admin/jobs/quota) — rolls over every period whose
// period_end has passed. Anchored to the OLD period_end, never "now" (mirrors
// subscription.service.js's addBillingPeriod() philosophy — CLAUDE.md Common
// Mistake #26), so a late-running job never drifts the cycle forward.
async function resetDuePeriods() {
  const due = await tenantQuotaModel.findDueForReset();
  for (const row of due) {
    const newPeriodStart = row.period_end;
    const newPeriodEnd = addMonths(newPeriodStart, QUOTA_PERIOD_MONTHS);
    await tenantQuotaModel.rollover(row.tenant_id, newPeriodStart, newPeriodEnd, capForTier(row.subscription_tier));
  }
  return { quotaPeriodsReset: due.length };
}

module.exports = {
  initializeForTenant,
  consumeOne,
  setCap,
  getCurrentForTenant,
  getCurrentForTenants,
  resetDuePeriods,
};
