-- Persistent, daily-granularity usage tracking per API key (NEXT_STEPS
-- "API Key Usage Tracking"). One row per (key, day) is the single source of
-- truth for both lifetime totals (aggregated on read) and a day-by-day chart
-- — avoids maintaining a separate lifetime counter that could drift out of
-- sync, and still costs exactly one write per request (an upsert on this
-- table, fired from authenticate.js).

BEGIN;

CREATE TABLE api_key_daily_usage (
  api_key_id UUID NOT NULL REFERENCES api_keys(id),
  usage_date DATE NOT NULL,
  request_count BIGINT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (api_key_id, usage_date)
);

COMMIT;
