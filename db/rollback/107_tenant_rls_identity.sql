-- Manual rollback for migration 107. Not run by db/migrate.js.
-- Run by hand as the table owner (comprobify_app):
--
--   psql "<connection string>" -v ON_ERROR_STOP=1 -f db/rollback/107_tenant_rls_identity.sql
--
-- Removes RLS from the identity tables and pending_effects. Touches no data,
-- keeps the index, and leaves the migrations row for 107 in place on purpose.

BEGIN;

DROP POLICY IF EXISTS tenants_isolation ON public.tenants;
ALTER TABLE public.tenants NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenants DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS issuers_isolation ON public.issuers;
ALTER TABLE public.issuers NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.issuers DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_keys_isolation ON public.api_keys;
ALTER TABLE public.api_keys NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pending_effects_isolation ON public.pending_effects;
ALTER TABLE public.pending_effects NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pending_effects DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS issuer_document_types_isolation ON public.issuer_document_types;
ALTER TABLE public.issuer_document_types NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.issuer_document_types DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_key_daily_usage_isolation ON public.api_key_daily_usage;
ALTER TABLE public.api_key_daily_usage NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.api_key_daily_usage DISABLE ROW LEVEL SECURITY;

COMMIT;
