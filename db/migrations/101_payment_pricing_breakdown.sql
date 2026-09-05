-- Frontend/email-facing breakdown of how a TIER_CHANGE or SEAT_CHANGE
-- payment's amount was computed (new plan price, seats cost, credit for
-- unused time on the previous plan, etc.) — captured once at creation time
-- so it can be shown later exactly as computed, rather than recomputed from
-- (possibly since-changed) pricing data. Nullable: INITIAL/RENEWAL payments
-- never set it (a flat sticker price needs no breakdown), and older
-- TIER_CHANGE/SEAT_CHANGE rows predate this column.
ALTER TABLE payments ADD COLUMN pricing_breakdown JSONB;
