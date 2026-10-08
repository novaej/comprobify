-- Manual rollback for migration 105: restores the fail-open policies.
-- Not run by db/migrate.js. Run by hand as the table owner (comprobify_app):
--
--   psql "<connection string>" -v ON_ERROR_STOP=1 -f db/rollback/105_rls_fail_open.sql
--
-- Leaves the migrations row for 105 in place on purpose - deleting it would
-- make the next app start re-apply the migration.

BEGIN;

DROP POLICY IF EXISTS documents_isolation ON public.documents;
CREATE POLICY documents_isolation ON public.documents
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.current_issuer_id', true), '') IS NULL
    OR issuer_id = NULLIF(current_setting('app.current_issuer_id', true), '')::uuid
  );

DROP POLICY IF EXISTS sequential_numbers_isolation ON public.sequential_numbers;
CREATE POLICY sequential_numbers_isolation ON public.sequential_numbers
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.current_issuer_id', true), '') IS NULL
    OR issuer_id = NULLIF(current_setting('app.current_issuer_id', true), '')::uuid
  );

DROP POLICY IF EXISTS sandbox_documents_isolation ON sandbox.documents;
CREATE POLICY sandbox_documents_isolation ON sandbox.documents
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.current_issuer_id', true), '') IS NULL
    OR issuer_id = NULLIF(current_setting('app.current_issuer_id', true), '')::uuid
  );

DROP POLICY IF EXISTS sandbox_sequential_numbers_isolation ON sandbox.sequential_numbers;
CREATE POLICY sandbox_sequential_numbers_isolation ON sandbox.sequential_numbers
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.current_issuer_id', true), '') IS NULL
    OR issuer_id = NULLIF(current_setting('app.current_issuer_id', true), '')::uuid
  );

DROP POLICY IF EXISTS document_line_items_isolation ON public.document_line_items;
CREATE POLICY document_line_items_isolation ON public.document_line_items
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.current_issuer_id', true), '') IS NULL
    OR document_id IN (
      SELECT id FROM public.documents
      WHERE issuer_id = NULLIF(current_setting('app.current_issuer_id', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS document_events_isolation ON public.document_events;
CREATE POLICY document_events_isolation ON public.document_events
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.current_issuer_id', true), '') IS NULL
    OR document_id IN (
      SELECT id FROM public.documents
      WHERE issuer_id = NULLIF(current_setting('app.current_issuer_id', true), '')::uuid
    )
  );

-- public.sri_responses had no RLS before 105.
DROP POLICY IF EXISTS sri_responses_isolation ON public.sri_responses;
ALTER TABLE public.sri_responses NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sri_responses DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sandbox_document_line_items_isolation ON sandbox.document_line_items;
CREATE POLICY sandbox_document_line_items_isolation ON sandbox.document_line_items
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.current_issuer_id', true), '') IS NULL
    OR document_id IN (
      SELECT id FROM sandbox.documents
      WHERE issuer_id = NULLIF(current_setting('app.current_issuer_id', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS sandbox_document_events_isolation ON sandbox.document_events;
CREATE POLICY sandbox_document_events_isolation ON sandbox.document_events
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.current_issuer_id', true), '') IS NULL
    OR document_id IN (
      SELECT id FROM sandbox.documents
      WHERE issuer_id = NULLIF(current_setting('app.current_issuer_id', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS sandbox_sri_responses_isolation ON sandbox.sri_responses;
CREATE POLICY sandbox_sri_responses_isolation ON sandbox.sri_responses
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.current_issuer_id', true), '') IS NULL
    OR document_id IN (
      SELECT id FROM sandbox.documents
      WHERE issuer_id = NULLIF(current_setting('app.current_issuer_id', true), '')::uuid
    )
  );

DROP FUNCTION IF EXISTS public.app_is_system();
DROP FUNCTION IF EXISTS public.app_current_issuer_id();

COMMIT;
