const tierPriceModel = require('../models/tier-price.model');
const tenantModel = require('../models/tenant.model');
const notificationService = require('./notification.service');
const pendingEffectService = require('../services/pending-effect.service');
const { EffectTypes } = require('../constants/effect-types');
const TenantStatus = require('../constants/tenant-status');
const { TIERS } = require('../constants/subscription-tiers');
const config = require('../config');
const AppError = require('../errors/app-error');
const NotFoundError = require('../errors/not-found-error');
const ErrorCodes = require('../constants/error-codes');

const BILLING_INTERVALS = ['MONTHLY', 'YEARLY'];

function assertValidTierAndInterval(tier, billingInterval) {
  if (!Object.keys(TIERS).includes(tier)) {
    throw new AppError(`Invalid tier '${tier}'. Valid tiers: ${Object.keys(TIERS).join(', ')}`, 400, ErrorCodes.INVALID_TIER);
  }
  if (!BILLING_INTERVALS.includes(billingInterval)) {
    throw new AppError(`Invalid billingInterval '${billingInterval}'. Valid values: ${BILLING_INTERVALS.join(', ')}`, 400, ErrorCodes.INVALID_BILLING_INTERVAL);
  }
}

async function queueEffect(effectType, tenantId, payload) {
  const effect = await pendingEffectService.enqueue(effectType, tenantId, payload);
  pendingEffectService.dispatch(effect);
}

// The historical resolver every real billing call site must use instead of
// reading TIERS[tier].priceMonthlyUsd/priceYearlyUsd directly (those keys no
// longer exist). Resolve "as of" the date the resulting billing period
// actually starts: "now" for anything that takes effect immediately
// (a new subscription, an upgrade proration, a sandbox change), the period's
// own start date for anything deferred (a renewal, a deferred interval
// change) — see CLAUDE.md's "Price history + 30-day change notice" entry for
// why this is what makes the 30-day protection real.
async function getPriceAsOf(tier, billingInterval, asOfDate) {
  assertValidTierAndInterval(tier, billingInterval);
  const row = await tierPriceModel.findCurrent(tier, billingInterval, asOfDate);
  if (!row) {
    throw new AppError(`No published price found for ${tier}/${billingInterval} as of ${asOfDate.toISOString()}`, 500, ErrorCodes.PRICE_NOT_FOUND);
  }
  return parseFloat(row.price_usd);
}

async function getCurrentPrice(tier, billingInterval) {
  return getPriceAsOf(tier, billingInterval, new Date());
}

// For GET /v1/tiers transparency — a still-pending price change is visible
// (with its effective date) to prospective tenants too, not just existing
// ones who got the notification email.
async function getUpcoming(tier, billingInterval) {
  assertValidTierAndInterval(tier, billingInterval);
  const row = await tierPriceModel.findUpcoming(tier, billingInterval);
  if (!row) return null;
  return { priceUsd: parseFloat(row.price_usd), effectiveAt: row.effective_at };
}

async function createDraft({ tier, billingInterval, priceUsd }) {
  assertValidTierAndInterval(tier, billingInterval);
  return tierPriceModel.create({ tier, billingInterval, priceUsd });
}

async function updateDraft(id, priceUsd) {
  const row = await tierPriceModel.updatePriceUsd(id, priceUsd);
  if (!row) {
    const existing = await tierPriceModel.findById(id);
    if (!existing) throw new NotFoundError('Tier price');
    throw new AppError('Only a DRAFT price can be edited', 400, ErrorCodes.PRICE_NOT_DRAFT);
  }
  return row;
}

// Confirms a DRAFT price: starts the 30-day (or longer) notice clock and
// notifies every currently-ACTIVE tenant. Once published a row is immutable
// — the same "current" price for renewals/upgrades priced before
// effective_at keeps resolving to the prior PUBLISHED row automatically via
// getPriceAsOf, no extra bookkeeping needed here.
async function publishPrice(id, { noticeDays } = {}) {
  const floor = config.priceChangeMinNoticeDays;
  if (noticeDays !== undefined && noticeDays < floor) {
    throw new AppError(`noticeDays must be at least ${floor}`, 400, ErrorCodes.PRICE_NOTICE_TOO_SHORT);
  }
  const days = Math.max(noticeDays || floor, floor);
  const effectiveAt = new Date();
  effectiveAt.setDate(effectiveAt.getDate() + days);

  const published = await tierPriceModel.publish(id, effectiveAt);
  if (!published) {
    const existing = await tierPriceModel.findById(id);
    if (!existing) throw new NotFoundError('Tier price');
    throw new AppError('Only a DRAFT price can be published', 400, ErrorCodes.PRICE_NOT_DRAFT);
  }

  const activeTenants = await tenantModel.findAllByStatus(TenantStatus.ACTIVE);
  await notifyPendingPriceChangesForTenants(activeTenants);

  return published;
}

// Idempotent: finds every PUBLISHED price still inside its notice window
// (effective_at in the future) this tenant has no PRICE_CHANGE_ANNOUNCED
// notification for yet, and handles each. Safe to call any number of times
// for the same tenant. Relies on PRICE_CHANGE_ANNOUNCED being "mandatory"
// (notification-catalog.js) — its notifications row is
// created unconditionally, which is what makes checking `notifications`
// directly (tier-price.model.js's findUnnotifiedPendingForTenant) a safe
// idempotency source, no dedicated ledger table needed.
//
// The in-app notification is created synchronously here, not via a queued
// effect — deliberately, so there's no async gap between "checked as
// pending" and "marked as handled" that a repeated call (the periodic
// reconciliation sweep runs every 5 minutes) could race and double-enqueue.
// Only the email is queued, since it's the one part of this genuinely worth
// async dispatch + retry (an external HTTP call to the email provider).
async function notifyPendingPriceChangesForTenant(tenantId) {
  const pending = await tierPriceModel.findUnnotifiedPendingForTenant(tenantId);
  if (pending.length === 0) return 0;

  const tenant = await tenantModel.findById(tenantId);
  for (const tierPrice of pending) {
    const previousPriceUsd = await getCurrentPrice(tierPrice.tier, tierPrice.billing_interval);
    await notificationService.createPriceChangeAnnounced(tenant, tierPrice, previousPriceUsd);
    await queueEffect(EffectTypes.PRICE_CHANGE_EMAIL, tenantId, { tenantId, tierPriceId: tierPrice.id, previousPriceUsd });
  }
  return pending.length;
}

// Shared per-tenant loop, tolerating one tenant's failure without aborting
// the rest — same idiom as notification-scheduler.service.js's cert-check
// loop. Used by both publishPrice()'s initial bulk blast and
// reconcilePendingPriceChangeNotifications()'s periodic sweep.
async function notifyPendingPriceChangesForTenants(tenants) {
  let notifiedCount = 0;
  for (const tenant of tenants) {
    try {
      const count = await notifyPendingPriceChangesForTenant(tenant.id);
      if (count > 0) notifiedCount++;
    } catch (err) {
      console.error(`[pricing] Failed to notify tenant ${tenant.id} of pending price changes:`, err.message);
    }
  }
  return notifiedCount;
}

// Periodic safety net (called by notification-scheduler.service.js, i.e.
// POST /v1/admin/jobs/notifications) covering what the event-driven hooks
// can miss: an ACTIVE tenant skipped during publishPrice()'s bulk loop due to
// a transient failure never gets revisited by anything else, since nothing
// else re-checks a tenant who doesn't change status. This re-scans every
// ACTIVE tenant on the same cadence as the rest of that job — cheap when
// nothing is pending (the common case), since notifyPendingPriceChangesForTenant
// is a no-op query per tenant when there's nothing to catch up on.
async function reconcilePendingPriceChangeNotifications() {
  const activeTenants = await tenantModel.findAllByStatus(TenantStatus.ACTIVE);
  const notifiedCount = await notifyPendingPriceChangesForTenants(activeTenants);
  return { tenantsChecked: activeTenants.length, notified: notifiedCount };
}

async function listPrices({ tier } = {}) {
  return tierPriceModel.findAll({ tier });
}

async function getPriceById(id) {
  const row = await tierPriceModel.findById(id);
  if (!row) throw new NotFoundError('Tier price');
  return row;
}

module.exports = {
  getPriceAsOf,
  getCurrentPrice,
  getUpcoming,
  createDraft,
  updateDraft,
  publishPrice,
  notifyPendingPriceChangesForTenant,
  reconcilePendingPriceChangeNotifications,
  listPrices,
  getPriceById,
};
