ALTER TABLE document_events
  DROP CONSTRAINT chk_document_events_event_type;

ALTER TABLE document_events
  ADD CONSTRAINT chk_document_events_event_type
  CHECK (event_type IN ('CREATED', 'SENT', 'STATUS_CHANGED', 'ERROR', 'RESIGNED'));
