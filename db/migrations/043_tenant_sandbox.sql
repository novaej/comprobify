-- Move sandbox flag from issuers to tenants.
--
-- A tenant maps to one RUC — a single legal entity. Environment (sandbox vs
-- production) is therefore a tenant-level property, not a per-branch one.
-- This eliminates the mixed state where some branches were production while
-- others remained sandbox under the same RUC.
--
-- Promotion is now a tenant-level operation: POST /api/tenants/promote flips
-- this column, revokes all sandbox API keys, and creates matching production
-- keys (same count, same labels — see KEY_MIRRORING note in CLAUDE.md).

BEGIN;

ALTER TABLE tenants ADD COLUMN sandbox BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE issuers DROP COLUMN sandbox;

COMMIT;
