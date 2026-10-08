-- Fail-closed Row-Level Security.
--
-- Until now every policy let a query through whenever app.current_issuer_id
-- was unset, so a query that forgot its issuer context saw every tenant's
-- rows. From here on an unset context sees nothing, and cross-issuer access
-- needs the explicit system flag (db.queryAsSystem / db.setSystemContext).
-- Also adds RLS to public.sri_responses, which only its sandbox twin had.
--
-- Rollback: db/rollback/105_rls_fail_open.sql

CREATE FUNCTION public.app_current_issuer_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.current_issuer_id', true), '')::uuid $$;

CREATE FUNCTION public.app_is_system() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT COALESCE(current_setting('app.rls_system', true), '') = 'on' $$;

ALTER TABLE public.sri_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sri_responses FORCE ROW LEVEL SECURITY;

-- ─── tables with a direct issuer_id column ────────────────────────────────────

DROP POLICY IF EXISTS documents_isolation ON public.documents;
CREATE POLICY documents_isolation ON public.documents
  AS PERMISSIVE FOR ALL
  USING      (public.app_is_system() OR issuer_id = public.app_current_issuer_id())
  WITH CHECK (public.app_is_system() OR issuer_id = public.app_current_issuer_id());

DROP POLICY IF EXISTS sequential_numbers_isolation ON public.sequential_numbers;
CREATE POLICY sequential_numbers_isolation ON public.sequential_numbers
  AS PERMISSIVE FOR ALL
  USING      (public.app_is_system() OR issuer_id = public.app_current_issuer_id())
  WITH CHECK (public.app_is_system() OR issuer_id = public.app_current_issuer_id());

DROP POLICY IF EXISTS sandbox_documents_isolation ON sandbox.documents;
CREATE POLICY sandbox_documents_isolation ON sandbox.documents
  AS PERMISSIVE FOR ALL
  USING      (public.app_is_system() OR issuer_id = public.app_current_issuer_id())
  WITH CHECK (public.app_is_system() OR issuer_id = public.app_current_issuer_id());

DROP POLICY IF EXISTS sandbox_sequential_numbers_isolation ON sandbox.sequential_numbers;
CREATE POLICY sandbox_sequential_numbers_isolation ON sandbox.sequential_numbers
  AS PERMISSIVE FOR ALL
  USING      (public.app_is_system() OR issuer_id = public.app_current_issuer_id())
  WITH CHECK (public.app_is_system() OR issuer_id = public.app_current_issuer_id());

-- ─── child tables (linked via document_id) ────────────────────────────────────

DROP POLICY IF EXISTS document_line_items_isolation ON public.document_line_items;
CREATE POLICY document_line_items_isolation ON public.document_line_items
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_current_issuer_id()
    )
  )
  WITH CHECK (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_current_issuer_id()
    )
  );

DROP POLICY IF EXISTS document_events_isolation ON public.document_events;
CREATE POLICY document_events_isolation ON public.document_events
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_current_issuer_id()
    )
  )
  WITH CHECK (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_current_issuer_id()
    )
  );

DROP POLICY IF EXISTS sri_responses_isolation ON public.sri_responses;
CREATE POLICY sri_responses_isolation ON public.sri_responses
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_current_issuer_id()
    )
  )
  WITH CHECK (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_current_issuer_id()
    )
  );

DROP POLICY IF EXISTS sandbox_document_line_items_isolation ON sandbox.document_line_items;
CREATE POLICY sandbox_document_line_items_isolation ON sandbox.document_line_items
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM sandbox.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_current_issuer_id()
    )
  )
  WITH CHECK (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM sandbox.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_current_issuer_id()
    )
  );

DROP POLICY IF EXISTS sandbox_document_events_isolation ON sandbox.document_events;
CREATE POLICY sandbox_document_events_isolation ON sandbox.document_events
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM sandbox.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_current_issuer_id()
    )
  )
  WITH CHECK (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM sandbox.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_current_issuer_id()
    )
  );

DROP POLICY IF EXISTS sandbox_sri_responses_isolation ON sandbox.sri_responses;
CREATE POLICY sandbox_sri_responses_isolation ON sandbox.sri_responses
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM sandbox.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_current_issuer_id()
    )
  )
  WITH CHECK (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM sandbox.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_current_issuer_id()
    )
  );
