-- Adds an optional bank-transfer reference number to payment proof submissions.
-- Stored per file row (mirrors filename/mime_type) since the table has no
-- separate "submission" concept — every file uploaded in the same
-- PATCH /v1/payments/:id/proof call carries the same value. Nullable at the
-- DB level (existing rows predate this field); required at the API layer
-- for new submissions going forward.

BEGIN;

ALTER TABLE payment_proofs
  ADD COLUMN reference_number VARCHAR(50);

COMMIT;
