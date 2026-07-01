-- Add explicit is_current flag to legal_documents so "current version" is a
-- deliberate admin action rather than implicit "newest by created_at". A
-- unique partial index enforces at most one current row per document_type.
-- Rollback is now possible: flip is_current on any previous row via the
-- admin activate endpoint without needing to republish.

BEGIN;

ALTER TABLE legal_documents ADD COLUMN is_current BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX idx_legal_documents_is_current
  ON legal_documents(document_type)
  WHERE is_current = true;

-- Seed: mark the newest existing row per type as current so already-published
-- documents keep working after the migration runs.
UPDATE legal_documents ld
SET is_current = true
WHERE ld.id IN (
  SELECT DISTINCT ON (document_type) id
  FROM legal_documents
  ORDER BY document_type, created_at DESC
);

COMMIT;
