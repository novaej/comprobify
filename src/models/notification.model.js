/**
 * Notification model.
 *
 * Notifications are tenant-scoped, not issuer-scoped. They use db.query() directly
 * (no RLS context, no search_path override) — the same pattern as tenant_events.
 */
const db = require('../config/database');

/**
 * Create a new notification row.
 *
 * @param {object} params
 * @param {number}      params.tenantId
 * @param {number|null} params.issuerId   - null for tenant-level notifications
 * @param {string}      params.type       - NotificationTypes value
 * @param {string}      params.severity   - NotificationSeverity value
 * @param {string}      params.title
 * @param {string}      params.message
 * @param {object|null} params.metadata   - arbitrary JSON for the client
 * @param {Date|null}   params.expiresAt
 */
async function create({ tenantId, issuerId = null, type, severity, title, message, metadata = null, expiresAt = null }) {
  const { rows } = await db.query(
    `INSERT INTO notifications (tenant_id, issuer_id, type, severity, title, message, metadata, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [tenantId, issuerId, type, severity, title, message, metadata ? JSON.stringify(metadata) : null, expiresAt]
  );
  return rows[0];
}

/**
 * Find a notification by id (no tenant scoping — used internally by the
 * webhook fan-out service which already has the tenant context).
 *
 * @param {number} id
 */
async function findById(id) {
  const { rows } = await db.query(
    `SELECT * FROM notifications WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Return active (unexpired) notifications for a tenant, newest first.
 * Both read and unread are included so the client can render a full history.
 *
 * @param {number}      tenantId
 * @param {number|null} issuerId - When provided, filters to notifications for
 *   that issuer plus tenant-level notifications (issuer_id IS NULL). When null,
 *   all tenant notifications are returned (admin / no-filter view).
 * @param {number|null} sinceId  - When provided, returns only notifications with
 *   id > sinceId (cursor-based catch-up after downtime).
 */
async function findActiveByTenantId(tenantId, issuerId = null, sinceId = null) {
  const conditions = ['tenant_id = $1', '(expires_at IS NULL OR expires_at > NOW())'];
  const values = [tenantId];
  let idx = 2;

  if (issuerId != null) {
    conditions.push(`(issuer_id = $${idx++} OR issuer_id IS NULL)`);
    values.push(issuerId);
  }

  if (sinceId != null) {
    conditions.push(`id > $${idx++}`);
    values.push(sinceId);
  }

  const { rows } = await db.query(
    `SELECT * FROM notifications
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT 100`,
    values
  );
  return rows;
}

/**
 * Find the most recent unread CERT_EXPIRING or CERT_EXPIRED notification for a
 * specific issuer. Used by the cert-check upsert logic to avoid creating duplicate
 * cert alerts while the previous one is still unread.
 */
async function findUnreadCertAlertByIssuer(tenantId, issuerId) {
  const { rows } = await db.query(
    `SELECT * FROM notifications
     WHERE tenant_id = $1
       AND issuer_id = $2
       AND type IN ('CERT_EXPIRING', 'CERT_EXPIRED')
       AND read_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId, issuerId]
  );
  return rows[0] || null;
}

/**
 * Update an existing cert alert in-place (type, severity, title, message, metadata).
 * Resets created_at so the refreshed alert surfaces at the top of the list.
 */
async function update(id, { type, severity, title, message, metadata }) {
  const { rows } = await db.query(
    `UPDATE notifications
     SET type = $2, severity = $3, title = $4, message = $5, metadata = $6, created_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, type, severity, title, message, metadata ? JSON.stringify(metadata) : null]
  );
  return rows[0] || null;
}

/**
 * Mark a single notification as read.
 * Returns the updated row, or null if the notification does not exist or belongs
 * to a different tenant (safe to convert to a 404 in the controller).
 */
async function markAsRead(id, tenantId) {
  const { rows } = await db.query(
    `UPDATE notifications
     SET read_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND read_at IS NULL
     RETURNING *`,
    [id, tenantId]
  );
  return rows[0] || null;
}

/**
 * Find the most recent unread DOCUMENT_AUTHORIZED notification for an issuer
 * that was created within the aggregation window. Used to batch multiple
 * rapid authorisations into a single notification row instead of one per invoice.
 *
 * @param {number} tenantId
 * @param {number} issuerId
 * @param {number} windowSeconds - seconds back from NOW() to search
 */
async function findPendingDocumentAuthorized(tenantId, issuerId, windowSeconds) {
  const { rows } = await db.query(
    `SELECT * FROM notifications
     WHERE tenant_id = $1
       AND issuer_id = $2
       AND type = 'DOCUMENT_AUTHORIZED'
       AND read_at IS NULL
       AND created_at > NOW() - (INTERVAL '1 second' * $3)
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId, issuerId, windowSeconds]
  );
  return rows[0] || null;
}

/**
 * Update an aggregated DOCUMENT_AUTHORIZED notification in-place.
 * Does NOT reset created_at — the aggregation window starts from when the first
 * invoice in the batch was authorised, and stays fixed.
 *
 * @param {number} id
 * @param {{ title: string, message: string, metadata: object }} fields
 */
async function updateAggregated(id, { title, message, metadata }) {
  const { rows } = await db.query(
    `UPDATE notifications
     SET title = $2, message = $3, metadata = $4
     WHERE id = $1
     RETURNING *`,
    [id, title, message, metadata ? JSON.stringify(metadata) : null]
  );
  return rows[0] || null;
}

/**
 * Auto-dismiss all unread cert alerts for an issuer.
 * Called by the cert-check job when a cert is renewed and has > 30 days remaining.
 */
async function markAllCertAlertsAsRead(tenantId, issuerId) {
  await db.query(
    `UPDATE notifications
     SET read_at = NOW()
     WHERE tenant_id = $1
       AND issuer_id = $2
       AND type IN ('CERT_EXPIRING', 'CERT_EXPIRED')
       AND read_at IS NULL`,
    [tenantId, issuerId]
  );
}

module.exports = {
  create,
  findById,
  findActiveByTenantId,
  findUnreadCertAlertByIssuer,
  findPendingDocumentAuthorized,
  update,
  updateAggregated,
  markAsRead,
  markAllCertAlertsAsRead,
};
