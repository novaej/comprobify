/**
 * Notification severity levels, ordered from least to most urgent.
 *
 *   INFO    — informational; no action required (e.g. DOCUMENT_AUTHORIZED).
 *   WARNING — action recommended before a deadline (e.g. CERT_EXPIRING with > 7 days left).
 *   ERROR   — action required immediately (e.g. CERT_EXPIRING with ≤ 7 days, CERT_EXPIRED).
 */
const NotificationSeverity = Object.freeze({
  INFO:    'INFO',
  WARNING: 'WARNING',
  ERROR:   'ERROR',
});

module.exports = NotificationSeverity;
