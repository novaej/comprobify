-- Per-key permission scopes (NEXT_STEPS "API Key Scopes"). Existing keys and
-- any key created without an explicit scopes list are backfilled to full
-- access via the DEFAULT below, preserving current behavior exactly — scoping
-- down is opt-in at key-creation time. Adding a 5th scope later requires
-- updating both this CHECK constraint (new migration) and
-- src/constants/api-key-scopes.js.

BEGIN;

ALTER TABLE api_keys ADD COLUMN scopes TEXT[] NOT NULL
  DEFAULT ARRAY['documents:write','documents:read','issuers:manage','account:manage'];

ALTER TABLE api_keys ADD CONSTRAINT chk_api_keys_scopes
  CHECK (scopes <@ ARRAY['documents:write','documents:read','issuers:manage','account:manage']::TEXT[]);

COMMIT;
