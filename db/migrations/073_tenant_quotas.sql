-- Decouples document-quota usage tracking from tenants.document_count /
-- tenants.document_quota into its own tenant_quotas table, one row per
-- tenant per period, with an is_current flag mirroring agreements' per-type
-- versioning pattern (migration 059/061) — exactly one current row per
-- tenant, enforced by a partial unique index.
--
-- This is a prerequisite for a monthly reset job: quota is meant to be a
-- documents/month figure, but tenants.document_count was a lifetime counter
-- with no reset mechanism at all. The new period_start/period_end columns
-- give quota its own clock, independent of subscriptions.billing_interval
-- (a YEARLY subscriber must still get quota refreshed monthly, not yearly).

BEGIN;

CREATE TABLE tenant_quotas (
  id              BIGSERIAL     PRIMARY KEY,
  tenant_id       BIGINT        NOT NULL REFERENCES tenants(id),
  period_start    TIMESTAMPTZ   NOT NULL,
  period_end      TIMESTAMPTZ   NOT NULL,
  document_quota  INTEGER       NOT NULL,
  document_count  INTEGER       NOT NULL DEFAULT 0,
  is_current      BOOLEAN       NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Exactly one current period per tenant — the atomic quota-check UPDATE and
-- the reset job's rollover both rely on this being unique.
CREATE UNIQUE INDEX uq_tenant_quotas_current ON tenant_quotas(tenant_id) WHERE is_current = true;

-- Supports the reset job's "which current periods have ended" scan.
CREATE INDEX idx_tenant_quotas_due ON tenant_quotas(period_end) WHERE is_current = true;

CREATE TRIGGER trg_tenant_quotas_updated_at
  BEFORE UPDATE ON tenant_quotas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Backfill: one current period per existing tenant, seeded from today's
-- lifetime document_quota/document_count so no usage history is lost. This
-- is a one-time transitional wrinkle — existing tenants' first period starts
-- now with their old lifetime count carried over, rather than 0; every
-- period after this one is a true monthly window.
INSERT INTO tenant_quotas (tenant_id, period_start, period_end, document_quota, document_count, is_current)
SELECT id, NOW(), NOW() + INTERVAL '1 month', document_quota, document_count, true
FROM tenants;

ALTER TABLE tenants DROP COLUMN document_quota;
ALTER TABLE tenants DROP COLUMN document_count;

COMMIT;
