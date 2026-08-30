-- Card payments via Payphone's Cajita de Pagos, alongside the existing manual
-- SPI bank transfer. See ADR-028 and docs/guides/payphone-payments.md.
--
-- ADR-027 already made a verified payment the single point where access is
-- granted, so an approved card charge needs no new subscription machinery — it
-- calls the same applyVerifiedPayment() a verified transfer does. What this
-- migration adds is the record of the charge itself.

BEGIN;

-- Single-valued since migration 052.
ALTER TABLE payments
  DROP CONSTRAINT chk_payments_method,
  ADD CONSTRAINT chk_payments_method
    CHECK (method IN ('SPI_TRANSFER', 'PAYPHONE_CARD'));

-- PAYMENT_VERIFIED_OPERATOR_EMAIL: fired only by the card path, since that is
-- the only one where no human already knows money arrived.
ALTER TABLE pending_effects
  DROP CONSTRAINT chk_pending_effects_type,
  ADD CONSTRAINT chk_pending_effects_type
    CHECK (
      effect_type IN (
        'SRI_SEND',
        'SRI_AUTHORIZE',
        'INVOICE_AUTHORIZED_EMAIL',
        'TENANT_AGREEMENT_GENERATE',
        'VERIFICATION_EMAIL_SEND',
        'WEBHOOK_FANOUT',
        'PAYMENT_PROOF_SUBMITTED_EMAIL',
        'PAYMENT_VERIFIED_OPERATOR_EMAIL',
        'NOTIFICATION_DISPATCH'
      )
    );

-- One row per payment ATTEMPT, not per payment: a declined card is retried and
-- the failed attempt stays as audit trail, the same append-only reasoning as
-- payment_proofs. Public-only, no sandbox mirror, no RLS — same precedent as
-- payments/subscriptions.
--
-- status lifecycle:
--   PENDING   session minted, outcome unknown (confirm not yet called, or its
--             transport failed — never a terminal state)
--   APPROVED  Payphone confirmed a captured charge
--   CANCELLED Payphone reported a non-approved outcome (declined, cancelled)
--   EXPIRED   never confirmed inside Payphone's 5-minute window, so Payphone
--             auto-reversed it; found by the reconciliation sweep
--   DUPLICATE approved, but its payment had already been paid by another
--             attempt — real money needing a manual refund, never applied twice
--   ERROR     confirmed but unusable (e.g. the amount did not match)
CREATE TABLE payphone_transactions (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  payment_id              UUID NOT NULL REFERENCES payments(id),
  -- Ours, sent to Payphone and echoed back on the return redirect. Short and
  -- opaque rather than the payment UUID, so retries get distinct ids and
  -- nothing about our id scheme leaks. UNIQUE is the collision backstop.
  client_transaction_id   VARCHAR(50) NOT NULL UNIQUE,
  -- Payphone's own id, known only once they confirm.
  payphone_transaction_id BIGINT,
  status                  VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  -- Integer cents, as Payphone requires. Compared against the confirm
  -- response's amount so a mismatched charge is never applied.
  amount_cents            INTEGER NOT NULL,
  status_code             INTEGER,
  authorization_code      VARCHAR(50),
  card_brand              VARCHAR(30),
  card_last_digits        VARCHAR(10),
  raw_confirm_response    JSONB,
  confirmed_at            TIMESTAMPTZ,
  -- Second phase: the vendor outcome commits before applyVerifiedPayment runs,
  -- so a crash in between leaves money captured and the payment still PENDING.
  -- This column is what the reconciliation sweep uses to find and finish those.
  applied_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_payphone_transactions_status
    CHECK (status IN ('PENDING', 'APPROVED', 'CANCELLED', 'EXPIRED', 'DUPLICATE', 'ERROR'))
);

CREATE INDEX idx_payphone_transactions_payment_id ON payphone_transactions(payment_id);

-- Reconciliation sweep 1: attempts whose outcome was never learned.
CREATE INDEX idx_payphone_transactions_pending ON payphone_transactions(status, created_at)
  WHERE status = 'PENDING';

-- Reconciliation sweep 2: captured charges that were never applied.
CREATE INDEX idx_payphone_transactions_unapplied ON payphone_transactions(status)
  WHERE status = 'APPROVED' AND applied_at IS NULL;

-- set_updated_at() already exists (migration 051).
CREATE TRIGGER trg_payphone_transactions_updated_at
  BEFORE UPDATE ON payphone_transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
