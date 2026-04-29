ALTER TABLE tenants
  ADD COLUMN verification_email_message_id VARCHAR(255),
  ADD COLUMN verification_email_status     VARCHAR(20)
    CHECK (verification_email_status IN ('SENT', 'DELIVERED', 'FAILED', 'COMPLAINED'));

ALTER TABLE tenant_events
  DROP CONSTRAINT chk_tenant_events_event_type,
  ADD CONSTRAINT chk_tenant_events_event_type
    CHECK (event_type IN (
      'VERIFICATION_EMAIL_SENT',
      'VERIFICATION_EMAIL_FAILED',
      'VERIFICATION_EMAIL_DELIVERED',
      'VERIFICATION_EMAIL_TEMP_FAILED',
      'VERIFICATION_EMAIL_COMPLAINED',
      'EMAIL_VERIFIED'
    ));
