-- Decouples subscription activation from the operator's self-billed invoice.
--
-- Until now a subscription only reached ACTIVE once its linked invoice was
-- SRI-AUTHORIZED (ADR-017). That gated the *customer's* access on the
-- *operator's* legal obligation: a tenant whose money was already captured
-- stayed locked out whenever SRI was down. Payment verification alone now
-- grants access; the invoice obligation is tracked by an operator work queue
-- instead (GET /v1/admin/invoicing/pending). See ADR-027.

BEGIN;

-- The explicit "an invoice has been issued and recorded for this payment"
-- signal, stamped by subscriptionService.linkInvoice(), and the sole input to
-- the invoicing queue. Deliberately NOT derived from invoice_document_id IS
-- NULL: that column is never set for a sandbox-linked document (both FKs
-- reference public.documents only), so it would report an already-invoiced
-- sandbox payment as pending forever. See CLAUDE.md Common Mistake #35.
ALTER TABLE payments ADD COLUMN invoiced_at TIMESTAMPTZ;

-- Rollback snapshot captured by applyVerifiedPayment() immediately BEFORE it
-- applies the payment: { tier, billingInterval, periodStart, periodEnd,
-- subscriptionStatus }. Backs PATCH /v1/admin/payments/:id/refund, which
-- restores it verbatim — a reversed TIER_CHANGE must return to the previous
-- paid tier, and a reversed RENEWAL must roll the period back, neither of
-- which is reconstructible after the fact. Nullable: payments applied before
-- this migration have no snapshot and the refund endpoint refuses them.
ALTER TABLE payments ADD COLUMN applied_from JSONB;

-- Backfill: every payment whose invoice was already linked pre-migration is
-- already invoiced and must not appear in the new queue. Two sources, matching
-- the two FKs linkInvoice writes (see CLAUDE.md Common Mistake #37):
-- payments.invoice_document_id for TIER_CHANGE/RENEWAL, and the subscription's
-- own initial_invoice_document_id for the INITIAL payment that activated it.
UPDATE payments SET invoiced_at = NOW()
WHERE invoice_document_id IS NOT NULL;

UPDATE payments p SET invoiced_at = NOW()
FROM subscriptions s
WHERE s.id = p.subscription_id
  AND p.purpose = 'INITIAL'
  AND p.invoiced_at IS NULL
  AND s.initial_invoice_document_id IS NOT NULL;

-- Current suspension reason as a constrained enum rather than free text.
-- PATCH /v1/admin/tenants/:id/status previously took a free-text reason that
-- landed in tenant_events.detail — which GET /v1/tenants/events passes through
-- verbatim, making whatever an operator typed readable by anyone holding that
-- tenant's API key. Same problem, same fix as migration 068 applied to
-- payments.rejection_reason. Mirrors src/constants/suspension-reasons.js.
--
-- A column (not only the event detail) because a frontend showing a suspended
-- tenant *why* needs the current reason, not the newest STATUS_CHANGED row dug
-- out of an audit log — same denormalized-cache-alongside-audit-trail pattern
-- as tenants.agreement_accepted_at/agreement_version.
ALTER TABLE tenants ADD COLUMN suspension_reason_code VARCHAR(30);

ALTER TABLE tenants
  ADD CONSTRAINT chk_tenants_suspension_reason_code
    CHECK (suspension_reason_code IS NULL OR suspension_reason_code IN (
      'PAYMENT_REVERSED', 'FRAUD_SUSPECTED', 'TERMS_VIOLATION',
      'VOLUNTARY_CLOSURE', 'UNPAID_BALANCE', 'OTHER'
    ));

-- PAYMENT_REFUNDED: logged by PATCH /v1/admin/payments/:id/refund.
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
      'PAYMENT_REFUNDED',
      'INVOICE_LINKED',
      'SUBSCRIPTION_ACTIVATED',
      'SUBSCRIPTION_CANCELLED',
      'SUBSCRIPTION_CANCELLATION_SCHEDULED',
      'TIER_CHANGED',
      'TIER_CHANGE_REQUESTED',
      'TIER_CHANGE_SCHEDULED',
      'RENEWAL_DUE',
      'SUBSCRIPTION_RENEWED',
      'SUBSCRIPTION_EXPIRED',
      'STATUS_CHANGED',
      'CERTIFICATE_UPLOADED',
      'CERTIFICATE_RENEWED'
    ));

-- NOTE: subscriptions.status deliberately keeps PAYMENT_RECEIVED and
-- INVOICE_PROCESSING in chk_subscriptions_status even though nothing writes
-- them any more (both were steps in the invoice-gated activation flow this
-- migration removes). Historical rows still carry them; dropping the values
-- would invalidate that history for no gain. Treat them as legacy.

-- The invoicing queue's driving predicate.
CREATE INDEX idx_payments_pending_invoice ON payments(verified_at)
  WHERE status = 'VERIFIED' AND invoiced_at IS NULL;

COMMIT;
