-- Adds three new subscription tiers: SOLO and LITE below STARTER (closing
-- the entry-price gap against local competitors — see docs/pricing
-- analysis), and ENTERPRISE above BUSINESS (uncapped document volume via a
-- large sentinel quota, not a schema-level NULL — see subscription-tiers.js).
--
-- Every tier's non-price shape (documentQuota, maxBranches, rate limits,
-- allowedDocumentTypes, overagePerDocumentUsd) lives in
-- src/constants/subscription-tiers.js, unchanged by this migration — only
-- the tier *name* needs to be accepted by the DB, and only price needs a
-- tier_prices row (see CLAUDE.md's "Price history + 30-day change notice").
--
-- While widening chk_subscriptions_tier/chk_subscriptions_pending_tier, this
-- also fixes a pre-existing bug: scheduleCancellation() sets
-- pending_tier = 'FREE' and applyScheduledTierChanges() later writes
-- tier = 'FREE' via applyTierChange() (see subscription.service.js), but
-- neither constraint has ever allowed 'FREE' — every subscription
-- cancellation has been failing its UPDATE with a CHECK violation since
-- migration 055 introduced these constraints. Fixed here since both
-- constraints are already being touched for the new tier names.

BEGIN;

ALTER TABLE tenants
  DROP CONSTRAINT tenants_subscription_tier_check,
  ADD CONSTRAINT tenants_subscription_tier_check
    CHECK (subscription_tier IN ('FREE', 'SOLO', 'LITE', 'STARTER', 'GROWTH', 'BUSINESS', 'ENTERPRISE'));

ALTER TABLE subscriptions
  DROP CONSTRAINT chk_subscriptions_tier,
  ADD CONSTRAINT chk_subscriptions_tier
    CHECK (tier IN ('FREE', 'SOLO', 'LITE', 'STARTER', 'GROWTH', 'BUSINESS', 'ENTERPRISE')),
  DROP CONSTRAINT chk_subscriptions_pending_tier,
  ADD CONSTRAINT chk_subscriptions_pending_tier
    CHECK (pending_tier IS NULL OR pending_tier IN ('FREE', 'SOLO', 'LITE', 'STARTER', 'GROWTH', 'BUSINESS', 'ENTERPRISE'));

-- payments.target_tier never needs 'FREE' — cancelling to FREE never opens a
-- payment (nothing owed to downgrade), so only the paid tiers are ever
-- written here.
ALTER TABLE payments
  DROP CONSTRAINT chk_payments_target_tier,
  ADD CONSTRAINT chk_payments_target_tier
    CHECK (target_tier IS NULL OR target_tier IN ('SOLO', 'LITE', 'STARTER', 'GROWTH', 'BUSINESS', 'ENTERPRISE'));

ALTER TABLE tier_prices
  DROP CONSTRAINT chk_tier_prices_tier,
  ADD CONSTRAINT chk_tier_prices_tier
    CHECK (tier IN ('FREE', 'SOLO', 'LITE', 'STARTER', 'GROWTH', 'BUSINESS', 'ENTERPRISE'));

-- Published immediately (effective now, not backdated to the 076 launch
-- seed — these tiers are genuinely new). Prices are the tax-EXCLUSIVE
-- sticker price, same convention every existing tier_prices row now uses
-- (see subscription.service.js's breakdownAmount and tiers.controller.js).
--
-- SOLO has no MONTHLY row — it's yearly-only (subscription-tiers.js's
-- billingIntervals: ['YEARLY']), enforced in application code by
-- subscription.service.js's assertBillingIntervalAllowed(). A MONTHLY row
-- here would just be dead data nothing can ever resolve a purchase against.
INSERT INTO tier_prices (tier, billing_interval, price_usd, status, effective_at, published_at) VALUES
  ('SOLO',       'YEARLY',  25,    'PUBLISHED', NOW(), NOW()),
  ('LITE',       'MONTHLY', 8,     'PUBLISHED', NOW(), NOW()),
  ('LITE',       'YEARLY',  80,    'PUBLISHED', NOW(), NOW()),
  ('ENTERPRISE', 'MONTHLY', 450,   'PUBLISHED', NOW(), NOW()),
  ('ENTERPRISE', 'YEARLY',  4500,  'PUBLISHED', NOW(), NOW());

COMMIT;
