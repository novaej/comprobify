-- A short, human-typable identifier for a payment, distinct from its UUID
-- `id`. The tenant is expected to write this in the description/glosa field
-- of their SPI transfer, and the operator matches it against the bank
-- statement — a UUID is impractical for either side to hand-copy. Not a
-- security token: no auth or lookup capability derives from it, so plain
-- random() (not the pgcrypto/gen_random_bytes route uuid_generate_v7() uses)
-- is sufficient.
--
-- 8 characters from a 31-symbol alphabet (~39.3 bits of entropy) is ample at
-- Comprobify's billing volume (subscriptions/payments, not documents) — no
-- collision-retry loop, same reasoning as uuid_generate_v7()'s much larger
-- space. Excludes 0/O, 1/I/L and vowel-adjacent lookalikes so a
-- hand-transcribed code stays unambiguous; 'CB-' prefix makes it recognizable
-- as a Comprobify code amid other text in a bank statement.
CREATE OR REPLACE FUNCTION generate_payment_code()
RETURNS TEXT AS $$
DECLARE
  alphabet TEXT := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  code TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..8 LOOP
    code := code || substr(alphabet, (floor(random() * length(alphabet)) + 1)::int, 1);
  END LOOP;
  RETURN 'CB-' || code;
END;
$$ LANGUAGE plpgsql VOLATILE;

ALTER TABLE payments ADD COLUMN payment_code TEXT;

UPDATE payments SET payment_code = generate_payment_code() WHERE payment_code IS NULL;

ALTER TABLE payments ALTER COLUMN payment_code SET NOT NULL;
ALTER TABLE payments ALTER COLUMN payment_code SET DEFAULT generate_payment_code();
ALTER TABLE payments ADD CONSTRAINT payments_payment_code_key UNIQUE (payment_code);
