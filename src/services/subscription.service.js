const subscriptionModel = require('../models/subscription.model');
const paymentModel = require('../models/payment.model');
const documentModel = require('../models/document.model');
const tenantModel = require('../models/tenant.model');
const tenantEventModel = require('../models/tenant-event.model');
const notificationService = require('./notification.service');
const emailService = require('./email.service');
const TIERS = require('../constants/subscription-tiers');
const TenantStatus = require('../constants/tenant-status');
const config = require('../config');
const AppError = require('../errors/app-error');
const ConflictError = require('../errors/conflict-error');
const NotFoundError = require('../errors/not-found-error');
const ErrorCodes = require('../constants/error-codes');

const PAID_TIERS = Object.keys(TIERS).filter((t) => t !== 'FREE');
const BILLING_INTERVALS = ['MONTHLY', 'YEARLY'];
const DECISIONS = ['VERIFIED', 'REJECTED'];

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
      400
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
  const amount = billingInterval === 'YEARLY' ? TIERS[tier].priceYearlyUsd : TIERS[tier].priceMonthlyUsd;
  const payment = await paymentModel.create({ subscriptionId: subscription.id, amount });

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

// Tenant-initiated tier change on an already-ACTIVE subscription. Upgrades take
// effect immediately once a prorated payment is verified and its self-billed
// invoice authorizes (see applyTierChangeIfLinked); downgrades are scheduled
// and applied at current_period_end (see applyScheduledTierChanges) — no
// payment is owed for a downgrade since the current period is already paid
// for at the higher tier. No automated billing gateway exists yet
// (NEXT_STEPS.md #9), so this rides the same manual proof/review pipeline as
// createSubscription rather than charging anything automatically.
async function requestTierChange(tenantId, tier) {
  if (!PAID_TIERS.includes(tier)) {
    throw new AppError(
      `Invalid tier '${tier}'. Valid paid tiers: ${PAID_TIERS.join(', ')}`,
      400,
      ErrorCodes.INVALID_TIER
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

  if (tier === subscription.tier) {
    throw new AppError(`Tenant is already on the '${tier}' tier`, 400, ErrorCodes.TIER_CHANGE_NO_OP);
  }

  if (subscription.pending_tier) {
    throw new ConflictError(
      `A downgrade to '${subscription.pending_tier}' is already scheduled for this subscription`,
      ErrorCodes.TIER_CHANGE_ALREADY_PENDING
    );
  }
  const pendingPayment = await paymentModel.findPendingTierChangeBySubscriptionId(subscription.id);
  if (pendingPayment) {
    throw new ConflictError(
      `An upgrade to '${pendingPayment.target_tier}' is already in progress for this subscription`,
      ErrorCodes.TIER_CHANGE_ALREADY_PENDING
    );
  }

  const isUpgrade = TIERS[tier].priceMonthlyUsd > TIERS[subscription.tier].priceMonthlyUsd;

  if (!isUpgrade) {
    const updated = await subscriptionModel.scheduleDowngrade(subscription.id, tier);
    await tenantEventModel.create(tenant.id, 'TIER_CHANGE_SCHEDULED', {
      subscriptionId: subscription.id,
      fromTier: subscription.tier,
      toTier: tier,
      effectiveAt: subscription.current_period_end,
    });
    return { subscription: updated, effectiveAt: subscription.current_period_end };
  }

  const priceField = subscription.billing_interval === 'YEARLY' ? 'priceYearlyUsd' : 'priceMonthlyUsd';
  const periodStart = new Date(subscription.current_period_start).getTime();
  const periodEnd = new Date(subscription.current_period_end).getTime();
  const totalMs = periodEnd - periodStart;
  const remainingMs = Math.min(Math.max(periodEnd - Date.now(), 0), totalMs);
  const remainingFraction = totalMs > 0 ? remainingMs / totalMs : 0;
  const amount = Math.round((TIERS[tier][priceField] - TIERS[subscription.tier][priceField]) * remainingFraction * 100) / 100;

  // With ~no time left in the current period, the prorated amount can round
  // to $0 — asking for proof of a $0 transfer isn't something a tenant can
  // actually do. Apply the upgrade immediately instead of routing it through
  // the payment/proof pipeline; there's nothing to collect.
  if (amount <= 0) {
    const updated = await subscriptionModel.applyTierChange(subscription.id, tier);
    await tenantModel.updateTier(tenant.id, tier, TIERS[tier].documentQuota);
    await tenantEventModel.create(tenant.id, 'TIER_CHANGED', {
      subscriptionId: subscription.id,
      fromTier: subscription.tier,
      toTier: tier,
      amount: 0,
    });
    return { subscription: updated, payment: null, amount: 0 };
  }

  const payment = await paymentModel.create({
    subscriptionId: subscription.id,
    amount,
    purpose: 'TIER_CHANGE',
    targetTier: tier,
  });

  await tenantEventModel.create(tenant.id, 'TIER_CHANGE_REQUESTED', {
    subscriptionId: subscription.id,
    fromTier: subscription.tier,
    toTier: tier,
    amount,
  });

  return { subscription, payment, bankTransfer: config.bankTransfer };
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

// Mirrors activateIfLinked, but for an upgrade's TIER_CHANGE payment rather
// than a subscription's initial activation. No-op for the vast majority of
// authorized documents, which aren't linked to any tier-change payment.
async function applyTierChangeIfLinked(documentId) {
  const payment = await paymentModel.findByInvoiceDocumentId(documentId);
  if (!payment || payment.purpose !== 'TIER_CHANGE' || payment.status !== 'VERIFIED') {
    return null;
  }

  const subscription = await subscriptionModel.findById(payment.subscription_id);
  if (!subscription) return null;

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
    const periodStart = new Date(subscription.current_period_end);
    const periodEnd = addBillingPeriod(periodStart, subscription.billing_interval);

    await subscriptionModel.applyTierChange(subscription.id, subscription.pending_tier);
    await subscriptionModel.updateStatus(subscription.id, 'ACTIVE', {
      current_period_start: periodStart,
      current_period_end: periodEnd,
    });
    await tenantModel.updateTier(subscription.tenant_id, subscription.pending_tier, TIERS[subscription.pending_tier].documentQuota);
    await tenantEventModel.create(subscription.tenant_id, 'TIER_CHANGED', {
      subscriptionId: subscription.id,
      fromTier: subscription.tier,
      toTier: subscription.pending_tier,
    });
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
  const amount = TIERS[subscription.tier][priceField];

  const payment = await paymentModel.create({
    subscriptionId: subscription.id,
    amount,
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
  submitPaymentProof,
  getPaymentProof,
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
};
