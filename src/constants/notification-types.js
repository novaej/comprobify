/**
 * Stable machine-readable notification type codes.
 *
 * These values are persisted in notifications.type and returned to API clients.
 * Clients should switch on `type` to render localised UI rather than parsing
 * the human-readable `title` or `message` fields, which may change.
 *
 * Types implemented today:
 *   DOCUMENT_AUTHORIZED  — created inline when SRI authorises a document.
 *   CERT_EXPIRING        — upserted by POST /api/notifications/sync (30-day window).
 *   CERT_EXPIRED         — upserted by POST /api/notifications/sync (cert past notAfter).
 *
 * Types reserved for future use (CHECK constraint already allows them):
 *   SRI_SUBMISSION_FAILED  — SRI rejected a submission with a permanent error.
 *   EMAIL_DELIVERY_FAILED  — Mailgun reported a permanent delivery failure.
 *   QUOTA_WARNING          — tenant is approaching their document quota.
 */
const NotificationTypes = Object.freeze({
  DOCUMENT_AUTHORIZED:   'DOCUMENT_AUTHORIZED',
  CERT_EXPIRING:         'CERT_EXPIRING',
  CERT_EXPIRED:          'CERT_EXPIRED',
  SRI_SUBMISSION_FAILED: 'SRI_SUBMISSION_FAILED',
  EMAIL_DELIVERY_FAILED: 'EMAIL_DELIVERY_FAILED',
  QUOTA_WARNING:         'QUOTA_WARNING',
});

module.exports = NotificationTypes;
