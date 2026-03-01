-- Update IVA rate codes to match current SRI parametrization.
--
-- SRI codigoPorcentaje for tax code 2 (IVA):
--   0  →  0%
--   2  → 12%   (was incorrectly seeded as 15%)
--   3  → 14%   (historical)
--   4  → 15%   (new — missing from initial seed)
--   5  →  5%   (new — missing from initial seed)
--   6  → No objeto de IVA
--   7  → Exento de IVA
--   8  → IVA diferenciado (new — missing from initial seed)
--  10  → 13%   (new — missing from initial seed)

-- Fix: rate_code 2 is 12%, not 15%
UPDATE cat_tax_rates
SET description = '12%', rate = 12.00
WHERE tax_code = '2' AND rate_code = '2';

-- Add missing rate codes
INSERT INTO cat_tax_rates (tax_code, rate_code, description, rate) VALUES
    ('2', '4',  '15%',              15.00),
    ('2', '5',  '5%',               5.00),
    ('2', '8',  'IVA diferenciado', 0.00),
    ('2', '10', '13%',              13.00)
ON CONFLICT (tax_code, rate_code) DO NOTHING;
