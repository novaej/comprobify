-- Lets an admin explain why a payment proof was rejected, so the tenant knows
-- what to fix before re-uploading. See NEXT_STEPS.md #9 and #12.

BEGIN;

ALTER TABLE payments
  ADD COLUMN rejection_reason TEXT;

COMMIT;
