-- Audit trail for account recovery (POST /v1/recover on a genuine certificate match).
-- Recovery revokes every key in the tenant's current environment and demotes the
-- tenant to PENDING_VERIFICATION, yet left no tenant event of its own — the only
-- trace was a verification email that looks routine. ACCOUNT_RECOVERED gives
-- operators (and GET /v1/tenants/events) a durable record.
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
      'SEAT_COUNT_CHANGED',
      'ACCOUNT_RECOVERED'
    ));
