-- Decouples comprobify-web's own operational keys/endpoints (master key,
-- per-role keys, its own webhook subscription) from a tenant's self-service
-- maxApiKeys/maxWebhookEndpoints budget, closing the loophole where the
-- RESERVED_*_FOR_FRONTEND headroom was technically self-mintable by any
-- tenant holding a valid key, regardless of their tier's own pool (ADR-034).
ALTER TABLE api_keys ADD COLUMN is_reserved BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE webhook_endpoints ADD COLUMN is_reserved BOOLEAN NOT NULL DEFAULT false;

-- Backfill: these are the only label patterns registration.service.js
-- (register()/recover()) and comprobify-web's mintManagedKey() have ever
-- used, so this is a complete, safe backfill with no frontend coordination.
UPDATE api_keys SET is_reserved = true
WHERE label = 'Initial master key' OR label = 'Recovery key' OR label LIKE 'App — %';

-- comprobify-web's activateCanonicalWebhookAction() always registers its own
-- webhook at `${NEXT_PUBLIC_APP_URL}/api/webhooks/receive` — the base URL
-- differs per deployment (staging vs. production), but this suffix is fixed,
-- so matching on it backfills every existing tenant's canonical webhook
-- without needing frontend coordination, same as the api_keys backfill above.
UPDATE webhook_endpoints SET is_reserved = true
WHERE url LIKE '%/api/webhooks/receive';
