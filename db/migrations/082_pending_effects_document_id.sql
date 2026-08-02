-- Denormalized debug/tenant-query column, same shape and reasoning as
-- notification_type (migration 080) and dedup_key (migration 075):
-- SRI_SEND/SRI_AUTHORIZE's payload already carries { documentId, accessKey,
-- issuerId, sandbox }, but a JSONB path lookup has no supporting index —
-- fine for the rare admin-only credit-note-style lookup elsewhere in this
-- codebase, but this column backs a tenant-facing retry endpoint
-- (POST /v1/documents/:accessKey/send/retry, POST /v1/documents/retry-failed)
-- that needs "find the FAILED effect for this document" to actually be fast.
--
-- No FK to documents(id) — public.documents and sandbox.documents are
-- independent id sequences that can collide (see credit-note balance
-- lookup's own reasoning in document-query.service.js), and this table
-- isn't schema-scoped. Every query against this column also filters by
-- tenant_id, which is what actually disambiguates a same-id collision in
-- practice (a stray UUID collision AND a matching tenant_id is not a
-- realistic concern).
--
-- NULL for every effect type other than SRI_SEND/SRI_AUTHORIZE — same
-- "nullable, only the relevant effect types populate it" shape as the two
-- columns above.

BEGIN;

ALTER TABLE pending_effects ADD COLUMN document_id UUID;

CREATE INDEX idx_pending_effects_document_id ON pending_effects (document_id)
  WHERE document_id IS NOT NULL;

COMMIT;
