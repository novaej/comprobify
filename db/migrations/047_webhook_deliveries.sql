-- Webhook deliveries: per-notification, per-endpoint delivery audit trail.
--
-- Lifecycle:
--   PENDING  — row created; immediate delivery attempt not yet started.
--   SUCCESS  — consumer returned a 2xx response.
--   RETRYING — last attempt failed; next_retry_at holds the scheduled retry time.
--   FAILED   — exhausted all retry attempts (max 3 total: immediate + 30 s + 2 min).
--
-- The notification-scheduler service (POST /api/admin/jobs/notifications) processes
-- RETRYING rows where next_retry_at <= NOW(). Immediate first-attempt delivery is
-- handled inline (fire-and-forget) when the notification is created, which updates
-- the row to SUCCESS or RETRYING immediately.

BEGIN;

CREATE TABLE webhook_deliveries (
  id               UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  notification_id  UUID         NOT NULL REFERENCES notifications(id),
  webhook_id       UUID         NOT NULL REFERENCES webhook_endpoints(id),
  tenant_id        UUID         NOT NULL REFERENCES tenants(id),
  status           TEXT         NOT NULL DEFAULT 'PENDING',
  attempt_count    INTEGER      NOT NULL DEFAULT 0,
  next_retry_at    TIMESTAMPTZ,
  last_response    JSONB,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_webhook_deliveries_status CHECK (
    status IN ('PENDING', 'SUCCESS', 'RETRYING', 'FAILED')
  )
);

-- Admin job: find all retryable deliveries past their scheduled time.
CREATE INDEX idx_webhook_deliveries_retrying ON webhook_deliveries(next_retry_at)
  WHERE status = 'RETRYING';

-- Notification detail page: list deliveries for a notification.
CREATE INDEX idx_webhook_deliveries_notification ON webhook_deliveries(notification_id);

-- Tenant webhook history.
CREATE INDEX idx_webhook_deliveries_tenant ON webhook_deliveries(tenant_id, created_at DESC);

COMMIT;
