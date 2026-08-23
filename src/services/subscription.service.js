const subscriptionModel = require('../models/subscription.model');
const paymentModel = require('../models/payment.model');
const paymentProofModel = require('../models/payment-proof.model');
const documentModel = require('../models/document.model');
const tenantModel = require('../models/tenant.model');
const tenantEventModel = require('../models/tenant-event.model');
const tenantQuotaService = require('./tenant-quota.service');
const pendingEffectService = require('./pending-effect.service');
const pricingService = require('./pricing.service');
const notificationService = require('./notification.service');
const { EffectTypes } = require('../constants/effect-types');
const { TIERS, IVA_RATE } = require('../constants/subscription-tiers');
const TenantStatus = require('../constants/tenant-status');
const RejectionReasons = require('../constants/rejection-reasons');
const config = require('../config');
const AppError = require('../errors/app-error');
const ConflictError = require('../errors/conflict-error');
const NotFoundError = require('../errors/not-found-error');
const ErrorCodes = require('../constants/error-codes');

const PAID_TIERS = Object.keys(TIERS).filter((t) => t !== 'FREE');
const BILLING_INTERVALS = ['MONTHLY', 'YEARLY'];
const DECISIONS = ['VERIFIED', 'REJECTED'];

// Per-request file count is enforced by multer (payments.routes.js); this is
// the cumulative cap across every upload attempt for one payment, so repeated
// resubmission can't grow the file list unboundedly.
const MAX_ACTIVE_PROOFS_PER_PAYMENT = 10;

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
// with no verified renewal before it's downgraded to FREE and the tenant is
// marked PAST_DUE. See processDueRenewals.
const RENEWAL_REMINDER_DAYS = 7;
const RENEWAL_GRACE_DAYS = 7;
// How far past current_period_end the PAST_DUE warning fires — partway
// through the grace window above, a second/final notice distinct from the
// renewal-due reminder. Must stay < RENEWAL_GRACE_DAYS.
const SUSPENSION_WARNING_DAYS = 5;

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

// Durable-enqueue + best-effort-dispatch (ADR-022) — replaces the old
// fireAndForget()/unawaited-promise pattern. Awaited by callers so the
// enqueue (durable insert) lands before the caller returns; dispatch (the
// RabbitMQ publish) stays best-effort, same as document-transmission.service.js.
async function queueEffect(effectType, tenantId, payload) {
  const effect = await pendingEffectService.enqueue(effectType, tenantId, payload);
  pendingEffectService.dispatch(effect);
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
  const priceUsd = await pricingService.getCurrentPrice(tier, billingInterval);
  const { baseAmount, ivaAmount, totalAmount } = breakdownAmount(priceUsd);
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
  if (tenant.status === TenantStatus.PENDING_VERIFICATION) {
    throw new AppError(
      'Email verification is required before starting a subscription. Check your inbox.',
      403,
      ErrorCodes.EMAIL_VERIFICATION_REQUIRED
    );
  }
  // PAST_DUE is deliberately allowed through — starting a fresh subscription
  // and paying is the self-service recovery path back to ACTIVE (see
  // applyVerifiedPayment's PAST_DUE -> ACTIVE step). SUSPENDED never reaches
  // here: requireNotSuspended already blocks POST /v1/subscriptions upstream.
  // See docs/adr/025-past-due-tenant-status.md.

  return createSubscription(tenantId, tier, billingInterval);
}

// Tenant-initiated tier and/or billing-interval change on an already-ACTIVE
// subscription. Same-interval upgrades take effect immediately once a
// prorated payment is verified and its self-billed invoice authorizes (see
// applyVerifiedPayment); same-interval downgrades are scheduled and
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
// No automated billing gateway exists yet (see NEXT_STEPS.md's "Payment Gateway
// Integration" item), so this rides the same manual proof/review pipeline as
// createSubscription rather than charging anything automatically.
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

  const targetMonthlyPrice = await pricingService.getCurrentPrice(tier, 'MONTHLY');
  const currentMonthlyPrice = await pricingService.getCurrentPrice(subscription.tier, 'MONTHLY');
  const isTierUpgrade = targetMonthlyPrice > currentMonthlyPrice;
  const isTierDowngrade = targetMonthlyPrice < currentMonthlyPrice;

  // Sandbox subscriptions have no meaningful current_period_end — it's fully
  // discarded the moment the tenant promotes (resetPeriodOnPromotion resets
  // it to "now" at that point, regardless of what was there before) — so
  // there's nothing to prorate against or defer a change to. See
  // requestSandboxTierChange.
  if (tenant.sandbox) {
    return requestSandboxTierChange(tenant, subscription, tier, targetInterval, isTierDowngrade);
  }

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
    const billingInterval = subscription.billing_interval;
    const periodStart = new Date(subscription.current_period_start).getTime();
    const periodEnd = new Date(subscription.current_period_end).getTime();
    const totalMs = periodEnd - periodStart;
    const remainingMs = Math.min(Math.max(periodEnd - Date.now(), 0), totalMs);
    const remainingFraction = totalMs > 0 ? remainingMs / totalMs : 0;
    // Upgrade takes effect immediately, so both prices resolve as of now.
    const targetPrice = await pricingService.getCurrentPrice(tier, billingInterval);
    const currentPrice = await pricingService.getCurrentPrice(subscription.tier, billingInterval);
    const proratedTotal = Math.round((targetPrice - currentPrice) * remainingFraction * 100) / 100;

    // With ~no time left in the current period, the prorated amount can round
    // to $0 — asking for proof of a $0 transfer isn't something a tenant can
    // actually do. Apply the upgrade immediately instead of routing it through
    // the payment/proof pipeline; there's nothing to collect.
    if (proratedTotal <= 0) {
      const updated = await subscriptionModel.applyTierChange(subscription.id, tier);
      await tenantModel.updateTier(tenant.id, tier);
      await tenantQuotaService.setCap(tenant.id, tier);
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
  // fully-paid period. Resolved as of current_period_end (when the new
  // cadence's period actually starts), not "now" — this is what makes a
  // pending price change's 30-day protection apply here too.
  const fullPrice = await pricingService.getPriceAsOf(tier, targetInterval, subscription.current_period_end);
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

// Sandbox variant of requestTierChange's pricing/application logic. Every
// sandbox tier/interval change applies immediately (see applyVerifiedPayment,
// which is where a paid change actually lands once its self-billed invoice
// authorizes) and is priced at the target plan's FULL sticker price — never
// prorated. Proration only makes sense against a real, running billing
// period; a sandbox current_period_end is thrown away entirely at promotion,
// so crediting "remaining time" in it doesn't reflect anything the tenant
// will actually owe once real billing starts. Downgrades still owe nothing
// (that principle is about "you already paid for this," not period math),
// but apply immediately rather than being scheduled for a period boundary
// that's about to be discarded anyway.
async function requestSandboxTierChange(tenant, subscription, tier, targetInterval, isTierDowngrade) {
  if (isTierDowngrade) {
    const updated = await subscriptionModel.applyTierChange(subscription.id, tier, targetInterval);
    await tenantModel.updateTier(tenant.id, tier);
    await tenantQuotaService.setCap(tenant.id, tier);
    await tenantEventModel.create(tenant.id, 'TIER_CHANGED', {
      subscriptionId: subscription.id,
      fromTier: subscription.tier,
      toTier: tier,
      fromBillingInterval: subscription.billing_interval,
      toBillingInterval: targetInterval,
      totalAmount: 0,
      note: 'sandbox — applied immediately, no charge',
    });
    return { subscription: updated, payment: null, amount: 0 };
  }

  // Sandbox changes always apply immediately (see comment above), so "now" is correct.
  const fullPrice = await pricingService.getCurrentPrice(tier, targetInterval);
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
    note: 'sandbox — full price, applies immediately once the self-billed invoice authorizes',
  });

  return { subscription, payment, bankTransfer: config.bankTransfer };
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

function formatPaymentProof(row) {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    referenceNumber: row.reference_number,
    active: row.active,
    createdAt: row.created_at,
  };
}

// files: array of { buffer, filename, mimeType } — one submission attempt can
// carry multiple files (limit enforced by multer in payments.routes.js).
// Every file is kept forever (soft-deletable, but never overwritten) — see
// payment-proof.model.js and db/migrations/069_payment_proofs.sql.
// referenceNumber is the bank's SPI transfer reference — required per
// submission attempt, stored on every file row created by that attempt
// (see db/migrations/071_payment_proof_reference_number.sql).
async function submitPaymentProof(paymentId, tenantId, files, referenceNumber) {
  const payment = await paymentModel.findById(paymentId);
  if (!payment) throw new NotFoundError('Payment', ErrorCodes.PAYMENT_NOT_FOUND);

  const subscription = await subscriptionModel.findById(payment.subscription_id);
  if (!subscription || subscription.tenant_id !== tenantId) {
    throw new NotFoundError('Payment', ErrorCodes.PAYMENT_NOT_FOUND);
  }

  if (payment.status === 'VERIFIED') {
    throw new ConflictError('Payment has already been verified and can no longer accept new proof');
  }

  const activeCount = await paymentProofModel.countActiveByPaymentId(paymentId);
  if (activeCount + files.length > MAX_ACTIVE_PROOFS_PER_PAYMENT) {
    throw new AppError(
      `This payment already has ${activeCount} proof file(s); at most ${MAX_ACTIVE_PROOFS_PER_PAYMENT} are allowed in total. Delete an old one before uploading more.`,
      400,
      ErrorCodes.PROOF_FILE_LIMIT_REACHED
    );
  }

  const createdProofs = await paymentProofModel.createMany(paymentId, files, referenceNumber);

  // A REJECTED payment can be re-submitted (e.g. the transfer hadn't reflected in
  // the bank yet) — clear the old rejection_reason_code since it's being re-addressed.
  // The files themselves are never overwritten — createMany above only adds rows.
  const updated = await paymentModel.updateStatus(paymentId, 'REPORTED', {
    reported_at: new Date(),
    rejection_reason_code: null,
  });

  await tenantEventModel.create(subscription.tenant_id, 'PAYMENT_REPORTED', { paymentId, proofCount: files.length, referenceNumber });

  // Let the operator know there's a proof to review. No-op (resolves
  // { sent: false }) if ADMIN_NOTIFICATION_EMAIL isn't configured. Durably
  // enqueued (ADR-022) — the handler re-fetches payment/subscription/tenant fresh.
  await queueEffect(EffectTypes.PAYMENT_PROOF_SUBMITTED_EMAIL, subscription.tenant_id, {
    paymentId: updated.id, subscriptionId: subscription.id, tenantId, referenceNumber,
  });

  return { payment: updated, proofs: createdProofs.map(formatPaymentProof) };
}

// Admin: any proof file regardless of active state, for full audit visibility.
async function getPaymentProofFile(paymentId, proofId) {
  const proof = await paymentProofModel.findByIdAndPaymentId(proofId, paymentId);
  if (!proof) throw new NotFoundError('Payment proof');
  return { buffer: proof.file, filename: proof.filename, mimeType: proof.mime_type };
}

// Tenant-scoped variant: verifies the payment belongs to the requesting tenant,
// and only serves an active (non-deleted) file — a file the tenant deleted
// disappears from their own access, same as their list view.
async function getPaymentProofFileForTenant(paymentId, proofId, tenantId) {
  const payment = await paymentModel.findByIdAndTenantId(paymentId, tenantId);
  if (!payment) throw new NotFoundError('Payment proof');
  const proof = await paymentProofModel.findByIdAndPaymentId(proofId, paymentId);
  if (!proof || !proof.active) throw new NotFoundError('Payment proof');
  return { buffer: proof.file, filename: proof.filename, mimeType: proof.mime_type };
}

async function listPaymentProofsForTenant(paymentId, tenantId) {
  const payment = await paymentModel.findByIdAndTenantId(paymentId, tenantId);
  if (!payment) throw new NotFoundError('Payment', ErrorCodes.PAYMENT_NOT_FOUND);
  const proofs = await paymentProofModel.findActiveByPaymentId(paymentId);
  return proofs.map(formatPaymentProof);
}

// Admin: every file ever uploaded for this payment, active or not, so the
// operator can see the full history across rejections/resubmissions.
async function listPaymentProofsForAdmin(paymentId) {
  const proofs = await paymentProofModel.findAllByPaymentId(paymentId);
  return proofs.map(formatPaymentProof);
}

async function deletePaymentProofForTenant(paymentId, proofId, tenantId) {
  const payment = await paymentModel.findByIdAndTenantId(paymentId, tenantId);
  if (!payment) throw new NotFoundError('Payment', ErrorCodes.PAYMENT_NOT_FOUND);

  if (payment.status === 'VERIFIED') {
    throw new ConflictError('Payment has already been verified and its proof files can no longer be changed');
  }

  const deleted = await paymentProofModel.softDelete(proofId, paymentId);
  if (!deleted) throw new NotFoundError('Payment proof');
  return formatPaymentProof(deleted);
}

async function reviewPayment(paymentId, decision, rejectionReasonCode = null) {
  if (!DECISIONS.includes(decision)) {
    throw new AppError(`Invalid decision '${decision}'. Valid values: ${DECISIONS.join(', ')}`, 400);
  }
  if (decision === 'REJECTED' && !Object.values(RejectionReasons).includes(rejectionReasonCode)) {
    throw new AppError(
      `Invalid rejectionReasonCode '${rejectionReasonCode}'. Valid values: ${Object.values(RejectionReasons).join(', ')}`,
      400,
      ErrorCodes.INVALID_REJECTION_REASON
    );
  }

  const payment = await paymentModel.findById(paymentId);
  if (!payment) throw new NotFoundError('Payment', ErrorCodes.PAYMENT_NOT_FOUND);

  const extraFields = decision === 'VERIFIED'
    ? { verified_at: new Date() }
    : { rejection_reason_code: rejectionReasonCode };
  const updatedPayment = await paymentModel.updateStatus(paymentId, decision, extraFields);

  const subscription = await subscriptionModel.findById(payment.subscription_id);
  if (!subscription) throw new NotFoundError('Subscription', ErrorCodes.SUBSCRIPTION_NOT_FOUND);

  // Verification alone grants access now — no invoice gate (ADR-027). The
  // intermediate PAYMENT_RECEIVED/INVOICE_PROCESSING statuses this used to
  // step through are gone; the operator's still-owed invoice is tracked by
  // listPendingInvoices() instead of by withholding the tier.
  let updatedSubscription = subscription;
  if (decision === 'VERIFIED') {
    updatedSubscription = await applyVerifiedPayment(updatedPayment, subscription);
  }

  await tenantEventModel.create(subscription.tenant_id, decision === 'VERIFIED' ? 'PAYMENT_VERIFIED' : 'PAYMENT_REJECTED', { paymentId });

  // Tell the tenant the outcome — there's no other notification for this,
  // see GET /v1/subscriptions/me docs. Covers every payment purpose
  // (INITIAL, TIER_CHANGE, RENEWAL) uniformly; only the wording adapts.
  // createPaymentReviewed() creates the in-app row synchronously and
  // durably enqueues the NOTIFICATION_DISPATCH effect for email (ADR-024).
  await notificationService.createPaymentReviewed(updatedPayment, updatedSubscription, decision);

  return { payment: updatedPayment, subscription: updatedSubscription };
}

// Snapshot of the state a verified payment is about to change, stored on the
// payment itself (payments.applied_from) at apply time. Restoring it verbatim
// is the whole of refundPayment(): a reversed TIER_CHANGE must return to the
// previous *paid* tier rather than FREE, and a reversed RENEWAL must roll the
// period back rather than change tier at all — neither is reconstructible
// after the fact. tenantTier is captured separately from the subscription's
// own tier because they legitimately differ: an INITIAL payment's
// subscription already reads STARTER at creation while the tenant is still
// FREE, so restoring subscription.tier alone would leave the tenant paying
// nothing on a paid tier.
function snapshotState(subscription, tenant) {
  return {
    tier: subscription.tier,
    billingInterval: subscription.billing_interval,
    periodStart: subscription.current_period_start,
    periodEnd: subscription.current_period_end,
    subscriptionStatus: subscription.status,
    tenantTier: tenant.subscription_tier,
  };
}

// The single place a verified payment becomes access. Called from
// reviewPayment() once an operator verifies a transfer.
//
// Activation is deliberately NOT gated on the operator's self-billed invoice
// being SRI-AUTHORIZED any more (that was ADR-017's original design, replaced
// by ADR-027): issuing the factura is the operator's obligation on the
// operator's clock, and withholding a paid-for service until it clears made
// the customer absorb an SRI outage. The invoice is now tracked as a work
// queue instead — see listPendingInvoices().
async function applyVerifiedPayment(payment, subscription) {
  const tenant = await tenantModel.findById(subscription.tenant_id);
  if (!tenant) throw new NotFoundError('Tenant');

  await paymentModel.updateStatus(payment.id, payment.status, {
    applied_from: snapshotState(subscription, tenant),
  });

  if (payment.purpose === 'TIER_CHANGE') return applyTierChangePayment(payment, subscription);
  if (payment.purpose === 'RENEWAL') return applyRenewalPayment(payment, subscription);
  return applyInitialPayment(payment, subscription, tenant);
}

// First cycle — "now" is the correct anchor here (one of the two documented
// exceptions to the never-anchor-on-now rule; the other is
// resetPeriodOnPromotion), since no prior period exists to drift from.
async function applyInitialPayment(payment, subscription, tenant) {
  const periodStart = new Date();
  const periodEnd = addBillingPeriod(periodStart, subscription.billing_interval);

  const updated = await subscriptionModel.updateStatus(subscription.id, 'ACTIVE', {
    current_period_start: periodStart,
    current_period_end: periodEnd,
  });

  // Stamp the period onto the funding payment too — the subscription's own
  // current_period_start/end is overwritten every renewal, so without this the
  // per-cycle history would be lost.
  await paymentModel.updateStatus(payment.id, payment.status, {
    period_start: periodStart,
    period_end: periodEnd,
  });

  await tenantModel.updateTier(subscription.tenant_id, subscription.tier);
  await tenantQuotaService.setCap(subscription.tenant_id, subscription.tier);
  await tenantEventModel.create(subscription.tenant_id, 'SUBSCRIPTION_ACTIVATED', {
    subscriptionId: subscription.id,
    tier: subscription.tier,
    paymentId: payment.id,
  });

  // Self-service recovery: a tenant who went PAST_DUE (unpaid renewal grace
  // period lapsed — see expireSubscription) and started a fresh subscription
  // to pay their way back in lands here. See docs/adr/025-past-due-tenant-status.md.
  if (tenant.status === TenantStatus.PAST_DUE) {
    await tenantModel.updateStatus(subscription.tenant_id, TenantStatus.ACTIVE);
    await tenantEventModel.create(subscription.tenant_id, 'STATUS_CHANGED', {
      from: TenantStatus.PAST_DUE,
      to: TenantStatus.ACTIVE,
      reason: 'payment_recovered',
    });

    // Catch-up: a price change may have published while this tenant was
    // PAST_DUE — same pattern as admin.service.js's updateTenantStatus/
    // verifyTenant and registration.service.js's verifyEmail. Not strictly
    // required (the periodic reconciliation sweep would catch this tenant
    // within ~5 minutes regardless), but every other reactivation point
    // notifies immediately rather than relying on the sweep.
    try {
      await pricingService.notifyPendingPriceChangesForTenant(subscription.tenant_id);
    } catch (err) {
      console.error(`[subscription] Failed to notify tenant ${subscription.tenant_id} of pending price changes:`, err.message);
    }
  }

  return updated;
}

async function applyTierChangePayment(payment, subscription) {
  // A billing-interval change can't neatly prorate mid-cycle — now that it's
  // paid in full for the new interval, defer it to current_period_end (same as
  // a free downgrade) instead of applying it now. Tier-only changes keep
  // applying immediately, taking over the remainder of the current cycle.
  //
  // period_start is deliberately left unstamped here: it's what marks a
  // TIER_CHANGE payment as still-unapplied (see
  // findPendingTierChangeBySubscriptionId), and applyScheduledTierChanges
  // stamps it when the deferred change actually lands.
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

  await tenantModel.updateTier(subscription.tenant_id, payment.target_tier);
  await tenantQuotaService.setCap(subscription.tenant_id, payment.target_tier);

  // The upgrade takes over the remainder of the same billing cycle — the
  // subscription's period dates don't change, only the tier does — so stamp
  // those same dates onto the payment for per-cycle history.
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

// Extends the existing period instead of opening a first one. Anchored to the
// OLD current_period_end (never "now") so an early or late operator review
// can't drift the billing date — back-to-back periods, no gap, no overlap.
async function applyRenewalPayment(payment, subscription) {
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
    paymentId: payment.id,
  });

  return updated;
}

// Records the operator's self-billed invoice against the payment it settles.
// Pure bookkeeping since ADR-027 — it triggers no state transition at all;
// the subscription was already activated/renewed/upgraded when the payment was
// verified. Its only side effect that matters operationally is stamping
// invoiced_at, which clears the payment off the invoicing queue.
async function linkInvoice(subscriptionId, accessKey) {
  const subscription = await subscriptionModel.findById(subscriptionId);
  if (!subscription) throw new NotFoundError('Subscription', ErrorCodes.SUBSCRIPTION_NOT_FOUND);

  // No issuerId passed — this is an admin-only, cross-tenant lookup. accessKey is the
  // identifier every other document response already exposes; documents.id never is.
  // findByAccessKey searches both public and sandbox schemas (UNION ALL); the returned
  // row includes `sandbox: true/false` to indicate which schema it came from.
  const document = await documentModel.findByAccessKey(accessKey);
  if (!document) throw new NotFoundError('Document');

  const payment = await paymentModel.findOldestUninvoicedBySubscriptionId(subscriptionId);
  if (!payment) {
    throw new ConflictError(
      'This subscription has no verified payment awaiting an invoice',
      ErrorCodes.PAYMENT_NOT_FOUND
    );
  }

  // Which FK the document id lands on depends on the payment's purpose, and the
  // two are not interchangeable: subscriptions.initial_invoice_document_id is
  // write-once and records what originally activated the subscription, while
  // every later funding event writes its own payments.invoice_document_id.
  // Never repoint the former at a later invoice.
  //
  // A sandbox document gets neither: both columns are FKs into public.documents
  // and sandbox.documents is an independent id sequence that can collide with
  // it. invoiced_at is still stamped, which is what the queue reads — see
  // db/migrations/090 and CLAUDE.md Common Mistake #35.
  const paymentFields = { invoiced_at: new Date() };
  if (!document.sandbox) {
    if (payment.purpose === 'INITIAL') {
      await subscriptionModel.setInitialInvoiceDocument(subscription.id, document.id);
    } else {
      paymentFields.invoice_document_id = document.id;
    }
  }

  await paymentModel.updateStatus(payment.id, payment.status, paymentFields);

  await tenantEventModel.create(subscription.tenant_id, 'INVOICE_LINKED', {
    subscriptionId,
    paymentId: payment.id,
    documentId: document.id,
    sandbox: document.sandbox,
  });

  return subscriptionModel.findById(subscriptionId);
}

// The operator's invoicing work queue — money received, factura still owed.
// This is what replaced the invoice gate: the obligation stays visible instead
// of being enforced by withholding service from a tenant who already paid.
async function listPendingInvoices() {
  const rows = await paymentModel.findPendingInvoice();

  return {
    count: rows.length,
    items: rows.map((row) => ({
      payment: {
        id: row.id,
        purpose: row.purpose,
        method: row.method,
        amount: row.amount,
        ivaRate: row.iva_rate,
        ivaAmount: row.iva_amount,
        totalAmount: row.total_amount,
        verifiedAt: row.verified_at,
      },
      subscription: {
        id: row.subscription_id,
        // target_tier/target_billing_interval win for a TIER_CHANGE payment —
        // the subscription's own columns describe what it is now, not what
        // this payment bought. See CLAUDE.md Common Mistake #28.
        tier: row.target_tier || row.tier,
        billingInterval: row.target_billing_interval || row.billing_interval,
        currentPeriodStart: row.period_start || row.current_period_start,
        currentPeriodEnd: row.period_end || row.current_period_end,
      },
      buyer: {
        tenantId: row.tenant_id,
        email: row.tenant_email,
        businessName: row.business_name,
        ruc: row.ruc,
        address: row.main_address,
      },
    })),
  };
}

// Records that a verified payment's money went away — a reversed SPI transfer
// found on the bank statement, a duplicate charge refunded, a chargeback.
// Detection is inherently manual (no payment rail notifies us), so this is
// purely the "I found out, undo it" half.
//
// Rolling back is emphatically NOT "downgrade to FREE": a reversed TIER_CHANGE
// must return to the previous paid tier, and a reversed RENEWAL must roll the
// period back without touching tier at all. payments.applied_from is the
// snapshot that makes each case recoverable.
//
// Deliberately does not suspend the tenant — whether this warrants SUSPENDED
// (fraud) or nothing at all (an honest duplicate) is a separate operator
// judgement, made through PATCH /v1/admin/tenants/:id/status.
async function refundPayment(paymentId, reason = null) {
  const payment = await paymentModel.findById(paymentId);
  if (!payment) throw new NotFoundError('Payment', ErrorCodes.PAYMENT_NOT_FOUND);

  if (payment.status !== 'VERIFIED') {
    throw new ConflictError(
      `Only a VERIFIED payment can be refunded; this one is ${payment.status}`,
      ErrorCodes.PAYMENT_NOT_REFUNDABLE
    );
  }
  if (!payment.applied_from) {
    throw new AppError(
      'This payment was applied before rollback snapshots were recorded, so it cannot be refunded automatically. Adjust the tenant\'s tier and subscription manually.',
      400,
      ErrorCodes.PAYMENT_NOT_REFUNDABLE
    );
  }

  const subscription = await subscriptionModel.findById(payment.subscription_id);
  if (!subscription) throw new NotFoundError('Subscription', ErrorCodes.SUBSCRIPTION_NOT_FOUND);

  const snapshot = payment.applied_from;

  // applyTierChange also clears pending_tier/pending_billing_interval, which is
  // what undoes a deferred billing-interval change this payment had scheduled.
  await subscriptionModel.applyTierChange(subscription.id, snapshot.tier, snapshot.billingInterval);

  // An INITIAL payment's snapshot status is a pre-activation one
  // (PENDING_PAYMENT). Restoring it verbatim would leave the tenant with a
  // subscription that looks payable but whose only payment is REFUNDED, and
  // findActiveOrPendingByTenantId would block them from starting a new one.
  // Cancel it instead so they can subscribe again cleanly.
  const isInitial = payment.purpose === 'INITIAL';
  const updated = isInitial
    ? await subscriptionModel.updateStatus(subscription.id, 'CANCELLED', {
      canceled_at: new Date(),
      current_period_start: snapshot.periodStart,
      current_period_end: snapshot.periodEnd,
    })
    : await subscriptionModel.updateStatus(subscription.id, snapshot.subscriptionStatus, {
      current_period_start: snapshot.periodStart,
      current_period_end: snapshot.periodEnd,
    });

  await tenantModel.updateTier(subscription.tenant_id, snapshot.tenantTier);
  await tenantQuotaService.setCap(subscription.tenant_id, snapshot.tenantTier);

  const refundedPayment = await paymentModel.updateStatus(paymentId, 'REFUNDED');

  await tenantEventModel.create(subscription.tenant_id, 'PAYMENT_REFUNDED', {
    subscriptionId: subscription.id,
    paymentId,
    purpose: payment.purpose,
    reason,
    restoredTier: snapshot.tenantTier,
  });

  return { payment: refundedPayment, subscription: updated };
}

// Applies every downgrade scheduled via requestTierChange whose
// current_period_end has passed. Called by the admin job (POST
// /v1/admin/jobs/subscriptions), same pattern as
// notification-scheduler.service.js's runAll().
//
// Also rolls the period forward (anchored to the OLD current_period_end, same
// as applyVerifiedPayment's renewal path) so the subscription re-enters the renewal cycle at
// its new, lower tier instead of sitting on a current_period_end already in
// the past — a downgrade owes no payment, but it still needs a fresh period or
// processDueRenewals would immediately treat it as expired.
async function applyScheduledTierChanges() {
  const due = await subscriptionModel.findDuePendingDowngrades();

  for (const subscription of due) {
    if (subscription.pending_tier === 'FREE') {
      await subscriptionModel.applyTierChange(subscription.id, 'FREE');
      await subscriptionModel.updateStatus(subscription.id, 'CANCELLED', { canceled_at: new Date() });
      await tenantModel.updateTier(subscription.tenant_id, 'FREE');
      await tenantQuotaService.setCap(subscription.tenant_id, 'FREE');
      await tenantEventModel.create(subscription.tenant_id, 'SUBSCRIPTION_CANCELLED', {
        subscriptionId: subscription.id,
        fromTier: subscription.tier,
      });
    } else {
      // pending_billing_interval is only set for a paid interval switch (see
      // applyVerifiedPayment); a plain free tier downgrade leaves it null
      // and the period keeps the subscription's existing cadence.
      const newInterval = subscription.pending_billing_interval || subscription.billing_interval;
      const periodStart = new Date(subscription.current_period_end);
      const periodEnd = addBillingPeriod(periodStart, newInterval);

      await subscriptionModel.applyTierChange(subscription.id, subscription.pending_tier, subscription.pending_billing_interval);
      await subscriptionModel.updateStatus(subscription.id, 'ACTIVE', {
        current_period_start: periodStart,
        current_period_end: periodEnd,
      });
      await tenantModel.updateTier(subscription.tenant_id, subscription.pending_tier);
      await tenantQuotaService.setCap(subscription.tenant_id, subscription.pending_tier);

      // If this pending change was funded by a paid TIER_CHANGE payment (an
      // interval switch — free tier-only downgrades have no such payment),
      // stamp the new period onto it for per-cycle payment history, same as
      // applyVerifiedPayment does for its own funding payment.
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
// warns them partway through the grace period that they're about to go
// PAST_DUE, and downgrades to FREE (+ marks the tenant PAST_DUE) any
// subscription that ran past its grace period with no verified renewal.
// Called by the same admin job as applyScheduledTierChanges
// (POST /v1/admin/jobs/subscriptions) — that one must run first in the same
// tick so a just-rolled-forward downgrade isn't mistaken for an expired
// renewal by either the warning or expiry query below.
async function processDueRenewals() {
  const dueForReminder = await subscriptionModel.findDueForRenewalReminder(RENEWAL_REMINDER_DAYS);
  for (const subscription of dueForReminder) {
    await createRenewalReminder(subscription);
  }

  const dueForSuspensionWarning = await subscriptionModel.findDueForSuspensionWarning(SUSPENSION_WARNING_DAYS, RENEWAL_GRACE_DAYS);
  for (const subscription of dueForSuspensionWarning) {
    const suspendsAt = new Date(subscription.current_period_end);
    suspendsAt.setDate(suspendsAt.getDate() + RENEWAL_GRACE_DAYS);
    await notificationService.createSubscriptionPastDueWarning(subscription, suspendsAt);
  }

  const dueForExpiry = await subscriptionModel.findExpiredPastGrace(RENEWAL_GRACE_DAYS);
  for (const subscription of dueForExpiry) {
    await expireSubscription(subscription);
  }

  return {
    remindersSent: dueForReminder.length,
    pastDueWarningsSent: dueForSuspensionWarning.length,
    expired: dueForExpiry.length,
  };
}

async function createRenewalReminder(subscription) {
  // Resolved as of current_period_end (when the renewal's period actually
  // starts), not "now" — this is the other half of the 30-day price-change
  // protection: a renewal due before a new price's effective_at still bills
  // the old price automatically.
  const renewalPrice = await pricingService.getPriceAsOf(subscription.tier, subscription.billing_interval, subscription.current_period_end);
  const { baseAmount, ivaAmount, totalAmount } = breakdownAmount(renewalPrice);

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

  await notificationService.createSubscriptionRenewalDue(subscription, payment);
}

async function expireSubscription(subscription) {
  await tenantModel.updateTier(subscription.tenant_id, 'FREE');
  await tenantQuotaService.setCap(subscription.tenant_id, 'FREE');
  const updated = await subscriptionModel.updateStatus(subscription.id, 'EXPIRED');

  await tenantEventModel.create(subscription.tenant_id, 'SUBSCRIPTION_EXPIRED', {
    subscriptionId: subscription.id,
    previousTier: subscription.tier,
  });

  // PAST_DUE is a distinct, self-resolving billing status from SUSPENDED
  // (see docs/adr/025-past-due-tenant-status.md) — idempotent: a tenant
  // already SUSPENDED (admin-lifted, unrelated reason) or already PAST_DUE
  // (e.g. a second subscription lapsing while the first hasn't been
  // resolved yet) is left untouched rather than re-logging a no-op
  // transition.
  const tenant = await tenantModel.findById(subscription.tenant_id);
  if (tenant.status !== TenantStatus.SUSPENDED && tenant.status !== TenantStatus.PAST_DUE) {
    await tenantModel.updateStatus(subscription.tenant_id, TenantStatus.PAST_DUE);
    await tenantEventModel.create(subscription.tenant_id, 'STATUS_CHANGED', {
      from: tenant.status,
      to: TenantStatus.PAST_DUE,
      reason: 'unpaid_renewal',
    });
  }

  await notificationService.createSubscriptionExpired(updated);

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
// lookup per row. Proof files themselves never appear here — GET
// /admin/payments/:id/proofs (list) and .../proofs/:proofId (download)
// stream them separately.
async function listPendingPayments(status = 'REPORTED') {
  const payments = await paymentModel.findAllByStatus(status);
  const tenantIds = [...new Set(payments.map((p) => p.tenant_id))];
  const tenants = await Promise.all(tenantIds.map((id) => tenantModel.findById(id)));
  const tenantsById = new Map(tenants.filter(Boolean).map((t) => [t.id, t]));

  return payments.map((payment) => {
    const tenant = tenantsById.get(payment.tenant_id);
    return {
      ...payment,
      tenant: tenant ? { id: tenant.id, email: tenant.email } : null,
    };
  });
}

// Tenant-facing read: full subscription history with each one's payments nested,
// newest first. No notification exists when a review/activation happens — this
// (polled) is how a tenant finds out. Proof files themselves never appear here —
// the dedicated GET .../proofs / .../proofs/:proofId endpoints handle those.
async function getStatusForTenant(tenantId) {
  const subscriptions = await subscriptionModel.findByTenantId(tenantId);
  const withPayments = await Promise.all(
    subscriptions.map(async (subscription) => ({
      ...subscription,
      payments: await paymentModel.findBySubscriptionId(subscription.id),
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
  getPaymentProofFile,
  getPaymentProofFileForTenant,
  listPaymentProofsForTenant,
  listPaymentProofsForAdmin,
  deletePaymentProofForTenant,
  reviewPayment,
  applyVerifiedPayment,
  linkInvoice,
  listPendingInvoices,
  refundPayment,
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
// trail consistency (mirrors applyVerifiedPayment's stamping logic).
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
