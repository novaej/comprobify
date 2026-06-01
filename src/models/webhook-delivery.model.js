/**
 * Webhook delivery model.
 *
 * Tenant-scoped but not issuer-scoped — uses db.query() directly (no RLS context).
 */
const db = require('../config/database');
const WebhookDeliveryStatus = require('../constants/webhook-delivery-status');

/** Seconds to wait before each retry attempt (indexed by attempt_count after failure). */
const RETRY_DELAYS_SECONDS = [30, 120]; // attempt 2: +30 s, attempt 3: +2 min

/**
 * Create a delivery row for one endpoint + notification pair.
 * Status defaults to PENDING; the caller updates it after the first attempt.
 *
 * @param {object} params
 * @param {number} params.notificationId
 * @param {number} params.webhookId
 * @param {number} params.tenantId
 */
async function create({ notificationId, webhookId, tenantId }) {
  const { rows } = await db.query(
    `INSERT INTO webhook_deliveries (notification_id, webhook_id, tenant_id)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [notificationId, webhookId, tenantId]
  );
  return rows[0];
}

/**
 * Mark a delivery as succeeded.
 *
 * @param {number} id
 * @param {{ statusCode: number, body: string }} response
 */
async function markSuccess(id, response) {
  const { rows } = await db.query(
    `UPDATE webhook_deliveries
     SET status = $2, attempt_count = attempt_count + 1, last_response = $3,
         next_retry_at = NULL, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, WebhookDeliveryStatus.SUCCESS, JSON.stringify(response)]
  );
  return rows[0] || null;
}

/**
 * Mark a delivery as failed and schedule a retry, or set it to FAILED if
 * max attempts are exhausted.
 *
 * @param {number} id
 * @param {number} currentAttemptCount  - the attempt_count value BEFORE this attempt
 * @param {{ statusCode?: number, body?: string, error?: string }} response
 */
async function markFailure(id, currentAttemptCount, response) {
  const newAttemptCount = currentAttemptCount + 1;
  const delaySeconds    = RETRY_DELAYS_SECONDS[currentAttemptCount]; // undefined if exhausted
  const hasRetry        = delaySeconds !== undefined;

  const status = hasRetry ? WebhookDeliveryStatus.RETRYING : WebhookDeliveryStatus.FAILED;
  const nextRetryAt = hasRetry
    ? new Date(Date.now() + delaySeconds * 1000).toISOString()
    : null;

  const { rows } = await db.query(
    `UPDATE webhook_deliveries
     SET status = $2, attempt_count = $3, last_response = $4,
         next_retry_at = $5, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, status, newAttemptCount, JSON.stringify(response), nextRetryAt]
  );
  return rows[0] || null;
}

/**
 * Return all RETRYING deliveries whose next_retry_at has passed.
 * Used by the admin scheduler job.
 *
 * @param {number} [limit=100]
 */
async function findDueRetries(limit = 100) {
  const { rows } = await db.query(
    `SELECT wd.*, we.url, we.secret, we.tenant_id AS webhook_tenant_id
     FROM webhook_deliveries wd
     JOIN webhook_endpoints we ON we.id = wd.webhook_id
     WHERE wd.status = $1
       AND wd.next_retry_at <= NOW()
       AND we.active = true
     ORDER BY wd.next_retry_at ASC
     LIMIT $2`,
    [WebhookDeliveryStatus.RETRYING, limit]
  );
  return rows;
}

/**
 * Return delivery history for a specific notification.
 *
 * @param {number} notificationId
 */
async function findByNotificationId(notificationId) {
  const { rows } = await db.query(
    `SELECT * FROM webhook_deliveries
     WHERE notification_id = $1
     ORDER BY created_at DESC`,
    [notificationId]
  );
  return rows;
}

module.exports = {
  create,
  markSuccess,
  markFailure,
  findDueRetries,
  findByNotificationId,
  RETRY_DELAYS_SECONDS,
};
