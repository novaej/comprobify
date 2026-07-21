-- Notifications: tenant-level alerts surfaced by the frontend.
--
-- Two notification types are produced by the API today:
--   DOCUMENT_AUTHORIZED — created inline in document-transmission.service when SRI authorizes.
--   CERT_EXPIRING / CERT_EXPIRED — upserted by POST /api/notifications/sync (frontend-driven).
--
-- Additional types (SRI_SUBMISSION_FAILED, EMAIL_DELIVERY_FAILED, QUOTA_WARNING) are reserved
-- in the CHECK constraint so they can be introduced without a schema migration.
--
-- Design notes:
--   - NOT issuer-scoped (no RLS, no search_path). Uses db.query() directly.
--   - read_at is per-tenant (API keys share the same notification state).
--   - At most one unread cert alert per issuer (the service upserts, not appends).
--   - expires_at is nullable; use it for time-bounded info banners (not used yet).

BEGIN;

CREATE TABLE notifications (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   UUID          NOT NULL REFERENCES tenants(id),
  issuer_id   UUID          REFERENCES issuers(id),
  type        TEXT          NOT NULL,
  severity    TEXT          NOT NULL DEFAULT 'INFO',
  title       TEXT          NOT NULL,
  message     TEXT          NOT NULL,
  metadata    JSONB,
  read_at     TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_notifications_type CHECK (
    type IN (
      'DOCUMENT_AUTHORIZED',
      'CERT_EXPIRING',
      'CERT_EXPIRED',
      'SRI_SUBMISSION_FAILED',
      'EMAIL_DELIVERY_FAILED',
      'QUOTA_WARNING'
    )
  ),
  CONSTRAINT chk_notifications_severity CHECK (
    severity IN ('INFO', 'WARNING', 'ERROR')
  )
);

-- Fast lookup of all notifications for a tenant (list endpoint)
CREATE INDEX idx_notifications_tenant_created ON notifications(tenant_id, created_at DESC);

-- Partial index for unread-only queries (sync + unread count)
CREATE INDEX idx_notifications_tenant_unread ON notifications(tenant_id, created_at DESC)
  WHERE read_at IS NULL;

COMMIT;
