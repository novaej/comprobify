const tierPriceModel = require('../models/tier-price.model');
const seatPriceModel = require('../models/seat-price.model');
const tenantModel = require('../models/tenant.model');
const notificationService = require('./notification.service');
const { TIERS } = require('../constants/subscription-tiers');
const config = require('../config');
const AppError = require('../errors/app-error');
const NotFoundError = require('../errors/not-found-error');
const ErrorCodes = require('../constants/error-codes');

const BILLING_INTERVALS = ['MONTHLY', 'YEARLY'];

function assertValidInterval(billingInterval) {
  if (!BILLING_INTERVALS.includes(billingInterval)) {
    throw new AppError(`Invalid billingInterval '${billingInterval}'. Valid values: ${BILLING_INTERVALS.join(', ')}`, 400, ErrorCodes.INVALID_BILLING_INTERVAL);
  }
}

function assertValidTierAndInterval(tier, billingInterval) {
  if (!Object.keys(TIERS).includes(tier)) {
    throw new AppError(`Invalid tier '${tier}'. Valid tiers: ${Object.keys(TIERS).join(', ')}`, 400, ErrorCodes.INVALID_TIER);
  }
  assertValidInterval(billingInterval);
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

  const recipients = await tenantModel.findAllNotifiableForPriceChanges();
  await notifyPendingPriceChangesForTenants(recipients);

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
// createPriceChangeAnnounced() internally enqueues the NOTIFICATION_DISPATCH
// effect for the email half — see notification.service.js's
// dispatchNotification(), which every notification-creating call in the
// codebase now funnels through.
// Scans both tier_prices and seat_prices — two independently-priced things
// sharing one notification type (PRICE_CHANGE_ANNOUNCED, distinguished by
// metadata.tierPriceId vs. metadata.seatPriceId) and one notice mechanism.
async function notifyPendingPriceChangesForTenant(tenantId) {
  const [pendingTiers, pendingSeats] = await Promise.all([
    tierPriceModel.findUnnotifiedPendingForTenant(tenantId),
    seatPriceModel.findUnnotifiedPendingForTenant(tenantId),
  ]);
  if (pendingTiers.length === 0 && pendingSeats.length === 0) return 0;

  const tenant = await tenantModel.findById(tenantId);
  for (const tierPrice of pendingTiers) {
    const previousPriceUsd = await getCurrentPrice(tierPrice.tier, tierPrice.billing_interval);
    await notificationService.createPriceChangeAnnounced(tenant, tierPrice, previousPriceUsd);
  }
  for (const seatPrice of pendingSeats) {
    const previousPriceUsd = await getCurrentSeatPrice(seatPrice.billing_interval);
    await notificationService.createSeatPriceChangeAnnounced(tenant, seatPrice, previousPriceUsd);
  }
  return pendingTiers.length + pendingSeats.length;
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
// notifiable tenant (ACTIVE, or PENDING_VERIFICATION with a live subscription) on the same cadence as the rest of that job — cheap when
// nothing is pending (the common case), since notifyPendingPriceChangesForTenant
// is a no-op query per tenant when there's nothing to catch up on.
async function reconcilePendingPriceChangeNotifications() {
  const recipients = await tenantModel.findAllNotifiableForPriceChanges();
  const notifiedCount = await notifyPendingPriceChangesForTenants(recipients);
  return { tenantsChecked: recipients.length, notified: notifiedCount };
}

async function listPrices({ tier } = {}) {
  return tierPriceModel.findAll({ tier });
}

async function getPriceById(id) {
  const row = await tierPriceModel.findById(id);
  if (!row) throw new NotFoundError('Tier price');
  return row;
}

// --- Extra-seat add-on pricing (ADR-032) ---
// Mirrors every tier-price function above 1:1, minus the `tier` dimension —
// the seat price is flat across every tier. Deliberately a second set of
// functions rather than a generalized "priced item" abstraction over both
// tier_prices and seat_prices: the two tables have different keys (tier+
// interval vs. interval only) and keeping them separate avoids risking a
// regression in the tier-price path, which the 30-day legal notice depends on.

async function getSeatPriceAsOf(billingInterval, asOfDate) {
  assertValidInterval(billingInterval);
  const row = await seatPriceModel.findCurrent(billingInterval, asOfDate);
  if (!row) {
    throw new AppError(`No published seat price found for ${billingInterval} as of ${asOfDate.toISOString()}`, 500, ErrorCodes.PRICE_NOT_FOUND);
  }
  return parseFloat(row.price_usd);
}

async function getCurrentSeatPrice(billingInterval) {
  return getSeatPriceAsOf(billingInterval, new Date());
}

async function getUpcomingSeatPrice(billingInterval) {
  assertValidInterval(billingInterval);
  const row = await seatPriceModel.findUpcoming(billingInterval);
  if (!row) return null;
  return { priceUsd: parseFloat(row.price_usd), effectiveAt: row.effective_at };
}

async function createSeatPriceDraft({ billingInterval, priceUsd }) {
  assertValidInterval(billingInterval);
  return seatPriceModel.create({ billingInterval, priceUsd });
}

async function updateSeatPriceDraft(id, priceUsd) {
  const row = await seatPriceModel.updatePriceUsd(id, priceUsd);
  if (!row) {
    const existing = await seatPriceModel.findById(id);
    if (!existing) throw new NotFoundError('Seat price');
    throw new AppError('Only a DRAFT price can be edited', 400, ErrorCodes.PRICE_NOT_DRAFT);
  }
  return row;
}

async function publishSeatPrice(id, { noticeDays } = {}) {
  const floor = config.priceChangeMinNoticeDays;
  if (noticeDays !== undefined && noticeDays < floor) {
    throw new AppError(`noticeDays must be at least ${floor}`, 400, ErrorCodes.PRICE_NOTICE_TOO_SHORT);
  }
  const days = Math.max(noticeDays || floor, floor);
  const effectiveAt = new Date();
  effectiveAt.setDate(effectiveAt.getDate() + days);

  const published = await seatPriceModel.publish(id, effectiveAt);
  if (!published) {
    const existing = await seatPriceModel.findById(id);
    if (!existing) throw new NotFoundError('Seat price');
    throw new AppError('Only a DRAFT price can be published', 400, ErrorCodes.PRICE_NOT_DRAFT);
  }

  const recipients = await tenantModel.findAllNotifiableForPriceChanges();
  await notifyPendingPriceChangesForTenants(recipients);

  return published;
}

async function listSeatPrices() {
  return seatPriceModel.findAll();
}

async function getSeatPriceById(id) {
  const row = await seatPriceModel.findById(id);
  if (!row) throw new NotFoundError('Seat price');
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
  getSeatPriceAsOf,
  getCurrentSeatPrice,
  getUpcomingSeatPrice,
  createSeatPriceDraft,
  updateSeatPriceDraft,
  publishSeatPrice,
  listSeatPrices,
  getSeatPriceById,
};
