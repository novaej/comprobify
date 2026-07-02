const subscriptionModel = require('../models/subscription.model');
const paymentModel = require('../models/payment.model');
const documentModel = require('../models/document.model');
const tenantModel = require('../models/tenant.model');
const tenantEventModel = require('../models/tenant-event.model');
const notificationService = require('./notification.service');
const emailService = require('./email.service');
const { TIERS, IVA_RATE } = require('../constants/subscription-tiers');
const TenantStatus = require('../constants/tenant-status');
const config = require('../config');
const AppError = require('../errors/app-error');
const ConflictError = require('../errors/conflict-error');
const NotFoundError = require('../errors/not-found-error');
const ErrorCodes = require('../constants/error-codes');

const PAID_TIERS = Object.keys(TIERS).filter((t) => t !== 'FREE');
const BILLING_INTERVALS = ['MONTHLY', 'YEARLY'];
const DECISIONS = ['VERIFIED', 'REJECTED'];

// Splits an IVA-inclusive all-in total into base imponible + IVA so each
// payment row carries a full audit trail of the tax breakdown at creation time.
// Rounding: IVA is rounded to 2dp; base = total − IVA (avoids off-by-one).
function breakdownAmount(totalAmount) {
  if (totalAmount <= 0) return { baseAmount: 0, ivaAmount: 0, totalAmount: 0 };
  const ivaAmount = Math.round(totalAmount * IVA_RATE / (1 + IVA_RATE) * 100) / 100;
  const baseAmount = Math.round((totalAmount - ivaAmount) * 100) / 100;
  return { baseAmount, ivaAmount, totalAmount };
}

// How far ahead of current_period_end a renewal payment is opened and the
// tenant is reminded. How long past current_period_end a subscription can go
// with no verified renewal before it's downgraded to FREE. See processDueRenewals.
const RENEWAL_REMINDER_DAYS = 7;
const RENEWAL_GRACE_DAYS = 7;

// Never echo the raw file bytes back in a JSON response — the caller just sent it
// (submitPaymentProof) or doesn't need it (reviewPayment). GET .../proof streams it.
function omitProofFile(payment) {
  if (!payment) return payment;
  const { proof_file, ...rest } = payment;
  return rest;
}

// Shared period math for activation, renewal, and the free period-rollover a
// downgrade gets. Always advances from a fixed anchor date (never "now") so
// repeated calls can't drift the billing date earlier or later than intended.
function addBillingPeriod(fromDate, billingInterval) {
  const next = new Date(fromDate);
  if (billingInterval === 'YEARLY') {
    next.setFullYear(next.getFullYear() + 1);
  } else {
    next.setMonth(next.getMonth() + 1);
  }
  return next;
}

// Fire-and-forget side effect, swallowed and logged — mirrors the pattern
// already used for notification/email side effects in
// document-transmission.service.js. Never lets an email/notification failure
// surface as an error to the caller.
function fireAndForget(promise, label) {
  promise.catch((err) => console.warn(`[subscription] ${label} failed:`, err.message));
}

async function createSubscription(tenantId, tier, billingInterval = 'MONTHLY') {
  if (!PAID_TIERS.includes(tier)) {
    throw new AppError(
      `Invalid tier '${tier}'. Valid paid tiers: ${PAID_TIERS.join(', ')}`,
      400,
      ErrorCodes.INVALID_TIER
    );
  }
  if (!BILLING_INTERVALS.includes(billingInterval)) {
    throw new AppError(
      `Invalid billingInterval '${billingInterval}'. Valid values: ${BILLING_INTERVALS.join(', ')}`,
      400,
      ErrorCodes.INVALID_BILLING_INTERVAL
    );
  }

  const tenant = await tenantModel.findById(tenantId);
  if (!tenant) throw new NotFoundError('Tenant');

  const existing = await subscriptionModel.findActiveOrPendingByTenantId(tenant.id);
  if (existing) {
    throw new ConflictError(
      `Tenant already has a subscription in progress (id ${existing.id}, status ${existing.status})`,
      ErrorCodes.SUBSCRIPTION_ALREADY_IN_FLIGHT
    );
  }

  const subscription = await subscriptionModel.create({ tenantId: tenant.id, tier, billingInterval });
  const { baseAmount, ivaAmount, totalAmount } = breakdownAmount(
    billingInterval === 'YEARLY' ? TIERS[tier].priceYearlyUsd : TIERS[tier].priceMonthlyUsd
  );
  const payment = await paymentModel.create({
    subscriptionId: subscription.id,
    amount: baseAmount,
    ivaRate: IVA_RATE,
    ivaAmount,
    totalAmount,
  });

  await tenantEventModel.create(tenant.id, 'SUBSCRIPTION_CREATED', { subscriptionId: subscription.id, tier, billingInterval });

  return { subscription, payment, bankTransfer: config.bankTransfer };
}

// Tenant-facing entry point for starting a subscription on its own, independent of
// `tenant.service.js`'s promote() — usable while still in sandbox (so promotion later
// has nothing left to ask) or any time after. Mirrors the same email-verified gate
// promote() already enforces, since paying requires a verified address on file.
async function createSubscriptionForTenant(tenantId, tier, billingInterval = 'MONTHLY') {
  const tenant = await tenantModel.findById(tenantId);
  if (!tenant) throw new NotFoundError('Tenant');
  if (tenant.status !== TenantStatus.ACTIVE) {
    throw new AppError(
      'Email verification is required before starting a subscription. Check your inbox.',
      403,
      ErrorCodes.EMAIL_VERIFICATION_REQUIRED
    );
  }

  return createSubscription(tenantId, tier, billingInterval);
}

// Tenant-initiated tier and/or billing-interval change on an already-ACTIVE
// subscription. Same-interval upgrades take effect immediately once a
// prorated payment is verified and its self-billed invoice authorizes (see
// applyTierChangeIfLinked); same-interval downgrades are scheduled and
// applied at current_period_end (see applyScheduledTierChanges) — no payment
// is owed since the current period is already paid for at the higher tier.
//
// Any change to billing_interval (regardless of whether the tier goes up,
// down, or stays the same) is always deferred to current_period_end and
// billed at the new tier+interval's full sticker price — mismatched cadences
// (e.g. monthly -> yearly) can't be neatly prorated against each other, so
// the current period just runs out as already paid for, and the new cadence
// starts its own fresh, fully-paid period.
//
// No automated billing gateway exists yet (NEXT_STEPS.md #9), so this rides
// the same manual proof/review pipeline as createSubscription rather than
// charging anything automatically.
async function requestTierChange(tenantId, tier, billingInterval) {
  if (!PAID_TIERS.includes(tier)) {
    throw new AppError(
      `Invalid tier '${tier}'. Valid paid tiers: ${PAID_TIERS.join(', ')}`,
      400,
      ErrorCodes.INVALID_TIER
    );
  }
  if (billingInterval !== undefined && !BILLING_INTERVALS.includes(billingInterval)) {
    throw new AppError(
      `Invalid billingInterval '${billingInterval}'. Valid values: ${BILLING_INTERVALS.join(', ')}`,
      400,
      ErrorCodes.INVALID_BILLING_INTERVAL
    );
  }

  const tenant = await tenantModel.findById(tenantId);
  if (!tenant) throw new NotFoundError('Tenant');

  const subscription = await subscriptionModel.findActiveByTenantId(tenant.id);
  if (!subscription) {
    throw new AppError(
      'Tenant has no ACTIVE subscription to change — use createSubscription/promote first',
      409,
      ErrorCodes.NO_ACTIVE_SUBSCRIPTION
    );
  }

  // billingInterval omitted means "keep the current interval" — this makes
  // every tier-only caller behave exactly as before.
  const targetInterval = billingInterval || subscription.billing_interval;
  const intervalChanged = targetInterval !== subscription.billing_interval;

  if (tier === subscription.tier && !intervalChanged) {
    throw new AppError(
      `Tenant is already on the '${tier}' tier at ${targetInterval} billing`,
      400,
      ErrorCodes.TIER_CHANGE_NO_OP
    );
  }

  if (subscription.pending_tier === 'FREE') {
    throw new ConflictError(
      'A cancellation is already scheduled for this subscription',
      ErrorCodes.CANCELLATION_ALREADY_PENDING
    );
  }
  if (subscription.pending_tier) {
    throw new ConflictError(
      `A plan change to '${subscription.pending_tier}'${subscription.pending_billing_interval ? ` (${subscription.pending_billing_interval})` : ''} is already scheduled for this subscription`,
      ErrorCodes.TIER_CHANGE_ALREADY_PENDING
    );
  }
  const pendingPayment = await paymentModel.findPendingTierChangeBySubscriptionId(subscription.id);
  if (pendingPayment) {
    throw new ConflictError(
      `A plan change to '${pendingPayment.target_tier}'${pendingPayment.target_billing_interval ? ` (${pendingPayment.target_billing_interval})` : ''} is already in progress for this subscription`,
      ErrorCodes.TIER_CHANGE_ALREADY_PENDING
    );
  }

  const isTierUpgrade = TIERS[tier].priceMonthlyUsd > TIERS[subscription.tier].priceMonthlyUsd;
  const isTierDowngrade = TIERS[tier].priceMonthlyUsd < TIERS[subscription.tier].priceMonthlyUsd;

  // Same-interval downgrade: free, scheduled at period end — unchanged from
  // the tier-only design.
  if (isTierDowngrade && !intervalChanged) {
    const updated = await subscriptionModel.scheduleDowngrade(subscription.id, tier);
    await tenantEventModel.create(tenant.id, 'TIER_CHANGE_SCHEDULED', {
      subscriptionId: subscription.id,
      fromTier: subscription.tier,
      toTier: tier,
      effectiveAt: subscription.current_period_end,
    });
    return { subscription: updated, effectiveAt: subscription.current_period_end };
  }

  // Same-interval upgrade: immediate, prorated against the remaining value
  // of the current period — unchanged from the tier-only design.
  if (isTierUpgrade && !intervalChanged) {
    const priceField = subscription.billing_interval === 'YEARLY' ? 'priceYearlyUsd' : 'priceMonthlyUsd';
    const periodStart = new Date(subscription.current_period_start).getTime();
    const periodEnd = new Date(subscription.current_period_end).getTime();
    const totalMs = periodEnd - periodStart;
    const remainingMs = Math.min(Math.max(periodEnd - Date.now(), 0), totalMs);
    const remainingFraction = totalMs > 0 ? remainingMs / totalMs : 0;
    const proratedTotal = Math.round((TIERS[tier][priceField] - TIERS[subscription.tier][priceField]) * remainingFraction * 100) / 100;

    // With ~no time left in the current period, the prorated amount can round
    // to $0 — asking for proof of a $0 transfer isn't something a tenant can
    // actually do. Apply the upgrade immediately instead of routing it through
    // the payment/proof pipeline; there's nothing to collect.
    if (proratedTotal <= 0) {
      const updated = await subscriptionModel.applyTierChange(subscription.id, tier);
      await tenantModel.updateTier(tenant.id, tier, TIERS[tier].documentQuota);
      await tenantEventModel.create(tenant.id, 'TIER_CHANGED', {
        subscriptionId: subscription.id,
        fromTier: subscription.tier,
        toTier: tier,
        totalAmount: 0,
      });
      return { subscription: updated, payment: null, amount: 0 };
    }

    const { baseAmount, ivaAmount, totalAmount } = breakdownAmount(proratedTotal);
    const payment = await paymentModel.create({
      subscriptionId: subscription.id,
      amount: baseAmount,
      ivaRate: IVA_RATE,
      ivaAmount,
      totalAmount,
      purpose: 'TIER_CHANGE',
      targetTier: tier,
    });

    await tenantEventModel.create(tenant.id, 'TIER_CHANGE_REQUESTED', {
      subscriptionId: subscription.id,
      fromTier: subscription.tier,
      toTier: tier,
      totalAmount,
    });

    return { subscription, payment, bankTransfer: config.bankTransfer };
  }

  // Any billing-interval change (tier same, up, or down) — deferred to
  // current_period_end, paid in full at the new tier+interval's sticker
  // price. No cross-interval proration: the current period is already paid
  // for under the old cadence, and the new cadence starts its own fresh,
  // fully-paid period.
  const priceField = targetInterval === 'YEARLY' ? 'priceYearlyUsd' : 'priceMonthlyUsd';
  const fullPrice = TIERS[tier][priceField];
  const { baseAmount, ivaAmount, totalAmount } = breakdownAmount(fullPrice);
  const payment = await paymentModel.create({
    subscriptionId: subscription.id,
    amount: baseAmount,
    ivaRate: IVA_RATE,
    ivaAmount,
    totalAmount,
    purpose: 'TIER_CHANGE',
    targetTier: tier,
    targetBillingInterval: targetInterval,
  });

  await tenantEventModel.create(tenant.id, 'TIER_CHANGE_REQUESTED', {
    subscriptionId: subscription.id,
    fromTier: subscription.tier,
    toTier: tier,
    fromBillingInterval: subscription.billing_interval,
    toBillingInterval: targetInterval,
    totalAmount,
    effectiveAt: subscription.current_period_end,
  });

  return { subscription, payment, bankTransfer: config.bankTransfer, effectiveAt: subscription.current_period_end };
}

// Schedules an end-of-period cancellation by setting pending_tier = 'FREE'.
// No refund is issued — the current period runs to completion at the existing
// tier, then applyScheduledTierChanges() drops the tenant to FREE and closes
// the subscription. Works exactly like a downgrade, except FREE is the target.
async function scheduleCancellation(tenantId) {
  const tenant = await tenantModel.findById(tenantId);
  if (!tenant) throw new NotFoundError('Tenant');

  if (tenant.sandbox) {
    throw new AppError(
      'Subscription cancellation is only available in production — promote first',
      403,
      ErrorCodes.REQUIRES_PRODUCTION
    );
  }

  const subscription = await subscriptionModel.findActiveByTenantId(tenant.id);
  if (!subscription) {
    throw new AppError(
      'Tenant has no ACTIVE subscription to cancel',
      409,
      ErrorCodes.NO_ACTIVE_SUBSCRIPTION
    );
  }

  if (subscription.pending_tier === 'FREE') {
    throw new ConflictError(
      'A cancellation is already scheduled for this subscription',
      ErrorCodes.CANCELLATION_ALREADY_PENDING
    );
  }
  if (subscription.pending_tier) {
    throw new ConflictError(
      `A plan change to '${subscription.pending_tier}'${subscription.pending_billing_interval ? ` (${subscription.pending_billing_interval})` : ''} is already scheduled — cancel it or wait for it to apply before cancelling`,
      ErrorCodes.TIER_CHANGE_ALREADY_PENDING
    );
  }
  const pendingPayment = await paymentModel.findPendingTierChangeBySubscriptionId(subscription.id);
  if (pendingPayment) {
    throw new ConflictError(
      `A plan change to '${pendingPayment.target_tier}'${pendingPayment.target_billing_interval ? ` (${pendingPayment.target_billing_interval})` : ''} is already in progress — wait for it to complete before cancelling`,
      ErrorCodes.TIER_CHANGE_ALREADY_PENDING
    );
  }

  const updated = await subscriptionModel.scheduleDowngrade(subscription.id, 'FREE');
  await tenantEventModel.create(tenant.id, 'SUBSCRIPTION_CANCELLATION_SCHEDULED', {
    subscriptionId: subscription.id,
    fromTier: subscription.tier,
    effectiveAt: subscription.current_period_end,
  });

  return { subscription: updated, effectiveAt: subscription.current_period_end };
}

async function submitPaymentProof(paymentId, tenantId, { buffer, filename, mimeType }) {
  const payment = await paymentModel.findById(paymentId);
  if (!payment) throw new NotFoundError('Payment', ErrorCodes.PAYMENT_NOT_FOUND);

  const subscription = await subscriptionModel.findById(payment.subscription_id);
  if (!subscription || subscription.tenant_id !== tenantId) {
    throw new NotFoundError('Payment', ErrorCodes.PAYMENT_NOT_FOUND);
  }

  if (payment.status === 'VERIFIED') {
    throw new ConflictError('Payment has already been verified and can no longer accept new proof');
  }

  // A REJECTED payment can be re-submitted (e.g. the transfer hadn't reflected in
  // the bank yet) — clear the old rejection_reason since it's being re-addressed.
  const updated = await paymentModel.updateStatus(paymentId, 'REPORTED', {
    reported_at: new Date(),
    proof_file: buffer,
    proof_filename: filename,
    proof_mime_type: mimeType,
    rejection_reason: null,
  });

  await tenantEventModel.create(subscription.tenant_id, 'PAYMENT_REPORTED', { paymentId });

  // Fire-and-forget: let the operator know there's a proof to review. No-op
  // (resolves { sent: false }) if ADMIN_NOTIFICATION_EMAIL isn't configured.
  const tenant = await tenantModel.findById(tenantId);
  fireAndForget(emailService.sendPaymentProofSubmitted(updated, subscription, tenant), 'Payment proof submitted email');

  return omitProofFile(updated);
}

async function getPaymentProof(paymentId) {
  const payment = await paymentModel.findById(paymentId);
  if (!payment || !payment.proof_file) throw new NotFoundError('Payment proof');
  return { buffer: payment.proof_file, filename: payment.proof_filename, mimeType: payment.proof_mime_type };
}

// Tenant-scoped variant: verifies the payment belongs to the requesting tenant
// before returning the proof bytes, so tenants can't access each other's files.
async function getPaymentProofForTenant(paymentId, tenantId) {
  const payment = await paymentModel.findByIdAndTenantId(paymentId, tenantId);
  if (!payment || !payment.proof_file) throw new NotFoundError('Payment proof');
  return { buffer: payment.proof_file, filename: payment.proof_filename, mimeType: payment.proof_mime_type };
}

async function reviewPayment(paymentId, decision, rejectionReason = null) {
  if (!DECISIONS.includes(decision)) {
    throw new AppError(`Invalid decision '${decision}'. Valid values: ${DECISIONS.join(', ')}`, 400);
  }

  const payment = await paymentModel.findById(paymentId);
  if (!payment) throw new NotFoundError('Payment', ErrorCodes.PAYMENT_NOT_FOUND);

  const extraFields = decision === 'VERIFIED'
    ? { verified_at: new Date() }
    : { rejection_reason: rejectionReason };
  const updatedPayment = await paymentModel.updateStatus(paymentId, decision, extraFields);

  const subscription = await subscriptionModel.findById(payment.subscription_id);
  if (!subscription) throw new NotFoundError('Subscription', ErrorCodes.SUBSCRIPTION_NOT_FOUND);

  let updatedSubscription = subscription;
  if (decision === 'VERIFIED') {
    updatedSubscription = await subscriptionModel.updateStatus(subscription.id, 'PAYMENT_RECEIVED');
  }

  await tenantEventModel.create(subscription.tenant_id, decision === 'VERIFIED' ? 'PAYMENT_VERIFIED' : 'PAYMENT_REJECTED', { paymentId });

  // Fire-and-forget: tell the tenant the outcome — there's no other notification
  // for this, see GET /v1/subscriptions/me docs. Covers every payment purpose
  // (INITIAL, TIER_CHANGE, RENEWAL) uniformly; only the wording adapts.
  fireAndForget(notificationService.createPaymentReviewed(updatedPayment, updatedSubscription, decision), 'Payment reviewed notification');
  fireAndForget(emailService.sendPaymentReviewed(updatedPayment, updatedSubscription, decision), 'Payment reviewed email');

  return { payment: omitProofFile(updatedPayment), subscription: updatedSubscription };
}

async function linkInvoice(subscriptionId, accessKey) {
  const subscription = await subscriptionModel.findById(subscriptionId);
  if (!subscription) throw new NotFoundError('Subscription', ErrorCodes.SUBSCRIPTION_NOT_FOUND);

  // No issuerId passed — this is an admin-only, cross-tenant lookup. accessKey is the
  // identifier every other document response already exposes; documents.id never is.
  // findByAccessKey searches both public and sandbox schemas (UNION ALL); the returned
  // row includes `sandbox: true/false` to indicate which schema it came from.
  const document = await documentModel.findByAccessKey(accessKey);
  if (!document) throw new NotFoundError('Document');

  // Sandbox documents cannot be stored in invoice_document_id — the FK on
  // subscriptions references public.documents only. For sandbox testing, activate
  // directly if the document is already AUTHORIZED rather than waiting for the
  // authorization webhook (which fires for public documents, not sandbox ones).
  if (document.sandbox) {
    await tenantEventModel.create(subscription.tenant_id, 'INVOICE_LINKED', {
      subscriptionId, accessKey, note: 'sandbox document — no FK stored',
    });
    if (document.status === 'AUTHORIZED') {
      const periodStart = new Date();
      const periodEnd = addBillingPeriod(periodStart, subscription.billing_interval);
      const activated = await subscriptionModel.updateStatus(subscriptionId, 'ACTIVE', {
        current_period_start: periodStart,
        current_period_end: periodEnd,
      });
      const payments = await paymentModel.findBySubscriptionId(subscriptionId);
      const funding = payments.find((p) => p.status === 'VERIFIED' && !p.period_start);
      if (funding) {
        await paymentModel.updateStatus(funding.id, funding.status, { period_start: periodStart, period_end: periodEnd });
      }
      await tenantModel.updateTier(subscription.tenant_id, subscription.tier, TIERS[subscription.tier].documentQuota);
      await tenantEventModel.create(subscription.tenant_id, 'SUBSCRIPTION_ACTIVATED', {
        subscriptionId, note: 'sandbox invoice',
      });
      return activated;
    }
    return subscriptionModel.updateStatus(subscriptionId, 'INVOICE_PROCESSING', {});
  }

  // A VERIFIED, unlinked TIER_CHANGE payment means this is an upgrade's
  // self-billed invoice, not the subscription's original activation invoice —
  // link it to the payment instead so the subscription's own
  // invoice_document_id (already spent on activation) is left untouched.
  const pendingTierChange = await paymentModel.findPendingTierChangeBySubscriptionId(subscriptionId);
  if (pendingTierChange && pendingTierChange.status === 'VERIFIED') {
    await paymentModel.updateStatus(pendingTierChange.id, 'VERIFIED', { invoice_document_id: document.id });
    await tenantEventModel.create(subscription.tenant_id, 'INVOICE_LINKED', {
      subscriptionId, paymentId: pendingTierChange.id, documentId: document.id,
    });

    if (document.status === 'AUTHORIZED') {
      const applied = await applyTierChangeIfLinked(document.id);
      if (applied) return applied;
    }

    return subscription;
  }

  // Same idea, but for a renewal payment opened by processDueRenewals ahead of
  // current_period_end — link to the payment, not the subscription's own
  // invoice_document_id (already spent on initial activation).
  const pendingRenewal = await paymentModel.findPendingRenewalBySubscriptionId(subscriptionId);
  if (pendingRenewal && pendingRenewal.status === 'VERIFIED') {
    await paymentModel.updateStatus(pendingRenewal.id, 'VERIFIED', { invoice_document_id: document.id });
    await tenantEventModel.create(subscription.tenant_id, 'INVOICE_LINKED', {
      subscriptionId, paymentId: pendingRenewal.id, documentId: document.id,
    });

    if (document.status === 'AUTHORIZED') {
      const applied = await applyRenewalIfLinked(document.id);
      if (applied) return applied;
    }

    return subscription;
  }

  let updated = await subscriptionModel.updateStatus(subscriptionId, 'INVOICE_PROCESSING', {
    invoice_document_id: document.id,
  });

  await tenantEventModel.create(subscription.tenant_id, 'INVOICE_LINKED', { subscriptionId, documentId: document.id });

  // The activation hook only fires on a *new* authorization event inside
  // checkAuthorization() — it never runs for a document that was authorized
  // before being linked. Check immediately so linking an already-authorized
  // invoice doesn't leave the subscription stuck in INVOICE_PROCESSING.
  if (document.status === 'AUTHORIZED') {
    const activated = await activateIfLinked(document.id);
    if (activated) updated = activated;
  }

  return updated;
}

async function activateIfLinked(documentId) {
  const subscription = await subscriptionModel.findByInvoiceDocumentId(documentId);
  if (!subscription || subscription.status !== 'INVOICE_PROCESSING') {
    return null;
  }

  const periodStart = new Date();
  const periodEnd = addBillingPeriod(periodStart, subscription.billing_interval);

  const updated = await subscriptionModel.updateStatus(subscription.id, 'ACTIVE', {
    current_period_start: periodStart,
    current_period_end: periodEnd,
  });

  // Stamp the period onto the payment that funded this cycle too — subscriptions'
  // current_period_start/end gets overwritten every renewal, so without this the
  // per-cycle history would be lost (see NEXT_STEPS.md #9: payments now support
  // many rows per subscription, one per billing cycle).
  const payments = await paymentModel.findBySubscriptionId(subscription.id);
  const fundingPayment = payments.find((p) => p.status === 'VERIFIED' && !p.period_start);
  if (fundingPayment) {
    await paymentModel.updateStatus(fundingPayment.id, fundingPayment.status, {
      period_start: periodStart,
      period_end: periodEnd,
    });
  }

  await tenantModel.updateTier(subscription.tenant_id, subscription.tier, TIERS[subscription.tier].documentQuota);
  await tenantEventModel.create(subscription.tenant_id, 'SUBSCRIPTION_ACTIVATED', {
    subscriptionId: subscription.id,
    tier: subscription.tier,
  });

  return updated;
}

// Mirrors activateIfLinked, but for a TIER_CHANGE payment rather than a
// subscription's initial activation. No-op for the vast majority of
// authorized documents, which aren't linked to any tier-change payment.
async function applyTierChangeIfLinked(documentId) {
  const payment = await paymentModel.findByInvoiceDocumentId(documentId);
  if (!payment || payment.purpose !== 'TIER_CHANGE' || payment.status !== 'VERIFIED') {
    return null;
  }

  const subscription = await subscriptionModel.findById(payment.subscription_id);
  if (!subscription) return null;

  // A billing-interval change can't neatly prorate mid-cycle — now that it's
  // paid in full for the new interval, defer it to current_period_end (same
  // as a free downgrade) instead of applying it now. Tier-only changes (no
  // interval change) keep applying immediately, taking over the remainder of
  // the current cycle.
  if (payment.target_billing_interval) {
    const updated = await subscriptionModel.scheduleDowngrade(
      subscription.id,
      payment.target_tier,
      payment.target_billing_interval
    );

    await tenantEventModel.create(subscription.tenant_id, 'TIER_CHANGE_SCHEDULED', {
      subscriptionId: subscription.id,
      fromTier: subscription.tier,
      toTier: payment.target_tier,
      fromBillingInterval: subscription.billing_interval,
      toBillingInterval: payment.target_billing_interval,
      effectiveAt: subscription.current_period_end,
      paymentId: payment.id,
    });

    return updated;
  }

  const updated = await subscriptionModel.applyTierChange(subscription.id, payment.target_tier);

  await tenantModel.updateTier(subscription.tenant_id, payment.target_tier, TIERS[payment.target_tier].documentQuota);

  // The upgrade takes over the remainder of the same billing cycle — the
  // subscription's period dates don't change, only the tier does — so stamp
  // those same dates onto the payment for per-cycle history, same as the
  // funding-payment stamp in activateIfLinked.
  await paymentModel.updateStatus(payment.id, payment.status, {
    period_start: subscription.current_period_start,
    period_end: subscription.current_period_end,
  });

  await tenantEventModel.create(subscription.tenant_id, 'TIER_CHANGED', {
    subscriptionId: subscription.id,
    fromTier: subscription.tier,
    toTier: payment.target_tier,
    paymentId: payment.id,
  });

  return updated;
}

// Mirrors activateIfLinked, but extends the existing period instead of opening
// a first one. Anchored to the OLD current_period_end (not "now") so an early
// or late admin review can't drift the billing date — back-to-back periods,
// no gap and no overlap.
async function applyRenewalIfLinked(documentId) {
  const payment = await paymentModel.findByInvoiceDocumentId(documentId);
  if (!payment || payment.purpose !== 'RENEWAL' || payment.status !== 'VERIFIED') {
    return null;
  }

  const subscription = await subscriptionModel.findById(payment.subscription_id);
  if (!subscription) return null;

  const periodStart = new Date(subscription.current_period_end);
  const periodEnd = addBillingPeriod(periodStart, subscription.billing_interval);

  const updated = await subscriptionModel.updateStatus(subscription.id, 'ACTIVE', {
    current_period_start: periodStart,
    current_period_end: periodEnd,
  });

  await paymentModel.updateStatus(payment.id, payment.status, {
    period_start: periodStart,
    period_end: periodEnd,
  });

  await tenantEventModel.create(subscription.tenant_id, 'SUBSCRIPTION_RENEWED', {
    subscriptionId: subscription.id,
    tier: subscription.tier,
    periodStart,
    periodEnd,
  });

  return updated;
}

// Applies every downgrade scheduled via requestTierChange whose
// current_period_end has passed. Called by the admin job (POST
// /v1/admin/jobs/subscriptions), same pattern as
// notification-scheduler.service.js's runAll().
//
// Also rolls the period forward (anchored to the OLD current_period_end, same
// as applyRenewalIfLinked) so the subscription re-enters the renewal cycle at
// its new, lower tier instead of sitting on a current_period_end already in
// the past — a downgrade owes no payment, but it still needs a fresh period or
// processDueRenewals would immediately treat it as expired.
async function applyScheduledTierChanges() {
  const due = await subscriptionModel.findDuePendingDowngrades();

  for (const subscription of due) {
    if (subscription.pending_tier === 'FREE') {
      await subscriptionModel.applyTierChange(subscription.id, 'FREE');
      await subscriptionModel.updateStatus(subscription.id, 'CANCELLED', { canceled_at: new Date() });
      await tenantModel.updateTier(subscription.tenant_id, 'FREE', TIERS['FREE'].documentQuota);
      await tenantEventModel.create(subscription.tenant_id, 'SUBSCRIPTION_CANCELLED', {
        subscriptionId: subscription.id,
        fromTier: subscription.tier,
      });
    } else {
      // pending_billing_interval is only set for a paid interval switch (see
      // applyTierChangeIfLinked); a plain free tier downgrade leaves it null
      // and the period keeps the subscription's existing cadence.
      const newInterval = subscription.pending_billing_interval || subscription.billing_interval;
      const periodStart = new Date(subscription.current_period_end);
      const periodEnd = addBillingPeriod(periodStart, newInterval);

      await subscriptionModel.applyTierChange(subscription.id, subscription.pending_tier, subscription.pending_billing_interval);
      await subscriptionModel.updateStatus(subscription.id, 'ACTIVE', {
        current_period_start: periodStart,
        current_period_end: periodEnd,
      });
      await tenantModel.updateTier(subscription.tenant_id, subscription.pending_tier, TIERS[subscription.pending_tier].documentQuota);

      // If this pending change was funded by a paid TIER_CHANGE payment (an
      // interval switch — free tier-only downgrades have no such payment),
      // stamp the new period onto it for per-cycle payment history, same as
      // activateIfLinked/applyRenewalIfLinked do for their own funding payment.
      if (subscription.pending_billing_interval) {
        const payments = await paymentModel.findBySubscriptionId(subscription.id);
        const funding = payments.find((p) =>
          p.purpose === 'TIER_CHANGE' && p.status === 'VERIFIED' && p.invoice_document_id && !p.period_start
        );
        if (funding) {
          await paymentModel.updateStatus(funding.id, funding.status, { period_start: periodStart, period_end: periodEnd });
        }
      }

      await tenantEventModel.create(subscription.tenant_id, 'TIER_CHANGED', {
        subscriptionId: subscription.id,
        fromTier: subscription.tier,
        toTier: subscription.pending_tier,
        fromBillingInterval: subscription.billing_interval,
        toBillingInterval: newInterval,
      });
    }
  }

  return { applied: due.length };
}

// Opens a renewal payment + notifies the tenant ahead of current_period_end,
// and downgrades to FREE any subscription that ran past its grace period with
// no verified renewal. Called by the same admin job as applyScheduledTierChanges
// (POST /v1/admin/jobs/subscriptions) — that one must run first in the same
// tick so a just-rolled-forward downgrade isn't mistaken for an expired renewal.
async function processDueRenewals() {
  const dueForReminder = await subscriptionModel.findDueForRenewalReminder(RENEWAL_REMINDER_DAYS);
  for (const subscription of dueForReminder) {
    await createRenewalReminder(subscription);
  }

  const dueForExpiry = await subscriptionModel.findExpiredPastGrace(RENEWAL_GRACE_DAYS);
  for (const subscription of dueForExpiry) {
    await expireSubscription(subscription);
  }

  return { remindersSent: dueForReminder.length, expired: dueForExpiry.length };
}

async function createRenewalReminder(subscription) {
  const priceField = subscription.billing_interval === 'YEARLY' ? 'priceYearlyUsd' : 'priceMonthlyUsd';
  const { baseAmount, ivaAmount, totalAmount } = breakdownAmount(TIERS[subscription.tier][priceField]);

  const payment = await paymentModel.create({
    subscriptionId: subscription.id,
    amount: baseAmount,
    ivaRate: IVA_RATE,
    ivaAmount,
    totalAmount,
    purpose: 'RENEWAL',
  });

  await tenantEventModel.create(subscription.tenant_id, 'RENEWAL_DUE', {
    subscriptionId: subscription.id,
    paymentId: payment.id,
    tier: subscription.tier,
    currentPeriodEnd: subscription.current_period_end,
  });

  fireAndForget(notificationService.createSubscriptionRenewalDue(subscription, payment), 'Renewal due notification');
  fireAndForget(emailService.sendSubscriptionRenewalDue(subscription, payment), 'Renewal due email');
}

async function expireSubscription(subscription) {
  await tenantModel.updateTier(subscription.tenant_id, 'FREE', TIERS.FREE.documentQuota);
  const updated = await subscriptionModel.updateStatus(subscription.id, 'EXPIRED');

  await tenantEventModel.create(subscription.tenant_id, 'SUBSCRIPTION_EXPIRED', {
    subscriptionId: subscription.id,
    previousTier: subscription.tier,
  });

  fireAndForget(notificationService.createSubscriptionExpired(subscription), 'Subscription expired notification');
  fireAndForget(emailService.sendSubscriptionExpired(subscription), 'Subscription expired email');

  return updated;
}

async function cancelSubscription(subscriptionId) {
  const subscription = await subscriptionModel.findById(subscriptionId);
  if (!subscription) throw new NotFoundError('Subscription', ErrorCodes.SUBSCRIPTION_NOT_FOUND);

  const updated = await subscriptionModel.updateStatus(subscriptionId, 'CANCELLED', { canceled_at: new Date() });
  await tenantEventModel.create(subscription.tenant_id, 'SUBSCRIPTION_CANCELLED', { subscriptionId });

  return updated;
}

async function listByTenant(tenantId) {
  return subscriptionModel.findByTenantId(tenantId);
}

// Cross-tenant review queue for the admin panel — every payment in the given
// status (default REPORTED: proof submitted, awaiting a decision), with the
// tenant's business identity attached so the admin doesn't need a second
// lookup per row. proof_file is never included; GET /admin/payments/:id/proof
// streams it separately (same omitProofFile pattern as everywhere else here).
async function listPendingPayments(status = 'REPORTED') {
  const payments = await paymentModel.findAllByStatus(status);
  const tenantIds = [...new Set(payments.map((p) => p.tenant_id))];
  const tenants = await Promise.all(tenantIds.map((id) => tenantModel.findById(id)));
  const tenantsById = new Map(tenants.filter(Boolean).map((t) => [t.id, t]));

  return payments.map((payment) => {
    const tenant = tenantsById.get(payment.tenant_id);
    return {
      ...omitProofFile(payment),
      tenant: tenant ? { id: tenant.id, email: tenant.email } : null,
    };
  });
}

// Tenant-facing read: full subscription history with each one's payments nested,
// newest first. No notification exists when a review/activation happens — this
// (polled) is how a tenant finds out. proof_file is never included; the file
// itself stays behind the dedicated proof-download flow (admin-only).
async function getStatusForTenant(tenantId) {
  const subscriptions = await subscriptionModel.findByTenantId(tenantId);
  const withPayments = await Promise.all(
    subscriptions.map(async (subscription) => ({
      ...subscription,
      payments: (await paymentModel.findBySubscriptionId(subscription.id)).map(omitProofFile),
    }))
  );
  return withPayments;
}

module.exports = {
  createSubscription,
  createSubscriptionForTenant,
  requestTierChange,
  scheduleCancellation,
  submitPaymentProof,
  getPaymentProof,
  getPaymentProofForTenant,
  reviewPayment,
  linkInvoice,
  activateIfLinked,
  applyTierChangeIfLinked,
  applyRenewalIfLinked,
  applyScheduledTierChanges,
  processDueRenewals,
  cancelSubscription,
  listByTenant,
  listPendingPayments,
  getStatusForTenant,
  addBillingPeriod,
  resetPeriodOnPromotion,
};

// Resets the billing period of an ACTIVE subscription to start at promotion
// time. Called from tenant.service.js when a sandbox tenant promotes to
// production — the paid period should count production usage, not sandbox
// testing time. Also resets the funding payment's period stamps for audit
// trail consistency (mirrors activateIfLinked's stamping logic).
async function resetPeriodOnPromotion(subscriptionId) {
  const subscription = await subscriptionModel.findById(subscriptionId);
  if (!subscription || subscription.status !== 'ACTIVE') return null;

  const periodStart = new Date();
  const periodEnd = addBillingPeriod(periodStart, subscription.billing_interval);

  const updated = await subscriptionModel.updateStatus(subscriptionId, 'ACTIVE', {
    current_period_start: periodStart,
    current_period_end: periodEnd,
  });

  const payments = await paymentModel.findBySubscriptionId(subscriptionId);
  const funding = payments.find((p) => p.status === 'VERIFIED' && p.period_start);
  if (funding) {
    await paymentModel.updateStatus(funding.id, funding.status, {
      period_start: periodStart,
      period_end: periodEnd,
    });
  }

  return updated;
}
