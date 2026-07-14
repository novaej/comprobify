-- Phase 1 of the RabbitMQ async SRI worker (NEXT_STEPS.md item 2). Adds the
-- PENDING_SEND status (a document queued for async transmission, sitting
-- between SIGNED and RECEIVED/RETURNED) and two dispatch-tracking timestamp
-- columns used by the reconciliation job to find documents whose publish to
-- RabbitMQ was never confirmed or has gone stale. Applied to both public and
-- sandbox schemas per CLAUDE.md Common Mistake #14.
--
-- enforce_document_state_transition() (migration 027) is a DB-level trigger
-- function that independently hardcodes the same transition graph as
-- src/constants/document-state-machine.js — it must be updated too, or
-- SIGNED -> PENDING_SEND updates would pass the CHECK constraint but still
-- be rejected by this trigger. It's defined once in public and reused by
-- sandbox.documents' trigger (trg_sandbox_document_state_transition calls
-- public.enforce_document_state_transition()), so one CREATE OR REPLACE
-- covers both schemas.

BEGIN;

ALTER TABLE documents DROP CONSTRAINT chk_documents_status;
ALTER TABLE documents
  ADD CONSTRAINT chk_documents_status
  CHECK (status IN ('SIGNED', 'PENDING_SEND', 'RECEIVED', 'RETURNED', 'AUTHORIZED', 'NOT_AUTHORIZED'));

ALTER TABLE documents ADD COLUMN send_dispatch_attempted_at TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN authorize_dispatch_attempted_at TIMESTAMPTZ;

ALTER TABLE sandbox.documents DROP CONSTRAINT chk_sandbox_documents_status;
ALTER TABLE sandbox.documents
  ADD CONSTRAINT chk_sandbox_documents_status
  CHECK (status IN ('SIGNED', 'PENDING_SEND', 'RECEIVED', 'RETURNED', 'AUTHORIZED', 'NOT_AUTHORIZED'));

ALTER TABLE sandbox.documents ADD COLUMN send_dispatch_attempted_at TIMESTAMPTZ;
ALTER TABLE sandbox.documents ADD COLUMN authorize_dispatch_attempted_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION enforce_document_state_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- No status change — nothing to validate
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Validate the transition against the allowed graph
  IF NOT (
    (OLD.status = 'SIGNED'         AND NEW.status = 'PENDING_SEND')                    OR
    (OLD.status = 'PENDING_SEND'   AND NEW.status IN ('RECEIVED', 'RETURNED'))         OR
    (OLD.status = 'RECEIVED'       AND NEW.status IN ('AUTHORIZED', 'NOT_AUTHORIZED')) OR
    (OLD.status = 'RETURNED'       AND NEW.status = 'SIGNED')                          OR
    (OLD.status = 'NOT_AUTHORIZED' AND NEW.status = 'SIGNED')
    -- AUTHORIZED is terminal: no outgoing transitions
  ) THEN
    RAISE EXCEPTION 'Invalid document state transition: % -> %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
