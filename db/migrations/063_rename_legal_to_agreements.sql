-- Rename legal_documents → agreements and tenant_legal_documents → tenant_agreements.
-- Also rename the associated sequences, indexes, and constraints for consistency.
-- Rename tenants.legal_accepted_at → agreement_accepted_at and
-- tenants.legal_version → agreement_version.

BEGIN;

-- Tables
ALTER TABLE legal_documents         RENAME TO agreements;
ALTER TABLE tenant_legal_documents  RENAME TO tenant_agreements;

-- Sequences (BIGSERIAL auto-names them after the original table)
ALTER SEQUENCE legal_documents_id_seq        RENAME TO agreements_id_seq;
ALTER SEQUENCE tenant_legal_documents_id_seq RENAME TO tenant_agreements_id_seq;

-- Indexes on agreements (was legal_documents)
ALTER INDEX idx_legal_documents_type_created RENAME TO idx_agreements_type_created;
ALTER INDEX idx_legal_documents_is_current   RENAME TO idx_agreements_is_current;

-- Indexes on tenant_agreements (was tenant_legal_documents)
ALTER INDEX idx_tenant_legal_documents_tenant_type RENAME TO idx_tenant_agreements_tenant_type;

-- Check constraints on agreements
ALTER TABLE agreements
  RENAME CONSTRAINT chk_legal_documents_type TO chk_agreements_type;

-- Check + unique constraints on tenant_agreements
ALTER TABLE tenant_agreements
  RENAME CONSTRAINT chk_tenant_legal_documents_type   TO chk_tenant_agreements_type;
ALTER TABLE tenant_agreements
  RENAME CONSTRAINT chk_tenant_legal_documents_status TO chk_tenant_agreements_status;
ALTER TABLE tenant_agreements
  RENAME CONSTRAINT uq_tenant_legal_documents         TO uq_tenant_agreements;

-- Tenant columns
ALTER TABLE tenants RENAME COLUMN legal_accepted_at TO agreement_accepted_at;
ALTER TABLE tenants RENAME COLUMN legal_version     TO agreement_version;

COMMIT;
