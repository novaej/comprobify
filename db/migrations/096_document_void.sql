-- Adds a manual void flow: SRI has no SOAP service to cancel an already-
-- AUTHORIZED document, so cancellation happens on SRI's own portal and the
-- tenant then voids the local record to keep it in sync. VOIDED is a second
-- terminal state alongside AUTHORIZED, reachable only from AUTHORIZED.
--
-- enforce_document_state_transition() (migration 027, updated by 074) hardcodes
-- the same transition graph independently of the JS state machine — it must be
-- updated too, per CLAUDE.md Common Mistake #39.

BEGIN;

ALTER TABLE documents DROP CONSTRAINT chk_documents_status;
ALTER TABLE documents
  ADD CONSTRAINT chk_documents_status
  CHECK (status IN ('SIGNED', 'PENDING_SEND', 'RECEIVED', 'RETURNED', 'AUTHORIZED', 'NOT_AUTHORIZED', 'VOIDED'));
ALTER TABLE documents ADD COLUMN void_reason TEXT;
ALTER TABLE documents ADD COLUMN voided_at TIMESTAMPTZ;

ALTER TABLE sandbox.documents DROP CONSTRAINT chk_sandbox_documents_status;
ALTER TABLE sandbox.documents
  ADD CONSTRAINT chk_sandbox_documents_status
  CHECK (status IN ('SIGNED', 'PENDING_SEND', 'RECEIVED', 'RETURNED', 'AUTHORIZED', 'NOT_AUTHORIZED', 'VOIDED'));
ALTER TABLE sandbox.documents ADD COLUMN void_reason TEXT;
ALTER TABLE sandbox.documents ADD COLUMN voided_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION enforce_document_state_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'SIGNED'         AND NEW.status = 'PENDING_SEND')                    OR
    (OLD.status = 'PENDING_SEND'   AND NEW.status IN ('RECEIVED', 'RETURNED'))         OR
    (OLD.status = 'RECEIVED'       AND NEW.status IN ('AUTHORIZED', 'NOT_AUTHORIZED')) OR
    (OLD.status = 'RETURNED'       AND NEW.status = 'SIGNED')                          OR
    (OLD.status = 'NOT_AUTHORIZED' AND NEW.status = 'SIGNED')                          OR
    (OLD.status = 'AUTHORIZED'     AND NEW.status = 'VOIDED')
    -- VOIDED is terminal: no outgoing transitions
  ) THEN
    RAISE EXCEPTION 'Invalid document state transition: % -> %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE document_events DROP CONSTRAINT chk_document_events_event_type;
ALTER TABLE document_events
  ADD CONSTRAINT chk_document_events_event_type
  CHECK (event_type IN ('CREATED','SENT','STATUS_CHANGED','ERROR','REBUILT',
                        'EMAIL_SENT','EMAIL_FAILED','EMAIL_DELIVERED',
                        'EMAIL_TEMP_FAILED','EMAIL_COMPLAINED','EMAIL_SKIPPED',
                        'VOIDED'));

ALTER TABLE sandbox.document_events DROP CONSTRAINT chk_sandbox_document_events_event_type;
ALTER TABLE sandbox.document_events
  ADD CONSTRAINT chk_sandbox_document_events_event_type
  CHECK (event_type IN ('CREATED','SENT','STATUS_CHANGED','ERROR','REBUILT',
                        'EMAIL_SENT','EMAIL_FAILED','EMAIL_DELIVERED',
                        'EMAIL_TEMP_FAILED','EMAIL_COMPLAINED','EMAIL_SKIPPED',
                        'VOIDED'));

-- Any key that already holds every scope that existed before this migration
-- was granted "everything" (mirrors the 084/085 backfill precedent) — extend
-- that same intent to the new scope. A key that was deliberately narrower is
-- untouched.
UPDATE api_keys
SET scopes = array_append(scopes, 'documents:void')
WHERE scopes @> ARRAY[
    'documents:write', 'documents:read',
    'issuers:read', 'issuers:write',
    'keys:manage', 'billing:manage', 'webhooks:manage', 'tenant:manage', 'tenant:promote'
  ]::TEXT[]
  AND NOT ('documents:void' = ANY(scopes));

ALTER TABLE api_keys DROP CONSTRAINT chk_api_keys_scopes;
ALTER TABLE api_keys ADD CONSTRAINT chk_api_keys_scopes
  CHECK (scopes <@ ARRAY[
    'documents:write', 'documents:read', 'documents:void',
    'issuers:read', 'issuers:write',
    'keys:manage', 'billing:manage', 'webhooks:manage', 'tenant:manage', 'tenant:promote'
  ]::TEXT[]);

COMMIT;
