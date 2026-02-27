CREATE TABLE IF NOT EXISTS documents (
    id                  SERIAL PRIMARY KEY,
    issuer_id           INTEGER NOT NULL REFERENCES issuers(id),
    document_type       VARCHAR(2) NOT NULL,
    access_key          VARCHAR(49) UNIQUE NOT NULL,
    sequential          INTEGER NOT NULL,
    branch_code         VARCHAR(3) NOT NULL,
    issue_point_code    VARCHAR(3) NOT NULL,
    issue_date          DATE NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'SIGNED',
    unsigned_xml        TEXT,
    signed_xml          TEXT,
    authorization_xml   TEXT,
    authorization_number VARCHAR(49),
    authorization_date  TIMESTAMPTZ,
    buyer_id            VARCHAR(20),
    buyer_name          VARCHAR(300),
    buyer_id_type       VARCHAR(2),
    subtotal            DECIMAL(14,2),
    total               DECIMAL(14,2),
    request_payload     JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_issuer_id ON documents(issuer_id);
CREATE INDEX IF NOT EXISTS idx_documents_access_key ON documents(access_key);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_issue_date ON documents(issue_date);
