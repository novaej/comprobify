/**
 * Stable machine-readable notification type codes.
 *
 * These values are persisted in notifications.type and returned to API clients.
 * Clients should switch on `type` to render localised UI rather than parsing
 * the human-readable `title` or `message` fields, which may change.
 *
 * Types implemented today:
 *   DOCUMENT_AUTHORIZED      — created inline when SRI authorises a document.
 *   CERT_EXPIRING            — upserted by POST /api/notifications/sync (30-day window).
 *   CERT_EXPIRED             — upserted by POST /api/notifications/sync (cert past notAfter).
 *   PAYMENT_VERIFIED         — created by subscriptionService.reviewPayment on a VERIFIED decision.
 *   PAYMENT_REJECTED         — created by subscriptionService.reviewPayment on a REJECTED decision.
 *   SUBSCRIPTION_RENEWAL_DUE — created by subscriptionService.processDueRenewals when a renewal payment is opened.
 *   SUBSCRIPTION_PAST_DUE_WARNING — created by subscriptionService.processDueRenewals partway through the
 *                              renewal grace period, before the tenant is actually marked PAST_DUE.
 *   SUBSCRIPTION_EXPIRED     — created by subscriptionService.processDueRenewals when the grace period elapses unpaid.
 *   PRICE_CHANGE_ANNOUNCED   — created by pricingService.notifyPendingPriceChangesForTenant when a published price change is inside its notice window.
 *                              "Mandatory" — see notification-catalog.js — cannot be opted out of on any channel.
 *
 * Types reserved for future use (CHECK constraint already allows them):
 *   SRI_SUBMISSION_FAILED  — SRI rejected a submission with a permanent error.
 *   EMAIL_DELIVERY_FAILED  — Mailgun reported a permanent delivery failure.
 *   QUOTA_WARNING          — tenant is approaching their document quota.
 */
const NotificationTypes = Object.freeze({
  DOCUMENT_AUTHORIZED:           'DOCUMENT_AUTHORIZED',
  CERT_EXPIRING:                 'CERT_EXPIRING',
  CERT_EXPIRED:                  'CERT_EXPIRED',
  SRI_SUBMISSION_FAILED:         'SRI_SUBMISSION_FAILED',
  EMAIL_DELIVERY_FAILED:         'EMAIL_DELIVERY_FAILED',
  QUOTA_WARNING:                 'QUOTA_WARNING',
  PAYMENT_VERIFIED:              'PAYMENT_VERIFIED',
  PAYMENT_REJECTED:              'PAYMENT_REJECTED',
  SUBSCRIPTION_RENEWAL_DUE:      'SUBSCRIPTION_RENEWAL_DUE',
  SUBSCRIPTION_PAST_DUE_WARNING: 'SUBSCRIPTION_PAST_DUE_WARNING',
  SUBSCRIPTION_EXPIRED:          'SUBSCRIPTION_EXPIRED',
  PRICE_CHANGE_ANNOUNCED:        'PRICE_CHANGE_ANNOUNCED',
});

module.exports = NotificationTypes;
