-- Tenant-level Row-Level Security, last group: the identity tables and the
-- effects outbox. After this every table that holds tenant data is protected.
--
-- These sit on the login path of every request. The API key lookup in
-- `authenticate` runs in system context (no tenant is known until the key
-- resolves), which is what lets api_keys have RLS at all - migration 042
-- removed it precisely because there was no way to say that back then.
--
-- Same fail-loud functions as migration 106.
--
-- Rollback: db/rollback/107_tenant_rls_identity.sql

-- The policy filters issuers by tenant on every request; nothing indexed it.
CREATE INDEX IF NOT EXISTS idx_issuers_tenant_id ON public.issuers (tenant_id);

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_isolation ON public.tenants;
CREATE POLICY tenants_isolation ON public.tenants
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR id = public.app_require_tenant_id()
  )
  WITH CHECK (
    public.app_is_system() OR id = public.app_require_tenant_id()
  );

ALTER TABLE public.issuers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issuers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS issuers_isolation ON public.issuers;
CREATE POLICY issuers_isolation ON public.issuers
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR tenant_id = public.app_require_tenant_id()
  )
  WITH CHECK (
    public.app_is_system() OR tenant_id = public.app_require_tenant_id()
  );

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_keys_isolation ON public.api_keys;
CREATE POLICY api_keys_isolation ON public.api_keys
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR tenant_id = public.app_require_tenant_id()
  )
  WITH CHECK (
    public.app_is_system() OR tenant_id = public.app_require_tenant_id()
  );

ALTER TABLE public.pending_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_effects FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pending_effects_isolation ON public.pending_effects;
CREATE POLICY pending_effects_isolation ON public.pending_effects
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR tenant_id = public.app_require_tenant_id()
  )
  WITH CHECK (
    public.app_is_system() OR tenant_id = public.app_require_tenant_id()
  );

ALTER TABLE public.issuer_document_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issuer_document_types FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS issuer_document_types_isolation ON public.issuer_document_types;
CREATE POLICY issuer_document_types_isolation ON public.issuer_document_types
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM public.issuers i
      WHERE i.id = issuer_id AND i.tenant_id = public.app_require_tenant_id()
    )
  )
  WITH CHECK (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM public.issuers i
      WHERE i.id = issuer_id AND i.tenant_id = public.app_require_tenant_id()
    )
  );

ALTER TABLE public.api_key_daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_key_daily_usage FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_key_daily_usage_isolation ON public.api_key_daily_usage;
CREATE POLICY api_key_daily_usage_isolation ON public.api_key_daily_usage
  AS PERMISSIVE FOR ALL
  USING (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM public.api_keys k
      WHERE k.id = api_key_id AND k.tenant_id = public.app_require_tenant_id()
    )
  )
  WITH CHECK (
    public.app_is_system() OR EXISTS (
      SELECT 1 FROM public.api_keys k
      WHERE k.id = api_key_id AND k.tenant_id = public.app_require_tenant_id()
    )
  );
