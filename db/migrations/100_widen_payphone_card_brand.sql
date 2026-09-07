-- payphone_transactions.card_brand (VARCHAR(30), migration 091) and
-- .authorization_code (VARCHAR(50)) are both vendor-controlled display data
-- echoed back from Payphone's confirm response — not something this
-- codebase validates or constrains the shape of. A real confirm response's
-- card_brand exceeded 30 characters and threw `22001 value too long for
-- type character varying(30)` from inside resolveOutcome(), crashing an
-- otherwise-successful card payment confirmation. Both widened to TEXT
-- rather than guessing a new arbitrary cap — there is no length guarantee
-- from Payphone's side to size a VARCHAR against. card_last_digits is left
-- alone: it's structurally bounded (the last few digits of a card number)
-- in a way these two free-text fields are not.
ALTER TABLE payphone_transactions
  ALTER COLUMN card_brand TYPE TEXT,
  ALTER COLUMN authorization_code TYPE TEXT;
