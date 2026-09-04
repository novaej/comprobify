const tenantQuotaModel = require('../models/tenant-quota.model');
const { addMonths } = require('../utils/add-months');
const { TIERS } = require('../constants/subscription-tiers');
const QuotaExceededError = require('../errors/quota-exceeded-error');

const MONTHLY_PERIOD_MONTHS = 1;
// A YEARLY subscriber pays once for the whole year — their quota period
// pools the full year's worth up front (documentQuota × 12) instead of
// resetting every 30 days, so it's consumable unevenly across the year
// (e.g. 0 documents in January, 480 in December). See ADR-029 and
// CLAUDE.md's "Document quota enforcement"/"Yearly billing" entries.
const YEARLY_POOL_MONTHS = 12;

// FREE never pools annually, even if a refund-reversal downgrade passes a
// leftover YEARLY interval through.
function periodMonthsForTier(tier, billingInterval) {
  if (tier === 'FREE') return MONTHLY_PERIOD_MONTHS;
  return billingInterval === 'YEARLY' ? YEARLY_POOL_MONTHS : MONTHLY_PERIOD_MONTHS;
}

// Resolves a tier's cap for a given billing interval. Deliberately
// `TIERS[tier] || TIERS.FREE`, not `TIERS[tier]?.documentQuota ?? ...` — the
// latter would fall back to FREE's cap whenever a real tier's documentQuota
// is legitimately null (ENTERPRISE, "unlimited"), since `??` treats null and
// undefined the same way. The fallback here is only for an unrecognized
// tier string, never for a real tier's null cap.
function capForTier(tier, billingInterval = 'MONTHLY') {
  const t = TIERS[tier] || TIERS.FREE;
  if (t.documentQuota === null) return null; // ENTERPRISE — unlimited, no multiplier applies
  return t.documentQuota * periodMonthsForTier(tier, billingInterval);
}

// Seeds a tenant's first quota period, anchored to now — there is no prior
// period to anchor to, same exception already established for
// subscription.service.js's applyVerifiedPayment/resetPeriodOnPromotion.
// Both call sites (registration, admin tenant creation) create a tenant with
// no billing_interval context yet, so this always seeds a MONTHLY-length
// period — a later YEARLY subscription pools its quota via setCap() once one
// actually starts.
async function initializeForTenant(tenantId, documentQuota, client = null) {
  const periodStart = new Date();
  const periodEnd = addMonths(periodStart, MONTHLY_PERIOD_MONTHS);
  return tenantQuotaModel.create({ tenantId, periodStart, periodEnd, documentQuota }, client);
}

// The atomic quota gate — must be called with the transaction client
// document-creation.service.js already has open, so a later rollback in
// that same transaction un-consumes the quota too.
async function consumeOne(client, tenantId) {
  const ok = await tenantQuotaModel.incrementIfWithinCap(client, tenantId);
  if (!ok) throw new QuotaExceededError();
}

// Updates the CURRENT period's cap AND billing_interval, resizing period_end
// to match (see tenantQuotaModel.updateCapAndInterval) — used at every tier
// and/or billing-interval change. Never touches document_count or opens a
// new period: already-consumed documents this cycle still count against
// whatever the new cap is. Passing the same billingInterval the period
// already had is a safe no-op (period_end recomputes to the same value);
// passing a changed one (a tenant just went YEARLY, or just came off it) is
// what actually resizes the pool immediately rather than waiting for the
// next monthly reconciliation sweep to notice.
//
// period_end is recomputed here in JS via addMonths(), anchored to the
// period's own (unmoved) period_start — never as raw SQL date arithmetic,
// which would silently reintroduce the month-end overflow bug addMonths()
// exists to prevent (CLAUDE.md Common Mistake #26). Requires a read before
// the write since there's no current row's period_start otherwise; low
// contention is fine here — tier changes for one tenant aren't concurrent.
async function setCap(tenantId, tier, billingInterval = 'MONTHLY') {
  const current = await tenantQuotaModel.findCurrentByTenantId(tenantId);
  if (!current) return null;
  const cap = capForTier(tier, billingInterval);
  const months = periodMonthsForTier(tier, billingInterval);
  const periodEnd = addMonths(new Date(current.period_start), months);
  // Store the INTERVAL THAT WAS ACTUALLY APPLIED, not the raw input — for
  // FREE, periodMonthsForTier() always resolves to 1 regardless of what's
  // passed in (see its FREE guard above), so persisting a raw 'YEARLY' here
  // would leave tenant_quotas.billing_interval claiming a pool that was
  // never actually granted.
  const effectiveInterval = months === YEARLY_POOL_MONTHS ? 'YEARLY' : 'MONTHLY';
  return tenantQuotaModel.updateCapAndInterval(tenantId, cap, effectiveInterval, periodEnd);
}

// Resyncs the CURRENT quota period's own boundaries to exactly match a
// subscription period that just started (INITIAL activation, promotion,
// renewal, or a deferred tier/interval change taking effect) — as opposed to
// setCap(), which resizes the cap of the SAME ongoing period for a mid-cycle
// change without touching document_count. A genuinely new period starts its
// count at 0, the same way resetDuePeriods()'s rollover() already does for
// its own (independently-scheduled) rollovers — so this reuses rollover()
// rather than an in-place update, preserving the one-row-per-period audit
// trail tenant_quotas already keeps.
//
// The key difference from setCap(): the caller supplies periodStart/periodEnd
// directly — the exact dates it just computed for subscriptions.
// current_period_start/end — instead of this function recomputing its own via
// addMonths() from the quota row's prior (possibly long-stale) anchor. That
// independent recomputation is exactly what let the two periods drift apart;
// see CLAUDE.md's "Document quota enforcement" and ADR-029's addendum.
async function syncPeriod(tenantId, periodStart, periodEnd, tier, billingInterval = 'MONTHLY') {
  const current = await tenantQuotaModel.findCurrentByTenantId(tenantId);
  if (!current) return null;
  const cap = capForTier(tier, billingInterval);
  const months = periodMonthsForTier(tier, billingInterval);
  const effectiveInterval = months === YEARLY_POOL_MONTHS ? 'YEARLY' : 'MONTHLY';
  return tenantQuotaModel.rollover(tenantId, periodStart, periodEnd, cap, effectiveInterval);
}

// One-time/idempotent catch-up for quota rows that drifted out of sync with
// their subscription before syncPeriod() existed on every period-changing
// call site (e.g. a promotion that predates this fix). Deliberately does NOT
// use rollover()/reset document_count — the tenant's billing period didn't
// actually change, only the RECORDED boundaries were wrong, so correcting
// them must not look like a fresh period grant. Safe to call repeatedly
// (e.g. from POST /v1/admin/jobs/quota on every run) — a already-aligned row
// simply won't be returned by findMisalignedWithSubscription() next time.
async function resyncFromSubscriptions() {
  const misaligned = await tenantQuotaModel.findMisalignedWithSubscription();
  for (const row of misaligned) {
    const cap = capForTier(row.tier, row.billing_interval);
    const months = periodMonthsForTier(row.tier, row.billing_interval);
    const effectiveInterval = months === YEARLY_POOL_MONTHS ? 'YEARLY' : 'MONTHLY';
    await tenantQuotaModel.resyncPeriod(row.tenant_id, row.current_period_start, row.current_period_end, cap, effectiveInterval);
  }
  return { quotaPeriodsResynced: misaligned.length };
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
// row.billing_interval comes straight off tenant_quotas itself (kept current
// by every setCap() call — see above), not re-derived from subscriptions, so
// a period that's still mid-year correctly rolls into another 12-month pool
// rather than snapping back to monthly just because this job happened to run.
async function resetDuePeriods() {
  const due = await tenantQuotaModel.findDueForReset();
  for (const row of due) {
    const billingInterval = row.billing_interval || 'MONTHLY';
    const months = periodMonthsForTier(row.subscription_tier, billingInterval);
    const newPeriodStart = row.period_end;
    const newPeriodEnd = addMonths(newPeriodStart, months);
    await tenantQuotaModel.rollover(
      row.tenant_id, newPeriodStart, newPeriodEnd, capForTier(row.subscription_tier, billingInterval), billingInterval
    );
  }
  return { quotaPeriodsReset: due.length };
}

module.exports = {
  initializeForTenant,
  consumeOne,
  setCap,
  syncPeriod,
  resyncFromSubscriptions,
  getCurrentForTenant,
  getCurrentForTenants,
  resetDuePeriods,
};
