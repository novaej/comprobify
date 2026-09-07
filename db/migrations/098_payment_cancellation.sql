-- Lets a tenant cancel their own payment while it's still PENDING (never
-- submitted proof) — e.g. picked the wrong tier or seat count and doesn't
-- want to pay for it. Distinct from REJECTED (an operator reviewed
-- submitted proof and found it wanting) and REFUNDED (money already moved
-- and is being reversed) — CANCELLED means the tenant themselves backed out
-- before ever transferring anything.
ALTER TABLE payments ADD COLUMN cancelled_at TIMESTAMPTZ;

ALTER TABLE payments
  DROP CONSTRAINT chk_payments_status,
  ADD CONSTRAINT chk_payments_status
    CHECK (status IN ('PENDING', 'REPORTED', 'VERIFIED', 'REJECTED', 'REFUNDED', 'CANCELLED'));

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
      'PAYMENT_REFUNDED',
      'PAYMENT_CANCELLED',
      'INVOICE_LINKED',
      'SUBSCRIPTION_ACTIVATED',
      'SUBSCRIPTION_CANCELLED',
      'SUBSCRIPTION_CANCELLATION_SCHEDULED',
      'TIER_CHANGED',
      'TIER_CHANGE_REQUESTED',
      'TIER_CHANGE_SCHEDULED',
      'RENEWAL_DUE',
      'SUBSCRIPTION_RENEWED',
      'SUBSCRIPTION_EXPIRED',
      'STATUS_CHANGED',
      'CERTIFICATE_UPLOADED',
      'CERTIFICATE_RENEWED',
      'SEAT_CHANGE_REQUESTED',
      'SEAT_CHANGE_SCHEDULED',
      'SEAT_COUNT_CHANGED'
    ));
