-- Fix uniqueness: one row per (ruc, branch_code, issue_point_code), not per ruc
ALTER TABLE issuers DROP CONSTRAINT IF EXISTS issuers_ruc_key;
ALTER TABLE issuers ADD CONSTRAINT issuers_ruc_branch_point_key
    UNIQUE (ruc, branch_code, issue_point_code);

-- Replace file-based cert columns with PEM storage
ALTER TABLE issuers
    DROP COLUMN IF EXISTS cert_path,
    DROP COLUMN IF EXISTS cert_password_enc,
    ADD COLUMN encrypted_private_key TEXT,
    ADD COLUMN certificate_pem       TEXT,
    ADD COLUMN cert_fingerprint      VARCHAR(64),
    ADD COLUMN cert_expiry           TIMESTAMPTZ;
