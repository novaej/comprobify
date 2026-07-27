-- Denormalized debug/admin-query column, mirroring why tenant_id was already
-- included in pending_effects from the start (migration 075's comment):
-- "so admin tooling/debugging can filter without parsing per-type JSONB
-- payload shapes." NOTIFICATION_DISPATCH's payload is just { notificationId }
-- (ADR-024) — without this column, answering "what notification types are
-- pending/failed right now" requires joining out to `notifications` for
-- every row. notification_type is a snapshot of notifications.type taken
-- once at enqueue time (safe: notifications.type is never updated after
-- creation) — purely informational, never read by the NOTIFICATION_DISPATCH
-- handler itself, which still re-fetches the real notification row as the
-- source of truth (same "handlers re-fetch fresh rows" convention every
-- other handler in src/effects/index.js follows).
--
-- NULL for every effect type other than NOTIFICATION_DISPATCH — same
-- "nullable, only one effect type populates it" shape as dedup_key
-- (only SRI_AUTHORIZE populates that one).

BEGIN;

ALTER TABLE pending_effects ADD COLUMN notification_type TEXT;

CREATE INDEX idx_pending_effects_notification_type ON pending_effects (notification_type)
  WHERE notification_type IS NOT NULL;

COMMIT;
