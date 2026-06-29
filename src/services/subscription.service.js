const subscriptionModel = require('../models/subscription.model');
const paymentModel = require('../models/payment.model');
const documentModel = require('../models/document.model');
const tenantModel = require('../models/tenant.model');
const tenantEventModel = require('../models/tenant-event.model');
const TIERS = require('../constants/subscription-tiers');
const config = require('../config');
const AppError = require('../errors/app-error');
const ConflictError = require('../errors/conflict-error');
const NotFoundError = require('../errors/not-found-error');
const ErrorCodes = require('../constants/error-codes');

const PAID_TIERS = Object.keys(TIERS).filter((t) => t !== 'FREE');
const BILLING_INTERVALS = ['MONTHLY', 'YEARLY'];
const DECISIONS = ['VERIFIED', 'REJECTED'];

// Never echo the raw file bytes back in a JSON response — the caller just sent it
// (submitPaymentProof) or doesn't need it (reviewPayment). GET .../proof streams it.
function omitProofFile(payment) {
  if (!payment) return payment;
  const { proof_file, ...rest } = payment;
  return rest;
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

async function submitPaymentProof(paymentId, tenantId, { buffer, filename, mimeType }) {
  const payment = await paymentModel.findById(paymentId);
  if (!payment) throw new NotFoundError('Payment', ErrorCodes.PAYMENT_NOT_FOUND);

  const subscription = await subscriptionModel.findById(payment.subscription_id);
  if (!subscription || subscription.tenant_id !== tenantId) {
    throw new NotFoundError('Payment', ErrorCodes.PAYMENT_NOT_FOUND);
  }

  if (['VERIFIED', 'REJECTED'].includes(payment.status)) {
    throw new ConflictError(`Payment has already been ${payment.status.toLowerCase()} and can no longer accept new proof`);
  }

  const updated = await paymentModel.updateStatus(paymentId, 'REPORTED', {
    reported_at: new Date(),
    proof_file: buffer,
    proof_filename: filename,
    proof_mime_type: mimeType,
  });

  await tenantEventModel.create(subscription.tenant_id, 'PAYMENT_REPORTED', { paymentId });

  return omitProofFile(updated);
}

async function getPaymentProof(paymentId) {
  const payment = await paymentModel.findById(paymentId);
  if (!payment || !payment.proof_file) throw new NotFoundError('Payment proof');
  return { buffer: payment.proof_file, filename: payment.proof_filename, mimeType: payment.proof_mime_type };
}

async function reviewPayment(paymentId, decision) {
  if (!DECISIONS.includes(decision)) {
    throw new AppError(`Invalid decision '${decision}'. Valid values: ${DECISIONS.join(', ')}`, 400);
  }

  const payment = await paymentModel.findById(paymentId);
  if (!payment) throw new NotFoundError('Payment', ErrorCodes.PAYMENT_NOT_FOUND);

  const extraFields = decision === 'VERIFIED' ? { verified_at: new Date() } : {};
  const updatedPayment = await paymentModel.updateStatus(paymentId, decision, extraFields);

  const subscription = await subscriptionModel.findById(payment.subscription_id);
  if (!subscription) throw new NotFoundError('Subscription', ErrorCodes.SUBSCRIPTION_NOT_FOUND);

  let updatedSubscription = subscription;
  if (decision === 'VERIFIED') {
    updatedSubscription = await subscriptionModel.updateStatus(subscription.id, 'PAYMENT_RECEIVED');
  }

  await tenantEventModel.create(subscription.tenant_id, decision === 'VERIFIED' ? 'PAYMENT_VERIFIED' : 'PAYMENT_REJECTED', { paymentId });

  return { payment: omitProofFile(updatedPayment), subscription: updatedSubscription };
}

async function linkInvoice(subscriptionId, accessKey) {
  const subscription = await subscriptionModel.findById(subscriptionId);
  if (!subscription) throw new NotFoundError('Subscription', ErrorCodes.SUBSCRIPTION_NOT_FOUND);

  // No issuerId passed — this is an admin-only, cross-tenant lookup. accessKey is the
  // identifier every other document response already exposes; documents.id never is.
  const document = await documentModel.findByAccessKey(accessKey);
  if (!document) throw new NotFoundError('Document');

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
  const periodEnd = new Date(periodStart);
  if (subscription.billing_interval === 'YEARLY') {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }

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

module.exports = {
  createSubscription,
  submitPaymentProof,
  getPaymentProof,
  reviewPayment,
  linkInvoice,
  activateIfLinked,
  cancelSubscription,
  listByTenant,
};
