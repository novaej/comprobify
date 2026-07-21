-- API keys are now tenant-scoped, not issuer-scoped.
--
-- Before: api_keys.issuer_id (one key per issuance point). Authenticating a key
--   implicitly selected the issuer.
-- After:  api_keys.tenant_id (one or more keys per tenant, named integrations).
--   Each request must declare its target issuer via X-Issuer-Id header. The
--   resolveIssuer middleware validates that issuer.tenant_id matches the key's
--   tenant_id (else 403).
--
-- Hard break: no fallback default. Existing keys keep working (their tenant_id
-- is backfilled from the issuer they used to point to), but every request from
-- now on must send X-Issuer-Id.
--
-- The api_keys table only lives in the public schema (not duplicated in sandbox),
-- so this migration is single-schema.

BEGIN;

-- ─── Add tenant_id column ────────────────────────────────────────────────────

ALTER TABLE api_keys ADD COLUMN tenant_id UUID REFERENCES tenants(id);

UPDATE api_keys
   SET tenant_id = issuers.tenant_id
  FROM issuers
 WHERE issuers.id = api_keys.issuer_id;

ALTER TABLE api_keys ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX idx_api_keys_tenant_id ON api_keys(tenant_id);

-- ─── Drop the issuer-scoped RLS policy ───────────────────────────────────────
--
-- The old policy referenced issuer_id, which we are about to remove. We could
-- replace it with a tenant-scoped policy, but the authenticate middleware does
-- its key lookup BEFORE any context is set, so any RLS on api_keys must include
-- a NULL-context bypass — which means it enforces nothing in practice. Drop the
-- policy and rely on explicit `WHERE tenant_id = $1` filters in application
-- code (see NEXT_STEPS for the future tenant-context RLS enhancement).

DROP POLICY IF EXISTS api_keys_isolation ON api_keys;
ALTER TABLE api_keys NO FORCE ROW LEVEL SECURITY;
ALTER TABLE api_keys DISABLE ROW LEVEL SECURITY;

-- ─── Drop issuer_id ──────────────────────────────────────────────────────────

DROP INDEX IF EXISTS idx_api_keys_issuer_id;
ALTER TABLE api_keys DROP COLUMN issuer_id;

COMMIT;
