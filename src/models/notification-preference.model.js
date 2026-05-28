/**
 * Notification preference model.
 *
 * Rows are created on first write (opt-out model). If no row exists for a
 * (tenant_id, type) pair, the notification is treated as enabled by default.
 * Only explicit `enabled = false` rows suppress a notification type.
 */
const db = require('../config/database');

/**
 * Return all stored preferences for a tenant as a plain object keyed by type.
 * Types with no row are absent from the result — callers default them to true.
 *
 * @param {number} tenantId
 * @returns {Promise<Record<string, boolean>>}  e.g. { DOCUMENT_AUTHORIZED: false }
 */
async function findByTenantId(tenantId) {
  const { rows } = await db.query(
    'SELECT type, enabled FROM notification_preferences WHERE tenant_id = $1',
    [tenantId]
  );
  return Object.fromEntries(rows.map(r => [r.type, r.enabled]));
}

/**
 * Check whether a single notification type is enabled for a tenant.
 * Returns true when no preference row exists (opt-out default).
 *
 * @param {number} tenantId
 * @param {string} type
 * @returns {Promise<boolean>}
 */
async function isEnabled(tenantId, type) {
  const { rows } = await db.query(
    'SELECT enabled FROM notification_preferences WHERE tenant_id = $1 AND type = $2',
    [tenantId, type]
  );
  // No row → enabled by default
  return rows.length === 0 ? true : rows[0].enabled;
}

/**
 * Upsert multiple preferences in one statement.
 *
 * @param {number} tenantId
 * @param {{ type: string, enabled: boolean }[]} updates
 */
async function upsertMany(tenantId, updates) {
  if (updates.length === 0) return;

  // Build a multi-row VALUES clause:  ($1,$2,$3), ($1,$4,$5), ...
  const values = [tenantId];
  const placeholders = updates.map(({ type, enabled }, i) => {
    values.push(type, enabled);
    const base = 2 + i * 2; // $2,$3  then $4,$5  ...
    return `($1, $${base}, $${base + 1})`;
  });

  await db.query(
    `INSERT INTO notification_preferences (tenant_id, type, enabled, updated_at)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (tenant_id, type) DO UPDATE
       SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
    values
  );
}

module.exports = { findByTenantId, isEnabled, upsertMany };
