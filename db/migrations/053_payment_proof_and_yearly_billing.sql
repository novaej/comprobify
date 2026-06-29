-- Yearly billing, payment proof upload, per-payment period tracking, and an
-- audit event for the admin tier override. See NEXT_STEPS.md #9.

BEGIN;

ALTER TABLE subscriptions
  ADD COLUMN billing_interval VARCHAR(10) NOT NULL DEFAULT 'MONTHLY',
  ADD CONSTRAINT chk_subscriptions_billing_interval
    CHECK (billing_interval IN ('MONTHLY', 'YEARLY'));

ALTER TABLE payments
  ADD COLUMN proof_file BYTEA,
  ADD COLUMN proof_filename VARCHAR(255),
  ADD COLUMN proof_mime_type VARCHAR(100),
  ADD COLUMN period_start TIMESTAMPTZ,
  ADD COLUMN period_end TIMESTAMPTZ;

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
      'TIER_CHANGED'
    ));

COMMIT;
