-- Extra user seats: a paid, quantity-based add-on that raises a tenant's
-- dashboard-seat cap (TIERS[tier].maxUsers, comprobify-web-enforced only —
-- see src/constants/tier-limit-scope.js / ADR-031) above the tier's included
-- count. comprobify still never enforces seats itself (no user/session
-- concept exists here at all); this migration only lets it bill for them
-- through the existing subscription/payment pipeline. See ADR-032.
--
-- Deliberately NOT a pseudo-tier row inside tier_prices: chk_tier_prices_tier,
-- pricing.service.js's assertValidTierAndInterval, and admin.validator.js's
-- tier-price validators all hard-validate `tier` against the real TIERS
-- object, and a pseudo-tier would risk leaking into chk_subscriptions_tier /
-- tenants_subscription_tier_check / chk_payments_target_tier, which every
-- tier-transition code path assumes only ever hold real, sellable tiers.
-- seat_prices mirrors tier_prices' exact DRAFT/PUBLISHED/as-of-date shape,
-- just without a `tier` column, since the price is flat across every tier.
--
-- Seat cost rides the tenant's own tier renewal payment (one combined
-- invoice per period, not a parallel seat billing cycle) — payments.amount
-- is one combined number with no line-item breakdown, so seats_charged is an
-- audit snapshot of how many seats' cost is baked into a given payment row:
-- a DELTA on SEAT_CHANGE (the count being newly purchased), the EFFECTIVE
-- TOTAL on RENEWAL and an interval-change TIER_CHANGE (the count already
-- being carried forward), 0 on INITIAL and an ordinary same-interval
-- TIER_CHANGE (neither ever includes seat cost).
--
-- subscriptions/payments are public-only (not sandbox-mirrored), same
-- precedent already noted in migration 052's own header.
--
-- Notifications for the 30-day seat-price-change notice reuse the existing
-- mandatory PRICE_CHANGE_ANNOUNCED type (distinguished by
-- metadata->>'seatPriceId' vs metadata->>'tierPriceId') rather than adding a
-- 6th email-capable notification type — this migration deliberately does
-- NOT touch chk_notifications_type / chk_notification_preferences_type /
-- chk_notification_email_templates_type.

BEGIN;

ALTER TABLE subscriptions
  ADD COLUMN extra_seats INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT chk_subscriptions_extra_seats CHECK (extra_seats >= 0),
  ADD COLUMN pending_extra_seats INTEGER,
  ADD CONSTRAINT chk_subscriptions_pending_extra_seats
    CHECK (pending_extra_seats IS NULL OR pending_extra_seats >= 0);

-- target_extra_seats: the new TOTAL seat count being purchased (mirrors
-- target_tier) — only ever set on an increase, since a decrease never opens
-- a payment (see subscription.service.js's requestSeatChange).
ALTER TABLE payments
  ADD COLUMN target_extra_seats INTEGER,
  ADD CONSTRAINT chk_payments_target_extra_seats
    CHECK (target_extra_seats IS NULL OR target_extra_seats >= 0),
  ADD COLUMN seats_charged INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT chk_payments_seats_charged CHECK (seats_charged >= 0),
  DROP CONSTRAINT chk_payments_purpose,
  ADD CONSTRAINT chk_payments_purpose
    CHECK (purpose IN ('INITIAL', 'TIER_CHANGE', 'RENEWAL', 'SEAT_CHANGE'));

CREATE TABLE seat_prices (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  billing_interval TEXT          NOT NULL,
  price_usd        NUMERIC(10,2) NOT NULL,
  status           TEXT          NOT NULL DEFAULT 'DRAFT',
  effective_at     TIMESTAMPTZ,
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_seat_prices_billing_interval CHECK (billing_interval IN ('MONTHLY', 'YEARLY')),
  CONSTRAINT chk_seat_prices_status CHECK (status IN ('DRAFT', 'PUBLISHED')),
  CONSTRAINT chk_seat_prices_price_usd CHECK (price_usd >= 0)
);

CREATE TRIGGER trg_seat_prices_updated_at
  BEFORE UPDATE ON seat_prices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_seat_prices_resolve ON seat_prices (billing_interval, effective_at DESC)
  WHERE status = 'PUBLISHED';

-- Published immediately, effective now (mirrors migration 093's SOLO/LITE/
-- ENTERPRISE seeding, not 076's backdated launch seed) — this is a genuinely
-- new offering, so there is no existing tenant paying a different price and
-- no notice is owed on the initial seed. $5/mo, $50/yr (the same x10
-- yearly-discount convention every other tier already uses).
INSERT INTO seat_prices (billing_interval, price_usd, status, effective_at, published_at) VALUES
  ('MONTHLY', 5,  'PUBLISHED', NOW(), NOW()),
  ('YEARLY',  50, 'PUBLISHED', NOW(), NOW());

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
      'CERTIFICATE_RENEWED',
      'SEAT_CHANGE_REQUESTED',
      'SEAT_CHANGE_SCHEDULED',
      'SEAT_COUNT_CHANGED'
    ));

COMMIT;
