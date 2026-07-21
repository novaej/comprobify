CREATE TABLE IF NOT EXISTS sri_responses (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    document_id     UUID NOT NULL REFERENCES documents(id),
    operation_type  VARCHAR(20) NOT NULL,
    status          VARCHAR(20),
    messages        JSONB,
    raw_response    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sri_responses_document_id ON sri_responses(document_id);
