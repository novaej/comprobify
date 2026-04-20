BEGIN;

-- PostgreSQL Row-Level Security (RLS) for tenant isolation.
--
-- PREREQUISITE: The application database user must NOT be a PostgreSQL superuser.
-- Superusers always bypass RLS regardless of these policies. Connect the app as a
-- regular (non-superuser) role. FORCE ROW LEVEL SECURITY below ensures RLS also
-- applies when the connecting user is the table owner.
--
-- How it works:
--   * The application sets a transaction-local config variable before every query:
--       SELECT set_config('app.current_issuer_id', '<id>', true)
--     (the third argument `true` makes it local to the current transaction)
--   * Each policy compares rows against this variable.
--   * When the variable is NOT set (e.g. Mailgun webhook, admin API, health check),
--     current_setting returns '' and NULLIF converts it to NULL — the IS NULL branch
--     makes the policy permissive, allowing bypass for those authenticated-by-other-means
--     code paths.
--   * When the variable IS set, only rows belonging to the matching issuer are visible
--     or writable — a SQL bug that omits a WHERE clause cannot cross tenant boundaries.

-- ─── tables with a direct issuer_id column ────────────────────────────────────

ALTER TABLE documents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequential_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys           ENABLE ROW LEVEL SECURITY;

ALTER TABLE documents          FORCE ROW LEVEL SECURITY;
ALTER TABLE sequential_numbers FORCE ROW LEVEL SECURITY;
ALTER TABLE api_keys           FORCE ROW LEVEL SECURITY;

CREATE POLICY documents_isolation ON documents
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.current_issuer_id', true), '') IS NULL
    OR issuer_id = NULLIF(current_setting('app.current_issuer_id', true), '')::bigint
  );

CREATE POLICY sequential_numbers_isolation ON sequential_numbers
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.current_issuer_id', true), '') IS NULL
    OR issuer_id = NULLIF(current_setting('app.current_issuer_id', true), '')::bigint
  );

CREATE POLICY api_keys_isolation ON api_keys
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.current_issuer_id', true), '') IS NULL
    OR issuer_id = NULLIF(current_setting('app.current_issuer_id', true), '')::bigint
  );

-- ─── child tables (linked via document_id) ────────────────────────────────────

ALTER TABLE document_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_events     ENABLE ROW LEVEL SECURITY;

ALTER TABLE document_line_items FORCE ROW LEVEL SECURITY;
ALTER TABLE document_events     FORCE ROW LEVEL SECURITY;

CREATE POLICY document_line_items_isolation ON document_line_items
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.current_issuer_id', true), '') IS NULL
    OR document_id IN (
      SELECT id FROM documents
      WHERE issuer_id = NULLIF(current_setting('app.current_issuer_id', true), '')::bigint
    )
  );

CREATE POLICY document_events_isolation ON document_events
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.current_issuer_id', true), '') IS NULL
    OR document_id IN (
      SELECT id FROM documents
      WHERE issuer_id = NULLIF(current_setting('app.current_issuer_id', true), '')::bigint
    )
  );

COMMIT;
