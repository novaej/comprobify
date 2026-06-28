const subscriptionModel = require('../models/subscription.model');
const paymentModel = require('../models/payment.model');
const documentModel = require('../models/document.model');
const tenantModel = require('../models/tenant.model');
const tenantEventModel = require('../models/tenant-event.model');
const TIERS = require('../constants/subscription-tiers');
const AppError = require('../errors/app-error');
const ConflictError = require('../errors/conflict-error');
const NotFoundError = require('../errors/not-found-error');
const ErrorCodes = require('../constants/error-codes');

const PAID_TIERS = Object.keys(TIERS).filter((t) => t !== 'FREE');

async function createSubscription(tenantId, tier) {
  if (!PAID_TIERS.includes(tier)) {
    throw new AppError(
      `Invalid tier '${tier}'. Valid paid tiers: ${PAID_TIERS.join(', ')}`,
      400,
      ErrorCodes.INVALID_TIER
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

  const subscription = await subscriptionModel.create({ tenantId: tenant.id, tier });
  const payment = await paymentModel.create({
    subscriptionId: subscription.id,
    amount: TIERS[tier].priceMonthlyUsd,
  });

  await tenantEventModel.create(tenant.id, 'SUBSCRIPTION_CREATED', { subscriptionId: subscription.id, tier });

  return { subscription, payment };
}

async function reportPayment(paymentId) {
  const payment = await paymentModel.findById(paymentId);
  if (!payment) throw new NotFoundError('Payment', ErrorCodes.PAYMENT_NOT_FOUND);

  const updated = await paymentModel.updateStatus(paymentId, 'REPORTED', { reported_at: new Date() });

  const subscription = await subscriptionModel.findById(payment.subscription_id);
  if (subscription) {
    await tenantEventModel.create(subscription.tenant_id, 'PAYMENT_REPORTED', { paymentId });
  }

  return updated;
}

async function verifyPayment(paymentId) {
  const payment = await paymentModel.findById(paymentId);
  if (!payment) throw new NotFoundError('Payment', ErrorCodes.PAYMENT_NOT_FOUND);

  const updatedPayment = await paymentModel.updateStatus(paymentId, 'VERIFIED', { verified_at: new Date() });

  const subscription = await subscriptionModel.findById(payment.subscription_id);
  if (!subscription) throw new NotFoundError('Subscription', ErrorCodes.SUBSCRIPTION_NOT_FOUND);

  const updatedSubscription = await subscriptionModel.updateStatus(subscription.id, 'PAYMENT_RECEIVED');
  await tenantEventModel.create(subscription.tenant_id, 'PAYMENT_VERIFIED', { paymentId });

  return { payment: updatedPayment, subscription: updatedSubscription };
}

async function rejectPayment(paymentId) {
  const payment = await paymentModel.findById(paymentId);
  if (!payment) throw new NotFoundError('Payment', ErrorCodes.PAYMENT_NOT_FOUND);

  const updated = await paymentModel.updateStatus(paymentId, 'REJECTED');

  const subscription = await subscriptionModel.findById(payment.subscription_id);
  if (subscription) {
    await tenantEventModel.create(subscription.tenant_id, 'PAYMENT_REJECTED', { paymentId });
  }

  return updated;
}

async function linkInvoice(subscriptionId, accessKey) {
  const subscription = await subscriptionModel.findById(subscriptionId);
  if (!subscription) throw new NotFoundError('Subscription', ErrorCodes.SUBSCRIPTION_NOT_FOUND);

  // No issuerId passed — this is an admin-only, cross-tenant lookup. accessKey is the
  // identifier every other document response already exposes; documents.id never is.
  const document = await documentModel.findByAccessKey(accessKey);
  if (!document) throw new NotFoundError('Document');

  const updated = await subscriptionModel.updateStatus(subscriptionId, 'INVOICE_PROCESSING', {
    invoice_document_id: document.id,
  });

  await tenantEventModel.create(subscription.tenant_id, 'INVOICE_LINKED', { subscriptionId, documentId: document.id });

  return updated;
}

async function activateIfLinked(documentId) {
  const subscription = await subscriptionModel.findByInvoiceDocumentId(documentId);
  if (!subscription || subscription.status !== 'INVOICE_PROCESSING') {
    return null;
  }

  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const updated = await subscriptionModel.updateStatus(subscription.id, 'ACTIVE', {
    current_period_start: periodStart,
    current_period_end: periodEnd,
  });

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
  reportPayment,
  verifyPayment,
  rejectPayment,
  linkInvoice,
  activateIfLinked,
  cancelSubscription,
  listByTenant,
};
