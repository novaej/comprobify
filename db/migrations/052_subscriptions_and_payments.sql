-- Manual subscription + payment pipeline (admin-driven, no payment gateway yet).
--
-- A subscription only reaches ACTIVE once its linked invoice document is
-- SRI-AUTHORIZED — never merely on payment. See NEXT_STEPS.md #9.
--
-- Both tables are public-only (not sandbox-mirrored), same precedent as
-- tenant_events/notifications/webhook_endpoints: tenant-level billing
-- concerns, no RLS, plain db.query().
--
-- No payment-gateway-specific columns here — there is no gateway decided
-- or built yet. Add them in a dedicated migration when one actually exists.

BEGIN;

CREATE TABLE subscriptions (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id),
  tier                   VARCHAR(20) NOT NULL,
  status                 VARCHAR(20) NOT NULL DEFAULT 'PENDING_PAYMENT',
  invoice_document_id    UUID REFERENCES documents(id),
  current_period_start   TIMESTAMPTZ,
  current_period_end     TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  canceled_at            TIMESTAMPTZ,
  CONSTRAINT chk_subscriptions_tier
    CHECK (tier IN ('STARTER', 'GROWTH', 'BUSINESS')),
  CONSTRAINT chk_subscriptions_status
    CHECK (status IN ('PENDING_PAYMENT', 'PAYMENT_RECEIVED', 'INVOICE_PROCESSING', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED'))
);

CREATE INDEX idx_subscriptions_tenant_id ON subscriptions(tenant_id);
CREATE INDEX idx_subscriptions_invoice_document_id ON subscriptions(invoice_document_id);

CREATE TABLE payments (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  subscription_id  UUID NOT NULL REFERENCES subscriptions(id),
  status           VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  amount           DECIMAL(14,2) NOT NULL,
  method           VARCHAR(20) NOT NULL DEFAULT 'SPI_TRANSFER',
  reported_at      TIMESTAMPTZ,
  verified_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_payments_status
    CHECK (status IN ('PENDING', 'REPORTED', 'VERIFIED', 'REJECTED', 'REFUNDED')),
  CONSTRAINT chk_payments_method
    CHECK (method IN ('SPI_TRANSFER'))
);

CREATE INDEX idx_payments_subscription_id ON payments(subscription_id);

-- set_updated_at() already exists (migration 051).
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Extend tenant_events with subscription/payment lifecycle event types.
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
      'SUBSCRIPTION_CANCELLED'
    ));

COMMIT;
