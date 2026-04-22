-- Add sandbox flag to issuers.
--
-- When sandbox = true (the default), the issuer uses SRI's test endpoint regardless
-- of APP_ENV. When sandbox = false in a production APP_ENV, the issuer uses the SRI
-- production endpoint.
--
-- All existing issuers default to sandbox = true (safe mode) until an admin
-- explicitly promotes them to production.

ALTER TABLE issuers ADD COLUMN sandbox BOOLEAN NOT NULL DEFAULT true;
