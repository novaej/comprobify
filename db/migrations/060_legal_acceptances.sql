-- Append-only audit log of legal document acceptances, replacing the
-- overwrite-in-place tenants.legal_version/legal_accepted_at as the source
-- of truth. One row per document type per acceptance event (a single
-- checkbox click at registration writes three rows: TERMS, PRIVACY, DPA),
-- so re-publishing any one document independently (e.g. the DPA alone) can
-- be detected and re-accepted without touching the other two.
--
-- tenants.legal_accepted_at / legal_version remain as a cheap denormalized
-- "latest at a glance" cache (mirrors the TERMS row), but legal_acceptances
-- is the actual evidence trail.

BEGIN;

CREATE TABLE legal_acceptances (
  id            BIGSERIAL     PRIMARY KEY,
  tenant_id     INTEGER       NOT NULL REFERENCES tenants(id),
  document_type TEXT          NOT NULL,
  version       TEXT          NOT NULL,
  content_hash  TEXT          NOT NULL,
  accepted_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  ip            INET,
  user_agent    TEXT,

  CONSTRAINT chk_legal_acceptances_type CHECK (
    document_type IN ('TERMS', 'PRIVACY', 'DPA')
  )
);

CREATE INDEX idx_legal_acceptances_tenant_type_accepted
  ON legal_acceptances(tenant_id, document_type, accepted_at DESC);

ALTER TABLE tenants DROP COLUMN IF EXISTS legal_snapshot_hash;

COMMIT;
