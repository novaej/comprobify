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
const notificationPreferenceModel = require('../models/notification-preference.model');
const documentTransmissionService = require('../services/document-transmission.service');
const emailService = require('../services/email.service');
const notificationEmailTemplateService = require('../services/notification-email-template.service');
const webhookDeliveryService = require('../services/webhook-delivery.service');
const tenantAgreementService = require('../services/tenant-agreement.service');
const { EffectTypes } = require('../constants/effect-types');
const EmailStatus = require('../constants/email-status');
const EventType = require('../constants/event-type');
const NotificationChannel = require('../constants/notification-channel');

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

  // No DOCUMENT_AUTHORIZED_NOTIFICATION here — that notification is created
  // synchronously by document-transmission.service.js's checkAuthorization
  // now (ADR-024). INVOICE_AUTHORIZED_EMAIL below is unrelated to it — it
  // emails the document's BUYER, not a tenant notification channel.

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

  // --- Payment proof (operator-facing, not a tenant notification channel) ---

  [EffectTypes.PAYMENT_PROOF_SUBMITTED_EMAIL]: async (payload) => {
    const { payment, subscription } = await resolvePaymentAndSubscription(payload);
    const tenant = await tenantModel.findById(payload.tenantId);
    await emailService.sendPaymentProofSubmitted(payment, subscription, tenant, payload.referenceNumber);
  },

  // --- NOTIFICATION_DISPATCH (ADR-024, NEXT_STEPS.md item 13) ---
  //
  // The one channel-neutral effect handling whatever async dispatch a
  // notification still needs, for every type notificationService's
  // dispatchNotification() enqueues it for. Today that's always EMAIL — the
  // in-app row already exists (created synchronously before this was
  // enqueued), and webhook fan-out is its own separate effect.
  //
  // Rendering (which template, which language, which values pulled from
  // notification.metadata) is entirely notificationEmailTemplateService's
  // job (Phase C, DB-backed versioned templates — see docs/email-templates/
  // *.txt) — this handler only gates on the tenant's EMAIL preference,
  // resolves the tenant for its .email/.preferred_language, and dispatches.
  [EffectTypes.NOTIFICATION_DISPATCH]: async (payload) => {
    const notification = await notificationModel.findById(payload.notificationId);
    if (!notification) return;

    const enabled = await notificationPreferenceModel.isEnabled(notification.tenant_id, notification.type, NotificationChannel.EMAIL);
    if (!enabled) {
      await notificationModel.updateEmailStatus(notification.id, EmailStatus.SKIPPED);
      return;
    }

    try {
      const tenant = await tenantModel.findById(notification.tenant_id);
      const language = tenant.preferred_language || 'es';
      const rendered = await notificationEmailTemplateService.render(notification.type, language, notification);
      await emailService.sendNotificationEmail(tenant, rendered);
      await notificationModel.updateEmailStatus(notification.id, EmailStatus.SENT);
    } catch (err) {
      await notificationModel.updateEmailStatus(notification.id, EmailStatus.FAILED);
      throw err;
    }
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
