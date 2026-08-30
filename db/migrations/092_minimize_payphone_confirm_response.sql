-- Payphone's confirm response carries the payer's email, phone and cedula. We
-- use none of it — everything the code reads is money, status or card
-- metadata — so retaining it indefinitely is data we never had a purpose for.
-- payphone.service.js now filters the response to an allow-list at the vendor
-- boundary; this scrubs the rows written before that existed, and renames the
-- column, which no longer holds anything raw.

-- Same allow-list as PERSISTED_FIELDS in src/services/payphone.service.js.
-- Keep the two in step: a field added there and not here is simply absent from
-- older rows, which is fine, but the reverse leaves PII behind.
UPDATE payphone_transactions
SET raw_confirm_response = COALESCE(
  (
    SELECT jsonb_object_agg(key, value)
    FROM jsonb_each(raw_confirm_response)
    WHERE key IN (
      'transactionId', 'clientTransactionId', 'statusCode', 'transactionStatus',
      'authorizationCode', 'message', 'messages', 'errorCode', 'errors',
      'amount', 'amountWithTax', 'amountWithoutTax', 'tax', 'service', 'tip', 'currency',
      'cardBrand', 'cardType', 'lastDigits',
      'storeName', 'reference', 'date', 'transactionDate',
      'deferredCode', 'deferredMessage', 'deferredType', 'regionalReference'
    )
  ),
  '{}'::jsonb
)
WHERE raw_confirm_response IS NOT NULL;

ALTER TABLE payphone_transactions RENAME COLUMN raw_confirm_response TO confirm_response;

COMMENT ON COLUMN payphone_transactions.confirm_response IS
  'Payphone confirm response, filtered to an allow-list by payphone.service.js. Never stores payer identity fields.';
