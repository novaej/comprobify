-- Add IVA tracking columns to payments so every payment carries a full audit
-- trail of the tax breakdown at the time it was created.
--
-- amount       = base imponible (pre-IVA taxable amount, what goes on the SRI invoice)
-- iva_rate     = the IVA rate in effect when the payment row was created (e.g. 0.15)
-- iva_amount   = IVA charged (amount × iva_rate)
-- total_amount = amount + iva_amount (what the tenant actually transfers via SPI)
--
-- Backfill: existing rows had `amount` = IVA-inclusive total (old pricing had no
-- IVA split). Treat them as total, derive the base and IVA at 15%, and restate
-- `amount` as base so the column is consistent going forward.

ALTER TABLE payments
  ADD COLUMN iva_rate     NUMERIC(5,4),
  ADD COLUMN iva_amount   NUMERIC(10,2),
  ADD COLUMN total_amount NUMERIC(10,2);

UPDATE payments
SET
  iva_rate     = 0.15,
  iva_amount   = ROUND(amount * 0.15 / 1.15, 2),
  total_amount = amount,
  amount       = amount - ROUND(amount * 0.15 / 1.15, 2)
WHERE iva_rate IS NULL;
