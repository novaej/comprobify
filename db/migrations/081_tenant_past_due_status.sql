-- PAST_DUE tenant status (NEXT_STEPS.md item 11, docs/adr/025-past-due-tenant-status.md).
--
-- Deliberately a distinct status from SUSPENDED, not a reuse of it:
-- SUSPENDED is always admin-lifted (fraud, ToS violation, voluntary
-- closure); PAST_DUE is a purely automated, self-resolving billing state
-- assigned by subscriptionService.expireSubscription() when a renewal
-- grace period lapses, and cleared automatically (activateIfLinked) once
-- the tenant pays their way back in via a fresh subscription. No new
-- tenant_events type needed — STATUS_CHANGED (migration 070) already
-- covers both the PAST_DUE assignment and the ACTIVE recovery, same as
-- every other tenant status transition.

BEGIN;

ALTER TABLE tenants
  DROP CONSTRAINT tenants_status_check,
  ADD CONSTRAINT tenants_status_check
    CHECK (status IN ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'PAST_DUE'));

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
        'SUBSCRIPTION_PAST_DUE_WARNING',
        'SUBSCRIPTION_EXPIRED',
        'PRICE_CHANGE_ANNOUNCED'
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
        'SUBSCRIPTION_PAST_DUE_WARNING',
        'SUBSCRIPTION_EXPIRED'
      )
    );

-- notification_email_templates (migration 079) has its own independent
-- CHECK constraint on notification_type, separate from the two above —
-- easy to miss, since it's a third table carrying the same enum.
ALTER TABLE notification_email_templates
  DROP CONSTRAINT chk_notification_email_templates_type,
  ADD CONSTRAINT chk_notification_email_templates_type
    CHECK (
      notification_type IN (
        'PAYMENT_VERIFIED',
        'PAYMENT_REJECTED',
        'SUBSCRIPTION_RENEWAL_DUE',
        'SUBSCRIPTION_PAST_DUE_WARNING',
        'SUBSCRIPTION_EXPIRED',
        'PRICE_CHANGE_ANNOUNCED'
      )
    );

COMMIT;
