BEGIN;

-- Drop all foreign key constraints before altering column types
ALTER TABLE documents        DROP CONSTRAINT documents_issuer_id_fkey;
ALTER TABLE sequential_numbers DROP CONSTRAINT sequential_numbers_issuer_id_fkey;
ALTER TABLE sri_responses    DROP CONSTRAINT sri_responses_document_id_fkey;
ALTER TABLE document_events  DROP CONSTRAINT document_events_document_id_fkey;
ALTER TABLE api_keys         DROP CONSTRAINT api_keys_issuer_id_fkey;
-- Note: constraint name reflects the original table name (invoice_details) from migration 008
ALTER TABLE document_line_items DROP CONSTRAINT invoice_details_document_id_fkey;

-- Alter primary key columns from INT to BIGINT
ALTER TABLE issuers             ALTER COLUMN id TYPE BIGINT;
ALTER TABLE documents           ALTER COLUMN id TYPE BIGINT;
ALTER TABLE sequential_numbers  ALTER COLUMN id TYPE BIGINT;
ALTER TABLE sri_responses       ALTER COLUMN id TYPE BIGINT;
ALTER TABLE document_events     ALTER COLUMN id TYPE BIGINT;
ALTER TABLE api_keys            ALTER COLUMN id TYPE BIGINT;
ALTER TABLE document_line_items ALTER COLUMN id TYPE BIGINT;
ALTER TABLE cat_tax_rates       ALTER COLUMN id TYPE BIGINT;

-- Alter foreign key columns from INTEGER to BIGINT
ALTER TABLE documents           ALTER COLUMN issuer_id    TYPE BIGINT;
ALTER TABLE sequential_numbers  ALTER COLUMN issuer_id    TYPE BIGINT;
ALTER TABLE sri_responses       ALTER COLUMN document_id  TYPE BIGINT;
ALTER TABLE document_events     ALTER COLUMN document_id  TYPE BIGINT;
ALTER TABLE api_keys            ALTER COLUMN issuer_id    TYPE BIGINT;
ALTER TABLE document_line_items ALTER COLUMN document_id  TYPE BIGINT;

-- Re-add foreign key constraints
ALTER TABLE documents        ADD CONSTRAINT documents_issuer_id_fkey        FOREIGN KEY (issuer_id)   REFERENCES issuers(id);
ALTER TABLE sequential_numbers ADD CONSTRAINT sequential_numbers_issuer_id_fkey FOREIGN KEY (issuer_id)  REFERENCES issuers(id);
ALTER TABLE sri_responses    ADD CONSTRAINT sri_responses_document_id_fkey  FOREIGN KEY (document_id) REFERENCES documents(id);
ALTER TABLE document_events  ADD CONSTRAINT document_events_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id);
ALTER TABLE api_keys         ADD CONSTRAINT api_keys_issuer_id_fkey         FOREIGN KEY (issuer_id)   REFERENCES issuers(id);
ALTER TABLE document_line_items ADD CONSTRAINT document_line_items_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id);

-- Upgrade sequences to BIGINT (raises maxvalue to 9223372036854775807)
-- Note: document_line_items sequence retains its original name from migration 008
ALTER SEQUENCE issuers_id_seq            AS BIGINT;
ALTER SEQUENCE documents_id_seq          AS BIGINT;
ALTER SEQUENCE sequential_numbers_id_seq AS BIGINT;
ALTER SEQUENCE sri_responses_id_seq      AS BIGINT;
ALTER SEQUENCE document_events_id_seq    AS BIGINT;
ALTER SEQUENCE api_keys_id_seq           AS BIGINT;
ALTER SEQUENCE invoice_details_id_seq    AS BIGINT;
ALTER SEQUENCE cat_tax_rates_id_seq      AS BIGINT;

COMMIT;
