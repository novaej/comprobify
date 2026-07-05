-- documents.email_status has supported 'SKIPPED' since migration 029, but
-- document_events.event_type never got a matching value — an intentionally
-- skipped authorization email (emailService.sendInvoiceAuthorized resolving
-- { sent: false }, e.g. no buyer_email) was logged as EMAIL_FAILED, the same
-- event type as a genuine send failure. Adds EMAIL_SKIPPED so the audit trail
-- can distinguish "nothing to send" from "tried and failed".

BEGIN;

ALTER TABLE document_events
  DROP CONSTRAINT chk_document_events_event_type,
  ADD CONSTRAINT chk_document_events_event_type
  CHECK (event_type IN ('CREATED','SENT','STATUS_CHANGED','ERROR','REBUILT',
                        'EMAIL_SENT','EMAIL_FAILED','EMAIL_DELIVERED',
                        'EMAIL_TEMP_FAILED','EMAIL_COMPLAINED','EMAIL_SKIPPED'));

COMMIT;
