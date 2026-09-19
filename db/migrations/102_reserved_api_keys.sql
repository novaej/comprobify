-- Separates comprobify-web's own operational keys/endpoints from a tenant's
-- self-service maxApiKeys/maxWebhookEndpoints budget (ADR-034).
ALTER TABLE api_keys ADD COLUMN is_reserved BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE webhook_endpoints ADD COLUMN is_reserved BOOLEAN NOT NULL DEFAULT false;

-- Backfill by the only label patterns register()/recover()/mintManagedKey() have ever used.
UPDATE api_keys SET is_reserved = true
WHERE label = 'Initial master key' OR label = 'Recovery key' OR label LIKE 'App — %';

-- Backfill by comprobify-web's fixed canonical-webhook URL suffix.
UPDATE webhook_endpoints SET is_reserved = true
WHERE url LIKE '%/api/webhooks/receive';
