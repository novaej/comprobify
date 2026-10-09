-- Manual rollback for migration 106. Not run by db/migrate.js.
-- Run by hand as the table owner (comprobify_app):
--
--   psql "<connection string>" -v ON_ERROR_STOP=1 -f db/rollback/106_tenant_rls_messaging_billing.sql
--
-- Removes RLS from the messaging and billing tables and returns the document
-- tables to migration 105's fail-closed (silent) policies. Touches no data.
-- Leaves the migrations row for 106 in place on purpose.

BEGIN;

DROP POLICY IF EXISTS notifications_isolation ON public.notifications;
ALTER TABLE public.notifications NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_preferences_isolation ON public.notification_preferences;
ALTER TABLE public.notification_preferences NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_endpoints_isolation ON public.webhook_endpoints;
ALTER TABLE public.webhook_endpoints NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_endpoints DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_deliveries_isolation ON public.webhook_deliveries;
ALTER TABLE public.webhook_deliveries NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_events_isolation ON public.tenant_events;
ALTER TABLE public.tenant_events NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_events DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_agreements_isolation ON public.tenant_agreements;
ALTER TABLE public.tenant_agreements NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_agreements DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscriptions_isolation ON public.subscriptions;
ALTER TABLE public.subscriptions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_quotas_isolation ON public.tenant_quotas;
ALTER TABLE public.tenant_quotas NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_quotas DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payments_isolation ON public.payments;
ALTER TABLE public.payments NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payments DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_proofs_isolation ON public.payment_proofs;
ALTER TABLE public.payment_proofs NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payment_proofs DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payphone_transactions_isolation ON public.payphone_transactions;
ALTER TABLE public.payphone_transactions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payphone_transactions DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS documents_isolation ON public.documents;
CREATE POLICY documents_isolation ON public.documents
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR issuer_id = public.app_current_issuer_id()
  )
  WITH CHECK (
    public.app_is_system() OR issuer_id = public.app_current_issuer_id()
  );

DROP POLICY IF EXISTS sequential_numbers_isolation ON public.sequential_numbers;
CREATE POLICY sequential_numbers_isolation ON public.sequential_numbers
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR issuer_id = public.app_current_issuer_id()
  )
  WITH CHECK (
    public.app_is_system() OR issuer_id = public.app_current_issuer_id()
  );

DROP POLICY IF EXISTS sandbox_documents_isolation ON sandbox.documents;
CREATE POLICY sandbox_documents_isolation ON sandbox.documents
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR issuer_id = public.app_current_issuer_id()
  )
  WITH CHECK (
    public.app_is_system() OR issuer_id = public.app_current_issuer_id()
  );

DROP POLICY IF EXISTS sandbox_sequential_numbers_isolation ON sandbox.sequential_numbers;
CREATE POLICY sandbox_sequential_numbers_isolation ON sandbox.sequential_numbers
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR issuer_id = public.app_current_issuer_id()
  )
  WITH CHECK (
    public.app_is_system() OR issuer_id = public.app_current_issuer_id()
  );

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

DROP FUNCTION IF EXISTS public.app_require_issuer_id();
DROP FUNCTION IF EXISTS public.app_require_tenant_id();

COMMIT;
