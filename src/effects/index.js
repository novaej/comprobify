// Effect handler registry for the pending_effects outbox (ADR-022). Mirrors
// the "registry keyed by a type string" idiom already used by
// src/builders/index.js for document types — getHandler(effectType) is the
// getBuilder(documentTypeCode) equivalent.
//
// Handlers re-fetch fresh rows from the DB by id rather than trusting
// payload data beyond ids/small scalars — same convention the old
// workers/sri-worker.js's resolveIssuer() used before this refactor.
//
// Required by pending-effect.service.js's process() via a LAZY require
// (inside the function body, not at module load) to avoid a circular
// require: this file -> document-transmission.service.js ->
// pending-effect.service.js -> (lazy) this file.
const documentModel = require('../models/document.model');
const documentEventModel = require('../models/document-event.model');
const issuerModel = require('../models/issuer.model');
const tenantModel = require('../models/tenant.model');
const tenantEventModel = require('../models/tenant-event.model');
const paymentModel = require('../models/payment.model');
const subscriptionModel = require('../models/subscription.model');
const notificationModel = require('../models/notification.model');
const documentTransmissionService = require('../services/document-transmission.service');
const notificationService = require('../services/notification.service');
const subscriptionService = require('../services/subscription.service');
const emailService = require('../services/email.service');
const webhookDeliveryService = require('../services/webhook-delivery.service');
const tenantAgreementService = require('../services/tenant-agreement.service');
const { EffectTypes } = require('../constants/effect-types');
const EmailStatus = require('../constants/email-status');
const EventType = require('../constants/event-type');

async function resolveIssuer(issuerId, sandbox) {
  const issuer = await issuerModel.findById(issuerId);
  if (!issuer) throw new Error(`Issuer ${issuerId} not found or inactive`);
  issuer.sandbox = sandbox;
  return issuer;
}

async function resolveDocument({ accessKey, issuerId, sandbox }) {
  const issuer = await resolveIssuer(issuerId, sandbox);
  const document = await documentModel.findByAccessKey(accessKey, issuerId, sandbox);
  if (!document) throw new Error(`Document ${accessKey} not found`);
  return { document, issuer };
}

async function resolvePaymentAndSubscription({ paymentId, subscriptionId }) {
  const payment = paymentId ? await paymentModel.findById(paymentId) : null;
  const subscription = await subscriptionModel.findById(subscriptionId);
  return { payment, subscription };
}

const handlers = {
  // --- SRI send/authorize (unchanged behavior, just re-homed onto the registry) ---

  [EffectTypes.SRI_SEND]: async (payload) => {
    const issuer = await resolveIssuer(payload.issuerId, payload.sandbox);
    await documentTransmissionService.sendToSri(payload.accessKey, issuer);
  },

  // checkAuthorization() returns { requeue: true } when SRI reports "still
  // processing" — the processor leaves the row as-is instead of marking it
  // DONE, so reconciliation re-dispatches it later. See ADR-022.
  [EffectTypes.SRI_AUTHORIZE]: async (payload) => {
    const issuer = await resolveIssuer(payload.issuerId, payload.sandbox);
    return documentTransmissionService.checkAuthorization(payload.accessKey, issuer);
  },

  // --- Post-authorization side effects ---

  [EffectTypes.DOCUMENT_AUTHORIZED_NOTIFICATION]: async (payload) => {
    const { document, issuer } = await resolveDocument(payload);
    await notificationService.createDocumentAuthorized(document, issuer);
  },

  // No SUBSCRIPTION_ACTIVATE_IF_LINKED / _APPLY_TIER_CHANGE_IF_LINKED /
  // _APPLY_RENEWAL_IF_LINKED here — see effect-types.js's comment. linkInvoice()
  // in subscription.service.js still calls activateIfLinked/
  // applyTierChangeIfLinked/applyRenewalIfLinked directly and synchronously
  // when the invoice being linked is already AUTHORIZED; the reverse ordering
  // is caught by a periodic scan in POST /v1/admin/jobs/subscriptions instead
  // of a queued effect.

  [EffectTypes.INVOICE_AUTHORIZED_EMAIL]: async (payload) => {
    const { document, issuer } = await resolveDocument(payload);
    try {
      const { sent, messageId } = await emailService.sendInvoiceAuthorized(document);
      const emailFields = sent
        ? { email_status: EmailStatus.SENT, email_sent_at: new Date(), email_message_id: messageId }
        : { email_status: EmailStatus.SKIPPED };
      await documentModel.updateStatus(document.id, document.status, emailFields, issuer.id, issuer.sandbox);
      await documentEventModel.create(
        document.id,
        sent ? EventType.EMAIL_SENT : EventType.EMAIL_SKIPPED,
        null, null, { to: document.buyer_email }, null, issuer.id, issuer.sandbox
      );
    } catch (err) {
      await documentModel.updateStatus(document.id, document.status, {
        email_status: EmailStatus.FAILED,
        email_error: err.message,
      }, issuer.id, issuer.sandbox);
      await documentEventModel.create(
        document.id, EventType.EMAIL_FAILED,
        null, null, { error: err.message }, null, issuer.id, issuer.sandbox
      );
      throw err;
    }
  },

  // --- Registration ---

  [EffectTypes.TENANT_AGREEMENT_GENERATE]: async (payload) => {
    // generateForTenant resolves the issuer itself when omitted.
    await tenantAgreementService.generateForTenant(payload.tenantId);
  },

  [EffectTypes.VERIFICATION_EMAIL_SEND]: async (payload) => {
    const { tenantId, email, verificationToken, redirectUrl, language } = payload;
    try {
      const { messageId } = await emailService.sendVerificationEmail(email, verificationToken, redirectUrl, language || 'es');
      await tenantModel.updateVerificationEmailSent(tenantId, messageId);
      await tenantEventModel.create(tenantId, 'VERIFICATION_EMAIL_SENT');
    } catch (err) {
      await tenantEventModel.create(tenantId, 'VERIFICATION_EMAIL_FAILED', { error: err.message });
      throw err;
    }
  },

  // --- Webhook fan-out ---

  [EffectTypes.WEBHOOK_FANOUT]: async (payload) => {
    const notification = await notificationModel.findById(payload.notificationId);
    if (!notification) return;
    await webhookDeliveryService.fanOut(notification);
  },

  // --- Subscription / payment lifecycle ---

  [EffectTypes.PAYMENT_REVIEWED_NOTIFICATION]: async (payload) => {
    const { payment, subscription } = await resolvePaymentAndSubscription(payload);
    await notificationService.createPaymentReviewed(payment, subscription, payload.decision);
  },

  [EffectTypes.PAYMENT_REVIEWED_EMAIL]: async (payload) => {
    const { payment, subscription } = await resolvePaymentAndSubscription(payload);
    await emailService.sendPaymentReviewed(payment, subscription, payload.decision);
  },

  [EffectTypes.PAYMENT_PROOF_SUBMITTED_EMAIL]: async (payload) => {
    const { payment, subscription } = await resolvePaymentAndSubscription(payload);
    const tenant = await tenantModel.findById(payload.tenantId);
    await emailService.sendPaymentProofSubmitted(payment, subscription, tenant, payload.referenceNumber);
  },

  [EffectTypes.SUBSCRIPTION_RENEWAL_DUE_NOTIFICATION]: async (payload) => {
    const { payment, subscription } = await resolvePaymentAndSubscription(payload);
    await notificationService.createSubscriptionRenewalDue(subscription, payment);
  },

  [EffectTypes.SUBSCRIPTION_RENEWAL_DUE_EMAIL]: async (payload) => {
    const { payment, subscription } = await resolvePaymentAndSubscription(payload);
    await emailService.sendSubscriptionRenewalDue(subscription, payment);
  },

  [EffectTypes.SUBSCRIPTION_EXPIRED_NOTIFICATION]: async (payload) => {
    const subscription = await subscriptionModel.findById(payload.subscriptionId);
    await notificationService.createSubscriptionExpired(subscription);
  },

  [EffectTypes.SUBSCRIPTION_EXPIRED_EMAIL]: async (payload) => {
    const subscription = await subscriptionModel.findById(payload.subscriptionId);
    await emailService.sendSubscriptionExpired(subscription);
  },
};

function getHandler(effectType) {
  const handler = handlers[effectType];
  if (!handler) {
    throw new Error(`No effect handler registered for type: ${effectType}`);
  }
  return handler;
}

module.exports = { getHandler };
