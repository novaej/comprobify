-- Rename subscriptions.invoice_document_id to initial_invoice_document_id.
-- The old name read as "the current/latest invoice," but this column is
-- write-once — it's set exactly once, when linkInvoice() first moves the
-- subscription from INVOICE_PROCESSING to ACTIVE, and is never touched again
-- by a later TIER_CHANGE/RENEWAL (those link to the funding payments.invoice_document_id
-- row instead — see CLAUDE.md's "Subscription + payment pipeline" entry).
-- activateIfLinked() relies on this column staying fixed to the ORIGINAL
-- activation invoice as its dispatch key; renaming it makes that contract
-- explicit instead of implicit.

BEGIN;

ALTER TABLE subscriptions RENAME COLUMN invoice_document_id TO initial_invoice_document_id;
ALTER INDEX idx_subscriptions_invoice_document_id RENAME TO idx_subscriptions_initial_invoice_document_id;
ALTER TABLE subscriptions RENAME CONSTRAINT subscriptions_invoice_document_id_fkey TO subscriptions_initial_invoice_document_id_fkey;

COMMIT;
