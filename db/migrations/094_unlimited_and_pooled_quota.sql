-- Two independent quota changes bundled together since both touch
-- tenant_quotas and ship in the same release:
--
-- 1. Unlimited tier support. ENTERPRISE used to set documentQuota to a large
--    sentinel (100000) instead of genuine unlimited, because
--    tenant_quotas.document_quota was NOT NULL and the atomic quota gate
--    (incrementIfWithinCap) compared document_count < document_quota
--    directly. Making the column nullable, with NULL meaning "never block",
--    is the real fix — see subscription-tiers.js's ENTERPRISE entry.
--
-- 2. Pooled annual quota for YEARLY subscribers. Quota has always reset on
--    its own independent monthly clock regardless of billing_interval (see
--    CLAUDE.md's old "Yearly billing" text) — a YEARLY subscriber paid once
--    for a full year but only ever got documentQuota per month, with no
--    rollover. tenant_quotas gains its own billing_interval column so a
--    quota period's own length/cap can track it: MONTHLY periods stay
--    exactly as they are today (1 month, documentQuota), but a YEARLY
--    period becomes a single 12-month window sized documentQuota × 12 —
--    consumable unevenly across the year, not reset every 30 days. See
--    ADR-029 and src/services/tenant-quota.service.js's capForTier()/
--    periodMonthsForTier().
--
-- billing_interval defaults to 'MONTHLY' so every existing row (all seeded
-- under the old always-monthly design) keeps behaving exactly as before.

BEGIN;

ALTER TABLE tenant_quotas ALTER COLUMN document_quota DROP NOT NULL;

ALTER TABLE tenant_quotas
  ADD COLUMN billing_interval VARCHAR(10) NOT NULL DEFAULT 'MONTHLY'
    CHECK (billing_interval IN ('MONTHLY', 'YEARLY'));

COMMIT;
