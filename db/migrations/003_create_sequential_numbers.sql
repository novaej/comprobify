CREATE TABLE IF NOT EXISTS sequential_numbers (
    id                  SERIAL PRIMARY KEY,
    issuer_id           INTEGER NOT NULL REFERENCES issuers(id),
    branch_code         VARCHAR(3) NOT NULL,
    issue_point_code    VARCHAR(3) NOT NULL,
    document_type       VARCHAR(2) NOT NULL,
    current_value       INTEGER NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(issuer_id, branch_code, issue_point_code, document_type)
);
