-- Add environment column to api_keys to scope each key to sandbox or production.
-- Keys created before this migration are backfilled from their issuer's sandbox flag.

ALTER TABLE api_keys
  ADD COLUMN environment VARCHAR(10) NOT NULL DEFAULT 'sandbox'
    CHECK (environment IN ('sandbox', 'production'));

UPDATE api_keys ak
SET environment = CASE WHEN i.sandbox THEN 'sandbox' ELSE 'production' END
FROM issuers i
WHERE ak.issuer_id = i.id;
