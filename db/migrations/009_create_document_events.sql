CREATE TABLE document_events (
  id            SERIAL PRIMARY KEY,
  document_id   INTEGER NOT NULL REFERENCES documents(id),
  event_type    VARCHAR(30) NOT NULL,
  from_status   VARCHAR(20),
  to_status     VARCHAR(20),
  detail        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_document_events_document_id ON document_events(document_id);
