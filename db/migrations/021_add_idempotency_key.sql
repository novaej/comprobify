ALTER TABLE documents
  ADD COLUMN idempotency_key TEXT,
  ADD COLUMN payload_hash    TEXT;

-- Partial unique index: enforces uniqueness only on rows that carry a key.
-- Existing rows (idempotency_key IS NULL) are never checked against each other.
CREATE UNIQUE INDEX uq_documents_idempotency_key
  ON documents (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
