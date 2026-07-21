-- Notification preferences: per-tenant opt-out control over notification types.
--
-- Default is enabled for every type (opt-out model). If no row exists for a
-- (tenant_id, type) pair, the notification service treats it as enabled = true.
--
-- The CHECK constraint mirrors the one in notifications — both must be updated
-- when a new notification type is added.

BEGIN;

CREATE TABLE notification_preferences (
  tenant_id   UUID     NOT NULL REFERENCES tenants(id),
  type        TEXT     NOT NULL,
  enabled     BOOLEAN  NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (tenant_id, type),

  CONSTRAINT chk_notification_preferences_type CHECK (
    type IN (
      'DOCUMENT_AUTHORIZED',
      'CERT_EXPIRING',
      'CERT_EXPIRED',
      'SRI_SUBMISSION_FAILED',
      'EMAIL_DELIVERY_FAILED',
      'QUOTA_WARNING'
    )
  )
);

COMMIT;
