-- Recurring billing-cycle renewals, plus notifications/emails for payment
-- review decisions and renewal lifecycle events. See CLAUDE.md's
-- "Subscription + payment pipeline" entry and ADR-017's 2026-06-29 addendum.
--
-- subscriptions.status already allows 'EXPIRED' (migration 052) — a subscription
-- that runs past its renewal grace period without a verified renewal payment
-- moves there and the tenant is downgraded to FREE.

BEGIN;

ALTER TABLE payments
  DROP CONSTRAINT chk_payments_purpose,
  ADD CONSTRAINT chk_payments_purpose
    CHECK (purpose IN ('INITIAL', 'TIER_CHANGE', 'RENEWAL'));

ALTER TABLE tenant_events
  DROP CONSTRAINT chk_tenant_events_event_type,
  ADD CONSTRAINT chk_tenant_events_event_type
    CHECK (event_type IN (
      'VERIFICATION_EMAIL_SENT',
      'VERIFICATION_EMAIL_FAILED',
      'VERIFICATION_EMAIL_DELIVERED',
      'VERIFICATION_EMAIL_TEMP_FAILED',
      'VERIFICATION_EMAIL_COMPLAINED',
      'EMAIL_VERIFIED',
      'SUBSCRIPTION_CREATED',
      'PAYMENT_REPORTED',
      'PAYMENT_VERIFIED',
      'PAYMENT_REJECTED',
      'INVOICE_LINKED',
      'SUBSCRIPTION_ACTIVATED',
      'SUBSCRIPTION_CANCELLED',
      'TIER_CHANGED',
      'TIER_CHANGE_REQUESTED',
      'TIER_CHANGE_SCHEDULED',
      'RENEWAL_DUE',
      'SUBSCRIPTION_RENEWED',
      'SUBSCRIPTION_EXPIRED'
    ));

ALTER TABLE notifications
  DROP CONSTRAINT chk_notifications_type,
  ADD CONSTRAINT chk_notifications_type
    CHECK (
      type IN (
        'DOCUMENT_AUTHORIZED',
        'CERT_EXPIRING',
        'CERT_EXPIRED',
        'SRI_SUBMISSION_FAILED',
        'EMAIL_DELIVERY_FAILED',
        'QUOTA_WARNING',
        'PAYMENT_VERIFIED',
        'PAYMENT_REJECTED',
        'SUBSCRIPTION_RENEWAL_DUE',
        'SUBSCRIPTION_EXPIRED'
      )
    );

ALTER TABLE notification_preferences
  DROP CONSTRAINT chk_notification_preferences_type,
  ADD CONSTRAINT chk_notification_preferences_type
    CHECK (
      type IN (
        'DOCUMENT_AUTHORIZED',
        'CERT_EXPIRING',
        'CERT_EXPIRED',
        'SRI_SUBMISSION_FAILED',
        'EMAIL_DELIVERY_FAILED',
        'QUOTA_WARNING',
        'PAYMENT_VERIFIED',
        'PAYMENT_REJECTED',
        'SUBSCRIPTION_RENEWAL_DUE',
        'SUBSCRIPTION_EXPIRED'
      )
    );

COMMIT;
