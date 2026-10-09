-- Tenant-level Row-Level Security, first group, and fail-loud everywhere.
--
-- 1. Puts the messaging and billing tables under RLS, keyed on the tenant
--    context every request and job now declares (ADR-037).
-- 2. Makes a missing context an error instead of an empty result, on these
--    tables and on the document tables from migration 105. A query that
--    forgets its context used to "work" and return nothing; now it says so.
--
-- The system check lives inside the app_require_* functions on purpose:
-- Postgres evaluates both sides of `app_is_system() OR ...`, so a function
-- that raised whenever its own setting was unset would also raise in system
-- context.
--
-- Rollback: db/rollback/106_tenant_rls_messaging_billing.sql

CREATE FUNCTION public.app_require_tenant_id() RETURNS uuid
  LANGUAGE plpgsql STABLE
  AS $$
DECLARE
  v text := NULLIF(current_setting('app.current_tenant_id', true), '');
BEGIN
  IF v IS NOT NULL THEN RETURN v::uuid; END IF;
  IF public.app_is_system() THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'RLS: no tenant or system context set for a query on a tenant-owned table'
    USING ERRCODE = 'insufficient_privilege',
          HINT = 'Application code: run inside rlsContext.runAsTenant/runAsSystem. By hand: SET app.rls_system = ''on''.';
END $$;

CREATE FUNCTION public.app_require_issuer_id() RETURNS uuid
  LANGUAGE plpgsql STABLE
  AS $$
DECLARE
  v text := NULLIF(current_setting('app.current_issuer_id', true), '');
BEGIN
  IF v IS NOT NULL THEN RETURN v::uuid; END IF;
  IF public.app_is_system() THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'RLS: no issuer or system context set for a query on a document table'
    USING ERRCODE = 'insufficient_privilege',
          HINT = 'Application code: use db.queryAsIssuer/setIssuerContext. By hand: SET app.rls_system = ''on''.';
END $$;

-- ─── document tables (migration 105): same rule, now fail-loud ────────────────

DROP POLICY IF EXISTS documents_isolation ON public.documents;
CREATE POLICY documents_isolation ON public.documents
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR issuer_id = public.app_require_issuer_id()
  )
  WITH CHECK (
    public.app_is_system() OR issuer_id = public.app_require_issuer_id()
  );

DROP POLICY IF EXISTS sequential_numbers_isolation ON public.sequential_numbers;
CREATE POLICY sequential_numbers_isolation ON public.sequential_numbers
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR issuer_id = public.app_require_issuer_id()
  )
  WITH CHECK (
    public.app_is_system() OR issuer_id = public.app_require_issuer_id()
  );

DROP POLICY IF EXISTS sandbox_documents_isolation ON sandbox.documents;
CREATE POLICY sandbox_documents_isolation ON sandbox.documents
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR issuer_id = public.app_require_issuer_id()
  )
  WITH CHECK (
    public.app_is_system() OR issuer_id = public.app_require_issuer_id()
  );

DROP POLICY IF EXISTS sandbox_sequential_numbers_isolation ON sandbox.sequential_numbers;
CREATE POLICY sandbox_sequential_numbers_isolation ON sandbox.sequential_numbers
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR issuer_id = public.app_require_issuer_id()
  )
  WITH CHECK (
    public.app_is_system() OR issuer_id = public.app_require_issuer_id()
  );

DROP POLICY IF EXISTS document_line_items_isolation ON public.document_line_items;
CREATE POLICY document_line_items_isolation ON public.document_line_items
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_require_issuer_id()
    )
  )
  WITH CHECK (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_require_issuer_id()
    )
  );

DROP POLICY IF EXISTS document_events_isolation ON public.document_events;
CREATE POLICY document_events_isolation ON public.document_events
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_require_issuer_id()
    )
  )
  WITH CHECK (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_require_issuer_id()
    )
  );

DROP POLICY IF EXISTS sri_responses_isolation ON public.sri_responses;
CREATE POLICY sri_responses_isolation ON public.sri_responses
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_require_issuer_id()
    )
  )
  WITH CHECK (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_require_issuer_id()
    )
  );

DROP POLICY IF EXISTS sandbox_document_line_items_isolation ON sandbox.document_line_items;
CREATE POLICY sandbox_document_line_items_isolation ON sandbox.document_line_items
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM sandbox.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_require_issuer_id()
    )
  )
  WITH CHECK (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM sandbox.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_require_issuer_id()
    )
  );

DROP POLICY IF EXISTS sandbox_document_events_isolation ON sandbox.document_events;
CREATE POLICY sandbox_document_events_isolation ON sandbox.document_events
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM sandbox.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_require_issuer_id()
    )
  )
  WITH CHECK (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM sandbox.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_require_issuer_id()
    )
  );

DROP POLICY IF EXISTS sandbox_sri_responses_isolation ON sandbox.sri_responses;
CREATE POLICY sandbox_sri_responses_isolation ON sandbox.sri_responses
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM sandbox.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_require_issuer_id()
    )
  )
  WITH CHECK (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM sandbox.documents d
      WHERE d.id = document_id AND d.issuer_id = public.app_require_issuer_id()
    )
  );

-- ─── messaging and billing: direct tenant_id ──────────────────────────────────

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_isolation ON public.notifications;
CREATE POLICY notifications_isolation ON public.notifications
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR tenant_id = public.app_require_tenant_id()
  )
  WITH CHECK (
    public.app_is_system() OR tenant_id = public.app_require_tenant_id()
  );

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_preferences_isolation ON public.notification_preferences;
CREATE POLICY notification_preferences_isolation ON public.notification_preferences
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR tenant_id = public.app_require_tenant_id()
  )
  WITH CHECK (
    public.app_is_system() OR tenant_id = public.app_require_tenant_id()
  );

ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_endpoints FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_endpoints_isolation ON public.webhook_endpoints;
CREATE POLICY webhook_endpoints_isolation ON public.webhook_endpoints
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR tenant_id = public.app_require_tenant_id()
  )
  WITH CHECK (
    public.app_is_system() OR tenant_id = public.app_require_tenant_id()
  );

ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_deliveries_isolation ON public.webhook_deliveries;
CREATE POLICY webhook_deliveries_isolation ON public.webhook_deliveries
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR tenant_id = public.app_require_tenant_id()
  )
  WITH CHECK (
    public.app_is_system() OR tenant_id = public.app_require_tenant_id()
  );

ALTER TABLE public.tenant_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_events_isolation ON public.tenant_events;
CREATE POLICY tenant_events_isolation ON public.tenant_events
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR tenant_id = public.app_require_tenant_id()
  )
  WITH CHECK (
    public.app_is_system() OR tenant_id = public.app_require_tenant_id()
  );

ALTER TABLE public.tenant_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_agreements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_agreements_isolation ON public.tenant_agreements;
CREATE POLICY tenant_agreements_isolation ON public.tenant_agreements
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR tenant_id = public.app_require_tenant_id()
  )
  WITH CHECK (
    public.app_is_system() OR tenant_id = public.app_require_tenant_id()
  );

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscriptions_isolation ON public.subscriptions;
CREATE POLICY subscriptions_isolation ON public.subscriptions
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR tenant_id = public.app_require_tenant_id()
  )
  WITH CHECK (
    public.app_is_system() OR tenant_id = public.app_require_tenant_id()
  );

ALTER TABLE public.tenant_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_quotas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_quotas_isolation ON public.tenant_quotas;
CREATE POLICY tenant_quotas_isolation ON public.tenant_quotas
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR tenant_id = public.app_require_tenant_id()
  )
  WITH CHECK (
    public.app_is_system() OR tenant_id = public.app_require_tenant_id()
  );

-- ─── billing children: tenant reached through the subscription ────────────────

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payments_isolation ON public.payments;
CREATE POLICY payments_isolation ON public.payments
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.id = subscription_id AND s.tenant_id = public.app_require_tenant_id()
    )
  )
  WITH CHECK (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.id = subscription_id AND s.tenant_id = public.app_require_tenant_id()
    )
  );

ALTER TABLE public.payment_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_proofs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_proofs_isolation ON public.payment_proofs;
CREATE POLICY payment_proofs_isolation ON public.payment_proofs
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM public.payments p
      JOIN public.subscriptions s ON s.id = p.subscription_id
      WHERE p.id = payment_id AND s.tenant_id = public.app_require_tenant_id()
    )
  )
  WITH CHECK (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM public.payments p
      JOIN public.subscriptions s ON s.id = p.subscription_id
      WHERE p.id = payment_id AND s.tenant_id = public.app_require_tenant_id()
    )
  );

ALTER TABLE public.payphone_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payphone_transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payphone_transactions_isolation ON public.payphone_transactions;
CREATE POLICY payphone_transactions_isolation ON public.payphone_transactions
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM public.payments p
      JOIN public.subscriptions s ON s.id = p.subscription_id
      WHERE p.id = payment_id AND s.tenant_id = public.app_require_tenant_id()
    )
  )
  WITH CHECK (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM public.payments p
      JOIN public.subscriptions s ON s.id = p.subscription_id
      WHERE p.id = payment_id AND s.tenant_id = public.app_require_tenant_id()
    )
  );
