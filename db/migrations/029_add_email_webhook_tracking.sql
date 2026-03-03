-- 1. Store Mailgun's queued message ID
ALTER TABLE documents ADD COLUMN email_message_id TEXT;

-- 2. Add webhook-driven email statuses
ALTER TABLE documents DROP CONSTRAINT documents_email_status_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_email_status_check
  CHECK (email_status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED', 'DELIVERED', 'COMPLAINED'));

-- 3. Add webhook event types
ALTER TABLE document_events DROP CONSTRAINT chk_document_events_event_type;
ALTER TABLE document_events
  ADD CONSTRAINT chk_document_events_event_type
  CHECK (event_type IN ('CREATED','SENT','STATUS_CHANGED','ERROR','REBUILT',
                        'EMAIL_SENT','EMAIL_FAILED','EMAIL_DELIVERED',
                        'EMAIL_TEMP_FAILED','EMAIL_COMPLAINED'));
