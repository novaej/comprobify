-- Per-channel notification preferences (NEXT_STEPS.md item 13, ADR-024).
--
-- notification_preferences used to be one row per (tenant_id, type) with a
-- single `enabled` flag — but that flag only ever meant "in-app," since
-- email sending (where it existed at all) was never gated by it. Splitting
-- into a channel column lets a tenant opt out of email without losing
-- in-app visibility, or vice versa, and is what makes "mandatory" types
-- (PRICE_CHANGE_ANNOUNCED) meaningful: they simply never get a row on
-- either channel.
--
-- Backfilling every existing row as channel='IN_APP' is exactly correct,
-- not a lossy approximation — see the reasoning above.
ALTER TABLE notification_preferences
  ADD COLUMN channel TEXT NOT NULL DEFAULT 'IN_APP';

ALTER TABLE notification_preferences
  DROP CONSTRAINT notification_preferences_pkey,
  ADD PRIMARY KEY (tenant_id, type, channel);

ALTER TABLE notification_preferences
  ADD CONSTRAINT chk_notification_preferences_channel CHECK (channel IN ('EMAIL', 'IN_APP'));

-- Every future row must specify a channel explicitly — the default above
-- only exists to backfill pre-existing rows correctly.
ALTER TABLE notification_preferences ALTER COLUMN channel DROP DEFAULT;
