BEGIN;

-- Create the sandbox schema to hold test documents, events, and sequential counters.
--
-- Sandbox and production data live in separate PostgreSQL schemas so that:
--   * Sequential number sequences are completely independent.
--   * Test data can be truncated without touching public (production) records.
--   * Production reporting queries on public never surface test invoices, even if
--     a WHERE filter is accidentally omitted.
--
-- The application sets search_path to 'sandbox, public' for sandbox issuers and
-- 'public' for production issuers. Unqualified table names resolve to the correct
-- schema transparently. Tables that only exist in public (issuers, api_keys) are
-- still resolved correctly because public is always in the path.
--
-- NOTE: All future migrations that alter tenant-scoped tables (documents,
-- document_line_items, document_events, sequential_numbers, sri_responses) MUST
-- apply the same DDL changes to both public and sandbox schemas.

CREATE SCHEMA sandbox;

-- ─── sequential_numbers ──────────────────────────────────────────────────────

CREATE TABLE sandbox.sequential_numbers (
  id               BIGSERIAL PRIMARY KEY,
  issuer_id        BIGINT NOT NULL REFERENCES public.issuers(id),
  branch_code      VARCHAR(3) NOT NULL,
  issue_point_code VARCHAR(3) NOT NULL,
  document_type    VARCHAR(2) NOT NULL,
  current_value    INTEGER NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (issuer_id, branch_code, issue_point_code, document_type)
);

-- ─── documents ───────────────────────────────────────────────────────────────

CREATE TABLE sandbox.documents (
  id                  BIGSERIAL PRIMARY KEY,
  issuer_id           BIGINT NOT NULL REFERENCES public.issuers(id),
  document_type       VARCHAR(2) NOT NULL,
  access_key          VARCHAR(49) UNIQUE NOT NULL,
  sequential          INTEGER NOT NULL,
  branch_code         VARCHAR(3) NOT NULL,
  issue_point_code    VARCHAR(3) NOT NULL,
  issue_date          DATE NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'SIGNED',
  unsigned_xml        TEXT,
  signed_xml          TEXT,
  authorization_xml   TEXT,
  authorization_number VARCHAR(49),
  authorization_date  TIMESTAMPTZ,
  buyer_id            VARCHAR(20),
  buyer_name          VARCHAR(300),
  buyer_id_type       VARCHAR(2),
  subtotal            DECIMAL(14,2),
  total               DECIMAL(14,2),
  request_payload     JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  buyer_email         TEXT,
  email_status        TEXT NOT NULL DEFAULT 'PENDING',
  email_sent_at       TIMESTAMPTZ,
  email_error         TEXT,
  idempotency_key     TEXT,
  payload_hash        TEXT,
  email_message_id    TEXT,
  CONSTRAINT chk_sandbox_documents_status
    CHECK (status IN ('SIGNED', 'RECEIVED', 'RETURNED', 'AUTHORIZED', 'NOT_AUTHORIZED')),
  CONSTRAINT sandbox_documents_email_status_check
    CHECK (email_status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED', 'DELIVERED', 'COMPLAINED'))
);

CREATE INDEX idx_sandbox_documents_issuer_id  ON sandbox.documents(issuer_id);
CREATE INDEX idx_sandbox_documents_access_key ON sandbox.documents(access_key);
CREATE INDEX idx_sandbox_documents_status     ON sandbox.documents(status);
CREATE INDEX idx_sandbox_documents_issue_date ON sandbox.documents(issue_date);
CREATE INDEX idx_sandbox_documents_buyer_id   ON sandbox.documents(buyer_id);

CREATE UNIQUE INDEX uq_sandbox_documents_idempotency_key
  ON sandbox.documents (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Reuse immutability and state-transition trigger functions from public schema.
CREATE TRIGGER trg_sandbox_document_immutability
  BEFORE UPDATE ON sandbox.documents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_document_immutability();

CREATE TRIGGER trg_sandbox_document_state_transition
  BEFORE UPDATE ON sandbox.documents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_document_state_transition();

-- ─── document_line_items ─────────────────────────────────────────────────────

CREATE TABLE sandbox.document_line_items (
  id           BIGSERIAL PRIMARY KEY,
  document_id  BIGINT NOT NULL REFERENCES sandbox.documents(id),
  main_code    VARCHAR(25) NOT NULL,
  aux_code     VARCHAR(25),
  description  VARCHAR(300) NOT NULL,
  quantity     DECIMAL(14,6) NOT NULL,
  unit_price   DECIMAL(14,6) NOT NULL,
  discount     DECIMAL(14,2) NOT NULL DEFAULT 0,
  subtotal     DECIMAL(14,2) NOT NULL,
  taxes        JSONB NOT NULL,
  line_total   DECIMAL(14,2) NOT NULL
);

CREATE INDEX idx_sandbox_document_line_items_document_id ON sandbox.document_line_items(document_id);

-- ─── document_events ─────────────────────────────────────────────────────────

CREATE TABLE sandbox.document_events (
  id          BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES sandbox.documents(id),
  event_type  VARCHAR(30) NOT NULL,
  from_status VARCHAR(20),
  to_status   VARCHAR(20),
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_sandbox_document_events_event_type
    CHECK (event_type IN ('CREATED','SENT','STATUS_CHANGED','ERROR','REBUILT',
                          'EMAIL_SENT','EMAIL_FAILED','EMAIL_DELIVERED',
                          'EMAIL_TEMP_FAILED','EMAIL_COMPLAINED'))
);

CREATE INDEX idx_sandbox_document_events_document_id ON sandbox.document_events(document_id);

-- ─── sri_responses ───────────────────────────────────────────────────────────

CREATE TABLE sandbox.sri_responses (
  id             BIGSERIAL PRIMARY KEY,
  document_id    BIGINT NOT NULL REFERENCES sandbox.documents(id),
  operation_type VARCHAR(20) NOT NULL,
  status         VARCHAR(20),
  messages       JSONB,
  raw_response   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_sandbox_sri_responses_operation_type
    CHECK (operation_type IN ('RECEPTION', 'AUTHORIZATION'))
);

CREATE INDEX idx_sandbox_sri_responses_document_id ON sandbox.sri_responses(document_id);

-- ─── Row-Level Security ───────────────────────────────────────────────────────
--
-- Mirror the same RLS policies from migration 031, applied to the sandbox schema.
-- The application always sets app.current_issuer_id in the same transaction that
-- sets search_path to sandbox, so RLS enforcement is identical to public.

ALTER TABLE sandbox.documents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox.sequential_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox.document_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox.document_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox.sri_responses      ENABLE ROW LEVEL SECURITY;

ALTER TABLE sandbox.documents          FORCE ROW LEVEL SECURITY;
ALTER TABLE sandbox.sequential_numbers FORCE ROW LEVEL SECURITY;
ALTER TABLE sandbox.document_line_items FORCE ROW LEVEL SECURITY;
ALTER TABLE sandbox.document_events    FORCE ROW LEVEL SECURITY;
ALTER TABLE sandbox.sri_responses      FORCE ROW LEVEL SECURITY;

CREATE POLICY sandbox_documents_isolation ON sandbox.documents
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.current_issuer_id', true), '') IS NULL
    OR issuer_id = NULLIF(current_setting('app.current_issuer_id', true), '')::bigint
  );

CREATE POLICY sandbox_sequential_numbers_isolation ON sandbox.sequential_numbers
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.current_issuer_id', true), '') IS NULL
    OR issuer_id = NULLIF(current_setting('app.current_issuer_id', true), '')::bigint
  );

CREATE POLICY sandbox_document_line_items_isolation ON sandbox.document_line_items
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.current_issuer_id', true), '') IS NULL
    OR document_id IN (
      SELECT id FROM sandbox.documents
      WHERE issuer_id = NULLIF(current_setting('app.current_issuer_id', true), '')::bigint
    )
  );

CREATE POLICY sandbox_document_events_isolation ON sandbox.document_events
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.current_issuer_id', true), '') IS NULL
    OR document_id IN (
      SELECT id FROM sandbox.documents
      WHERE issuer_id = NULLIF(current_setting('app.current_issuer_id', true), '')::bigint
    )
  );

CREATE POLICY sandbox_sri_responses_isolation ON sandbox.sri_responses
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.current_issuer_id', true), '') IS NULL
    OR document_id IN (
      SELECT id FROM sandbox.documents
      WHERE issuer_id = NULLIF(current_setting('app.current_issuer_id', true), '')::bigint
    )
  );

COMMIT;
