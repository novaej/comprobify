-- Add STATUS_CHANGED to the tenant_events type constraint so
-- admin.service.js's updateTenantStatus() can log an audit event when a
-- tenant is suspended/reactivated — previously silent, unlike TIER_CHANGED.

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
      'SUBSCRIPTION_CANCELLATION_SCHEDULED',
      'TIER_CHANGED',
      'TIER_CHANGE_REQUESTED',
      'TIER_CHANGE_SCHEDULED',
      'RENEWAL_DUE',
      'SUBSCRIPTION_RENEWED',
      'SUBSCRIPTION_EXPIRED',
      'STATUS_CHANGED'
    ));
