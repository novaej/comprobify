-- Extends tier changes to also support billing-interval changes (e.g. monthly
-- STARTER -> yearly GROWTH, or monthly GROWTH -> yearly STARTER). Any change
-- to billing_interval is deferred to current_period_end and billed at the new
-- tier+interval's full sticker price — no cross-interval proration. See
-- subscription.service.js requestTierChange / applyTierChangeIfLinked /
-- applyScheduledTierChanges.

BEGIN;

ALTER TABLE subscriptions
  ADD COLUMN pending_billing_interval VARCHAR(10),
  ADD CONSTRAINT chk_subscriptions_pending_billing_interval
    CHECK (pending_billing_interval IS NULL OR pending_billing_interval IN ('MONTHLY', 'YEARLY'));

ALTER TABLE payments
  ADD COLUMN target_billing_interval VARCHAR(10),
  ADD CONSTRAINT chk_payments_target_billing_interval
    CHECK (target_billing_interval IS NULL OR target_billing_interval IN ('MONTHLY', 'YEARLY'));

COMMIT;
