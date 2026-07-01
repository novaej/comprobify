-- Replaces legal_acceptances with tenant_legal_documents: a per-tenant
-- immutable snapshot of each legal document generated at registration time
-- with the client's own data substituted in (businessName, RUC, etc.).
-- Storing the rendered content (not just a hash) means a tenant can retrieve
-- exactly what they accepted with no reconstruction needed.
--
-- Status: PENDING = generated, not yet accepted; ACCEPTED = accepted.
-- Promotion from sandbox → production is gated on all three types being ACCEPTED.
--
-- template_version references the legal_documents.version used to generate
-- this instance, so the audit trail links back to the exact source template.

BEGIN;

DROP TABLE IF EXISTS legal_acceptances;

CREATE TABLE tenant_legal_documents (
  id               BIGSERIAL     PRIMARY KEY,
  tenant_id        INTEGER       NOT NULL REFERENCES tenants(id),
  document_type    TEXT          NOT NULL,
  template_version TEXT          NOT NULL,
  content_markdown TEXT          NOT NULL,
  content_hash     TEXT          NOT NULL,
  status           TEXT          NOT NULL DEFAULT 'PENDING',
  generated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  accepted_at      TIMESTAMPTZ,
  ip               INET,
  user_agent       TEXT,

  CONSTRAINT chk_tenant_legal_documents_type CHECK (
    document_type IN ('TERMS', 'PRIVACY', 'DPA')
  ),
  CONSTRAINT chk_tenant_legal_documents_status CHECK (
    status IN ('PENDING', 'ACCEPTED')
  ),
  CONSTRAINT uq_tenant_legal_documents UNIQUE (tenant_id, document_type, template_version)
);

CREATE INDEX idx_tenant_legal_documents_tenant_type
  ON tenant_legal_documents(tenant_id, document_type, generated_at DESC);

COMMIT;
