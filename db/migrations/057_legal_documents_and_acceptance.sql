-- Legal documents: admin-published Terms of Service, Privacy Policy, and DPA
-- content, stored as bytes (same pattern as issuers.logo) so any frontend or
-- third-party integrator can fetch and display them without hosting a copy.
--
-- "Current" version per type = the newest row for that document_type — no
-- separate is_current flag to keep in sync.
--
-- tenants.legal_accepted_at / legal_version: captured once at registration
-- (atomic with tenant creation, never a separate step) and compared against
-- the current published version to decide whether to prompt re-acceptance.

BEGIN;

CREATE TABLE legal_documents (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  document_type TEXT          NOT NULL,
  version       TEXT          NOT NULL,
  content       BYTEA         NOT NULL,
  content_type  TEXT          NOT NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_legal_documents_type CHECK (
    document_type IN ('TERMS', 'PRIVACY', 'DPA')
  )
);

CREATE INDEX idx_legal_documents_type_created ON legal_documents(document_type, created_at DESC);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS legal_accepted_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS legal_version TEXT;

COMMIT;
