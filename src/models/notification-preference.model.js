/**
 * Notification preference model — per (tenant_id, type, channel), migration 077.
 *
 * Rows are created on first write (opt-out model). If no row exists for a
 * (tenant_id, type, channel) triple, that channel is treated as enabled by
 * default. Only explicit `enabled = false` rows suppress it. "Mandatory"
 * types (notification-catalog.js) never have a row at all — enforced at the
 * validator layer, src/routes/notifications.routes.js.
 */
const db = require('../config/database');

/**
 * Return all stored preferences for a tenant as a nested map.
 * Entries with no row are absent — callers default them to true.
 *
 * @param {number} tenantId
 * @returns {Promise<Record<string, Record<string, boolean>>>}  e.g. { PAYMENT_VERIFIED: { EMAIL: false } }
 */
async function findByTenantId(tenantId) {
  const { rows } = await db.query(
    'SELECT type, channel, enabled FROM notification_preferences WHERE tenant_id = $1',
    [tenantId]
  );
  const result = {};
  for (const row of rows) {
    if (!result[row.type]) result[row.type] = {};
    result[row.type][row.channel] = row.enabled;
  }
  return result;
}

/**
 * Check whether a single (type, channel) is enabled for a tenant.
 * Returns true when no preference row exists (opt-out default).
 *
 * @param {number} tenantId
 * @param {string} type
 * @param {string} channel - NotificationChannel value ('EMAIL' | 'IN_APP')
 * @returns {Promise<boolean>}
 */
async function isEnabled(tenantId, type, channel) {
  const { rows } = await db.query(
    'SELECT enabled FROM notification_preferences WHERE tenant_id = $1 AND type = $2 AND channel = $3',
    [tenantId, type, channel]
  );
  // No row → enabled by default
  return rows.length === 0 ? true : rows[0].enabled;
}

/**
 * Upsert multiple preferences in one statement.
 *
 * @param {number} tenantId
 * @param {{ type: string, channel: string, enabled: boolean }[]} updates
 */
async function upsertMany(tenantId, updates) {
  if (updates.length === 0) return;

  // Build a multi-row VALUES clause:  ($1,$2,$3,$4), ($1,$5,$6,$7), ...
  const values = [tenantId];
  const placeholders = updates.map(({ type, channel, enabled }, i) => {
    values.push(type, channel, enabled);
    const base = 2 + i * 3; // $2,$3,$4  then $5,$6,$7  ...
    return `($1, $${base}, $${base + 1}, $${base + 2}, NOW())`;
  });

  await db.query(
    `INSERT INTO notification_preferences (tenant_id, type, channel, enabled, updated_at)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (tenant_id, type, channel) DO UPDATE
       SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
    values
  );
}

module.exports = { findByTenantId, isEnabled, upsertMany };
