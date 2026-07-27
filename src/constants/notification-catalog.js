/**
 * Per-type notification capability catalog (ADR-024).
 *
 * A separate file from notification-types.js on purpose — dozens of call
 * sites do `NotificationTypes.PAYMENT_VERIFIED` directly (the plain string
 * enum), and wrapping that module's export to attach a catalog would break
 * every one of them. This requires notification-types.js for keys only.
 *
 * supportsInApp / supportsEmail: whether that channel is even a concept for
 * this type — gates what GET/PATCH /v1/notifications/preferences will
 * accept, and what notificationService.dispatchNotification() will attempt.
 *
 * mandatory: true means the type can never be individually subscribed to on
 * any channel — no notification_preferences row is ever created or accepted
 * for it, and it's always sent on every channel it supports. Currently only
 * PRICE_CHANGE_ANNOUNCED (a tenant cannot legally opt out of the 30-day
 * price-change notice).
 *
 * DOCUMENT_AUTHORIZED has supportsEmail: false deliberately — its email
 * counterpart, INVOICE_AUTHORIZED_EMAIL, goes to the document's BUYER, not
 * the tenant. It's the core invoice-delivery feature, not a tenant
 * notification channel, and stays completely outside this system (a tenant
 * muting their own DOCUMENT_AUTHORIZED alerts must never stop their
 * customer's invoice email). Same reasoning is why PAYMENT_PROOF_SUBMITTED_EMAIL
 * (operator-facing) and VERIFICATION_EMAIL_SEND (account lifecycle) have no
 * catalog entry at all — neither is a NotificationTypes value.
 *
 * CERT_EXPIRING/CERT_EXPIRED have supportsEmail: false — no email template
 * exists for cert expiry today, only in-app.
 *
 * Reserved types (SRI_SUBMISSION_FAILED, EMAIL_DELIVERY_FAILED,
 * QUOTA_WARNING) get placeholder values — real capabilities should be set
 * when each is actually implemented.
 */
const NotificationTypes = require('./notification-types');

const NOTIFICATION_CATALOG = Object.freeze({
  [NotificationTypes.DOCUMENT_AUTHORIZED]:      Object.freeze({ supportsInApp: true, supportsEmail: false, mandatory: false }),
  [NotificationTypes.CERT_EXPIRING]:            Object.freeze({ supportsInApp: true, supportsEmail: false, mandatory: false }),
  [NotificationTypes.CERT_EXPIRED]:             Object.freeze({ supportsInApp: true, supportsEmail: false, mandatory: false }),
  [NotificationTypes.SRI_SUBMISSION_FAILED]:    Object.freeze({ supportsInApp: true, supportsEmail: false, mandatory: false }), // reserved, not yet implemented
  [NotificationTypes.EMAIL_DELIVERY_FAILED]:    Object.freeze({ supportsInApp: true, supportsEmail: false, mandatory: false }), // reserved, not yet implemented
  [NotificationTypes.QUOTA_WARNING]:            Object.freeze({ supportsInApp: true, supportsEmail: false, mandatory: false }), // reserved, not yet implemented
  [NotificationTypes.PAYMENT_VERIFIED]:         Object.freeze({ supportsInApp: true, supportsEmail: true,  mandatory: false }),
  [NotificationTypes.PAYMENT_REJECTED]:         Object.freeze({ supportsInApp: true, supportsEmail: true,  mandatory: false }),
  [NotificationTypes.SUBSCRIPTION_RENEWAL_DUE]:      Object.freeze({ supportsInApp: true, supportsEmail: true,  mandatory: false }),
  [NotificationTypes.SUBSCRIPTION_PAST_DUE_WARNING]: Object.freeze({ supportsInApp: true, supportsEmail: true,  mandatory: false }),
  [NotificationTypes.SUBSCRIPTION_EXPIRED]:          Object.freeze({ supportsInApp: true, supportsEmail: true,  mandatory: false }),
  [NotificationTypes.PRICE_CHANGE_ANNOUNCED]:   Object.freeze({ supportsInApp: true, supportsEmail: true,  mandatory: true  }),
});

function isMandatory(type) {
  return !!NOTIFICATION_CATALOG[type]?.mandatory;
}

function supportsChannel(type, channel) {
  const entry = NOTIFICATION_CATALOG[type];
  if (!entry) return false;
  return channel === 'EMAIL' ? entry.supportsEmail : entry.supportsInApp;
}

module.exports = { NOTIFICATION_CATALOG, isMandatory, supportsChannel };
