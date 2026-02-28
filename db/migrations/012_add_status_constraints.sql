ALTER TABLE documents
  ADD CONSTRAINT chk_documents_status
  CHECK (status IN ('SIGNED', 'RECEIVED', 'RETURNED', 'AUTHORIZED', 'NOT_AUTHORIZED'));

ALTER TABLE document_events
  ADD CONSTRAINT chk_document_events_event_type
  CHECK (event_type IN ('CREATED', 'SENT', 'STATUS_CHANGED', 'ERROR'));
