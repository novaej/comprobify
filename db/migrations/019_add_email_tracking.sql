ALTER TABLE documents
  ADD COLUMN buyer_email      TEXT,
  ADD COLUMN email_status     TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN email_sent_at    TIMESTAMPTZ,
  ADD COLUMN email_error      TEXT;

ALTER TABLE documents
  ADD CONSTRAINT documents_email_status_check
  CHECK (email_status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED'));
