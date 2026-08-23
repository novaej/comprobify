-- Lets an issuer be paused from creating new documents (POST /v1/documents,
-- POST /:accessKey/rebuild) without deactivating it — history, PDF/email, and
-- read endpoints for its existing documents keep working regardless of this flag.

BEGIN;

ALTER TABLE issuers ADD COLUMN can_issue BOOLEAN NOT NULL DEFAULT true;

COMMIT;
