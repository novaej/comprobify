-- Tamper-evident fingerprint of exactly which published row of each legal
-- document type (TERMS/PRIVACY/DPA) was current at the moment a tenant
-- accepted — stronger audit trail than legal_version alone, since it covers
-- DPA changes too even if the version string scheme is ever applied
-- inconsistently. See legal-document.service.js's getCurrentSnapshot().

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS legal_snapshot_hash TEXT;
