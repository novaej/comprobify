-- Switch legal_documents from storing final PDF bytes to storing the
-- authored Markdown source. Markdown is the canonical, reviewable source
-- (matches the docs/legal/*.md drafts) — HTML/PDF are rendered on demand
-- from it, never stored. content_hash lets an acceptance row prove exactly
-- which text was current at acceptance time without re-rendering anything.

BEGIN;

ALTER TABLE legal_documents DROP COLUMN IF EXISTS content;
ALTER TABLE legal_documents DROP COLUMN IF EXISTS content_type;
ALTER TABLE legal_documents ADD COLUMN content_markdown TEXT NOT NULL DEFAULT '';
ALTER TABLE legal_documents ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE legal_documents ALTER COLUMN content_markdown DROP DEFAULT;
ALTER TABLE legal_documents ALTER COLUMN content_hash DROP DEFAULT;

COMMIT;
