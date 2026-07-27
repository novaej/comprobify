-- Tier price history + 30-day change notice (NEXT_STEPS.md item 12, ADR-023).
--
-- TIERS[tier].priceMonthlyUsd/priceYearlyUsd (src/constants/subscription-tiers.js)
-- used to be plain hardcoded numbers with no history — changing one would
-- reprice every tenant's very next renewal, including one due tomorrow, with
-- no notification of any kind. tier_prices makes price changes historical:
-- "the current price for tier X as of date D" is always the newest PUBLISHED
-- row whose effective_at <= D (same "newest row wins" idiom as agreements'
-- is_current, just derived by a date comparison instead of a boolean flag —
-- no promotion job needed to flip a row from "scheduled" to "current").
--
-- Everything else on a tier (documentQuota, maxBranches, rate limits,
-- allowedDocumentTypes, overagePerDocumentUsd) deliberately stays in
-- subscription-tiers.js — only prices need historical/notice-period
-- resolution, those fields just take effect whenever an admin changes them.
--
-- status: DRAFT (admin is still editing, not visible to tenants, no notice
-- clock running) -> PUBLISHED (confirmed; effective_at/published_at set,
-- price-change notifications fired). No further states — once published a
-- row is immutable, same as an agreements version.
CREATE TABLE tier_prices (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  tier             TEXT          NOT NULL,
  billing_interval TEXT          NOT NULL,
  price_usd        NUMERIC(10,2) NOT NULL,
  status           TEXT          NOT NULL DEFAULT 'DRAFT',
  effective_at     TIMESTAMPTZ,
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_tier_prices_tier CHECK (tier IN ('FREE', 'STARTER', 'GROWTH', 'BUSINESS')),
  CONSTRAINT chk_tier_prices_billing_interval CHECK (billing_interval IN ('MONTHLY', 'YEARLY')),
  CONSTRAINT chk_tier_prices_status CHECK (status IN ('DRAFT', 'PUBLISHED')),
  CONSTRAINT chk_tier_prices_price_usd CHECK (price_usd >= 0)
);

CREATE TRIGGER trg_tier_prices_updated_at
  BEFORE UPDATE ON tier_prices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Drives both the "current price as of date D" resolver and the "what's
-- upcoming" lookup (GET /v1/tiers transparency) — only PUBLISHED rows are
-- ever queried by either.
CREATE INDEX idx_tier_prices_resolve ON tier_prices (tier, billing_interval, effective_at DESC)
  WHERE status = 'PUBLISHED';

-- Seed one PUBLISHED row per (tier, interval) at today's hardcoded values,
-- effective in the past, so every existing tenant resolves a price
-- immediately with no gap. Mirrors the values in subscription-tiers.js at
-- the time of this migration.
INSERT INTO tier_prices (tier, billing_interval, price_usd, status, effective_at, published_at) VALUES
  ('FREE',     'MONTHLY', 0,   'PUBLISHED', '2020-01-01', '2020-01-01'),
  ('FREE',     'YEARLY',  0,   'PUBLISHED', '2020-01-01', '2020-01-01'),
  ('STARTER',  'MONTHLY', 20,  'PUBLISHED', '2020-01-01', '2020-01-01'),
  ('STARTER',  'YEARLY',  200, 'PUBLISHED', '2020-01-01', '2020-01-01'),
  ('GROWTH',   'MONTHLY', 90,  'PUBLISHED', '2020-01-01', '2020-01-01'),
  ('GROWTH',   'YEARLY',  900, 'PUBLISHED', '2020-01-01', '2020-01-01'),
  ('BUSINESS', 'MONTHLY', 230, 'PUBLISHED', '2020-01-01', '2020-01-01'),
  ('BUSINESS', 'YEARLY',  2300,'PUBLISHED', '2020-01-01', '2020-01-01');

-- No idempotency ledger table for the price-change notification fan-out —
-- PRICE_CHANGE_ANNOUNCED is "mandatory" (NEXT_STEPS.md item 13): it cannot be
-- individually subscribed to, so its notifications row is created
-- unconditionally, which makes the notifications table itself a safe,
-- always-accurate idempotency source (pricingService.notifyPendingPriceChangesForTenant
-- checks notifications directly: type='PRICE_CHANGE_ANNOUNCED' AND
-- metadata->>'tierPriceId'). This wouldn't work for a normal, subscribable
-- type — an opted-out tenant would never get a row and would look
-- permanently "not yet notified" — but a mandatory type has no such gate.
-- Item 13 generalizes this "notifications row creation is unconditional"
-- property to every type; PRICE_CHANGE_ANNOUNCED is the first to adopt it.
--
-- Because the row is created synchronously inside notifyPendingPriceChangesForTenant
-- (not via a queued effect — see pricing.service.js), there's no async gap
-- between "checked as pending" and "marked as handled" that a repeated
-- reconciliation pass could race. Only PRICE_CHANGE_EMAIL is queued —
-- an in-app row is a fast local insert with nothing to retry, unlike an
-- outbound email, and this function's own idempotent, periodically-retried
-- design already self-heals a transient failure on the next pass.

-- Add PRICE_CHANGE_ANNOUNCED to the notifications type CHECK constraint only
-- — deliberately NOT added to notification_preferences' constraint, since a
-- mandatory type must never have a preference row at all (enforced again at
-- the validator layer, src/routes/notifications.routes.js).
ALTER TABLE notifications
  DROP CONSTRAINT chk_notifications_type,
  ADD CONSTRAINT chk_notifications_type
    CHECK (
      type IN (
        'DOCUMENT_AUTHORIZED',
        'CERT_EXPIRING',
        'CERT_EXPIRED',
        'SRI_SUBMISSION_FAILED',
        'EMAIL_DELIVERY_FAILED',
        'QUOTA_WARNING',
        'PAYMENT_VERIFIED',
        'PAYMENT_REJECTED',
        'SUBSCRIPTION_RENEWAL_DUE',
        'SUBSCRIPTION_EXPIRED',
        'PRICE_CHANGE_ANNOUNCED'
      )
    );

-- Add PRICE_CHANGE_EMAIL to the pending_effects outbox's type CHECK
-- constraint (CLAUDE.md Common Mistake #12/#19 pattern). No
-- PRICE_CHANGE_NOTIFICATION type — the in-app notification is created
-- synchronously, not queued, see above.
ALTER TABLE pending_effects
  DROP CONSTRAINT chk_pending_effects_type,
  ADD CONSTRAINT chk_pending_effects_type
    CHECK (
      effect_type IN (
        'SRI_SEND',
        'SRI_AUTHORIZE',
        'DOCUMENT_AUTHORIZED_NOTIFICATION',
        'INVOICE_AUTHORIZED_EMAIL',
        'TENANT_AGREEMENT_GENERATE',
        'VERIFICATION_EMAIL_SEND',
        'WEBHOOK_FANOUT',
        'PAYMENT_REVIEWED_NOTIFICATION',
        'PAYMENT_REVIEWED_EMAIL',
        'PAYMENT_PROOF_SUBMITTED_EMAIL',
        'SUBSCRIPTION_RENEWAL_DUE_NOTIFICATION',
        'SUBSCRIPTION_RENEWAL_DUE_EMAIL',
        'SUBSCRIPTION_EXPIRED_NOTIFICATION',
        'SUBSCRIPTION_EXPIRED_EMAIL',
        'PRICE_CHANGE_EMAIL'
      )
    );
