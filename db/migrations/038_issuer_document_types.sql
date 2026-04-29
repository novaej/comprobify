CREATE TABLE issuer_document_types (
  id            BIGSERIAL PRIMARY KEY,
  issuer_id     BIGINT NOT NULL REFERENCES issuers(id),
  document_type VARCHAR(2) NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_issuer_document_type UNIQUE (issuer_id, document_type)
);

CREATE INDEX idx_issuer_document_types_issuer_id ON issuer_document_types(issuer_id);
