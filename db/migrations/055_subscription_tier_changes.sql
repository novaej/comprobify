-- Tenant-initiated subscription tier changes (upgrade/downgrade). See
-- CLAUDE.md's "Subscription + payment pipeline" entry and NEXT_STEPS.md #9.
--
-- Upgrades take effect immediately once a prorated payment is verified and
-- self-billed-invoice-authorized. Downgrades are scheduled (no payment owed)
-- and applied at current_period_end by an admin job.

BEGIN;

ALTER TABLE subscriptions
  ADD COLUMN pending_tier VARCHAR(20),
  ADD CONSTRAINT chk_subscriptions_pending_tier
    CHECK (pending_tier IS NULL OR pending_tier IN ('STARTER', 'GROWTH', 'BUSINESS'));

-- invoice_document_id lives on payments (not reused from subscriptions) so a
-- tier-change payment can have its own self-billed invoice link without
-- disturbing the subscription's original initial-activation invoice link.
ALTER TABLE payments
  ADD COLUMN purpose VARCHAR(20) NOT NULL DEFAULT 'INITIAL',
  ADD CONSTRAINT chk_payments_purpose
    CHECK (purpose IN ('INITIAL', 'TIER_CHANGE')),
  ADD COLUMN target_tier VARCHAR(20),
  ADD CONSTRAINT chk_payments_target_tier
    CHECK (target_tier IS NULL OR target_tier IN ('STARTER', 'GROWTH', 'BUSINESS')),
  ADD COLUMN invoice_document_id UUID REFERENCES documents(id);

CREATE INDEX idx_payments_invoice_document_id ON payments(invoice_document_id);

ALTER TABLE tenant_events
  DROP CONSTRAINT chk_tenant_events_event_type,
  ADD CONSTRAINT chk_tenant_events_event_type
    CHECK (event_type IN (
      'VERIFICATION_EMAIL_SENT',
      'VERIFICATION_EMAIL_FAILED',
      'VERIFICATION_EMAIL_DELIVERED',
      'VERIFICATION_EMAIL_TEMP_FAILED',
      'VERIFICATION_EMAIL_COMPLAINED',
      'EMAIL_VERIFIED',
      'SUBSCRIPTION_CREATED',
      'PAYMENT_REPORTED',
      'PAYMENT_VERIFIED',
      'PAYMENT_REJECTED',
      'INVOICE_LINKED',
      'SUBSCRIPTION_ACTIVATED',
      'SUBSCRIPTION_CANCELLED',
      'TIER_CHANGED',
      'TIER_CHANGE_REQUESTED',
      'TIER_CHANGE_SCHEDULED'
    ));

COMMIT;
