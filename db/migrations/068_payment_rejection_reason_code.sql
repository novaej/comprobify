-- Replaces the free-text payments.rejection_reason with a predefined enum,
-- rejection_reason_code, so the frontend can map a stable code to a
-- UI-friendly localized message instead of displaying whatever an admin
-- happened to type. See src/constants/rejection-reasons.js.

BEGIN;

ALTER TABLE payments
  DROP COLUMN rejection_reason,
  ADD COLUMN rejection_reason_code VARCHAR(30),
  ADD CONSTRAINT chk_payments_rejection_reason_code
    CHECK (rejection_reason_code IS NULL OR rejection_reason_code IN (
      'AMOUNT_MISMATCH', 'TRANSFER_NOT_FOUND', 'WRONG_ACCOUNT',
      'ILLEGIBLE_PROOF', 'DUPLICATE_SUBMISSION', 'OTHER'
    ));

COMMIT;
