-- Drop the environment column from issuers. It was never read after ADR-013
-- introduced tenant-scoped API keys and after migration 043 moved the
-- sandbox flag to tenants. The effective SRI environment is now derived at
-- runtime: (APP_ENV !== 'production' || tenant.sandbox) ? '1' : '2'.
-- tenants.sandbox is the single source of truth for per-tenant SRI environment.
ALTER TABLE issuers DROP COLUMN IF EXISTS environment;
