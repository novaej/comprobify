-- Moves payment proof storage off the payments row (one file, overwritten on
-- every upload) into its own append-only table, one row per uploaded file —
-- same pattern as document_events/tenant_events. Lets a tenant upload
-- multiple files per submission, keeps full history across resubmissions
-- (nothing lost on rejection), and supports soft-deleting an individual file
-- (active = false, never a hard delete — see CLAUDE.md rule #7).

BEGIN;

CREATE TABLE payment_proofs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  payment_id  UUID NOT NULL REFERENCES payments(id),
  file        BYTEA NOT NULL,
  filename    VARCHAR(255) NOT NULL,
  mime_type   VARCHAR(100) NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_proofs_payment_id ON payment_proofs(payment_id);

-- Backfill: today's single proof_file (if any) becomes proof #1.
INSERT INTO payment_proofs (payment_id, file, filename, mime_type, created_at)
SELECT id, proof_file, proof_filename, proof_mime_type, COALESCE(reported_at, created_at)
FROM payments
WHERE proof_file IS NOT NULL;

ALTER TABLE payments
  DROP COLUMN proof_file,
  DROP COLUMN proof_filename,
  DROP COLUMN proof_mime_type;

COMMIT;
