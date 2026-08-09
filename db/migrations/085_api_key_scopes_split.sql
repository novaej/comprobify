-- Splits the original 4-scope vocabulary into 9, matching comprobify-web's
-- actual per-role permission granularity: issuers:manage bundled read+write
-- into one scope even though every role needs issuer reads but only some
-- need writes; account:manage bundled 5 independently-held permissions
-- (key management, billing, webhooks, tenant settings, production
-- promotion) into one. Existing rows are rewritten in place, not just
-- allowed under a wider CHECK constraint — leaving old scope strings in
-- place would silently 403 every route that now checks a scope string no
-- existing key actually has. See CLAUDE.md "Tenant-scoped API key
-- permissions". Adding a 10th scope later requires updating this CHECK
-- constraint (new migration) and src/constants/api-key-scopes.js.

BEGIN;

-- Must drop the old constraint before rewriting data — it only allows the
-- old 4 values, so the UPDATE below would violate it if run first.
ALTER TABLE api_keys DROP CONSTRAINT chk_api_keys_scopes;

UPDATE api_keys
SET scopes = (
  SELECT array_agg(DISTINCT expanded)
  FROM unnest(scopes) AS old_scope,
       LATERAL unnest(
         CASE old_scope
           WHEN 'issuers:manage' THEN ARRAY['issuers:read', 'issuers:write']
           WHEN 'account:manage' THEN ARRAY['keys:manage', 'billing:manage', 'webhooks:manage', 'tenant:manage', 'tenant:promote']
           ELSE ARRAY[old_scope]
         END
       ) AS expanded
);

ALTER TABLE api_keys ALTER COLUMN scopes SET DEFAULT ARRAY[
  'documents:write', 'documents:read',
  'issuers:read', 'issuers:write',
  'keys:manage', 'billing:manage', 'webhooks:manage', 'tenant:manage', 'tenant:promote'
];

ALTER TABLE api_keys ADD CONSTRAINT chk_api_keys_scopes
  CHECK (scopes <@ ARRAY[
    'documents:write', 'documents:read',
    'issuers:read', 'issuers:write',
    'keys:manage', 'billing:manage', 'webhooks:manage', 'tenant:manage', 'tenant:promote'
  ]::TEXT[]);

COMMIT;
