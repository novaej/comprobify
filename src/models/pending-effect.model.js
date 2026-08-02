const db = require('../config/database');

/**
 * Insert a new pending_effects row, or — when dedupKey is given and an open
 * (PENDING/DISPATCHED) row with the same dedup_key already exists — return
 * that existing row untouched. Used by SRI_AUTHORIZE so a client repeatedly
 * calling GET /:key/authorize never creates duplicate open rows for the same
 * document (see idx_pending_effects_dedup).
 *
 * notificationType is a denormalized snapshot of notifications.type, only
 * ever passed for NOTIFICATION_DISPATCH rows (see notification.service.js's
 * dispatchNotification) — informational only, never read by the handler
 * itself. See migration 080.
 *
 * documentId is the same kind of denormalized snapshot, only ever passed for
 * SRI_SEND/SRI_AUTHORIZE rows (see document-transmission.service.js) — backs
 * findByDocumentId()/findFailedByTenantId() below, used by the tenant-facing
 * retry endpoints. See migration 082.
 */
async function create(effectType, tenantId, payload, dedupKey = null, notificationType = null, documentId = null) {
  if (dedupKey) {
    // The ON CONFLICT predicate below must match idx_pending_effects_dedup's
    // index predicate EXACTLY (including dedup_key IS NOT NULL) — Postgres's
    // arbiter-index inference for a partial unique index requires the two
    // WHERE clauses to be syntactically identical, not just "compatible".
    // Omitting `dedup_key IS NOT NULL` here causes 42P10 ("no unique or
    // exclusion constraint matching the ON CONFLICT specification") even
    // though the index exists and would otherwise apply.
    const { rows } = await db.query(
      `INSERT INTO pending_effects (effect_type, tenant_id, payload, dedup_key, notification_type, document_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL AND status IN ('PENDING', 'DISPATCHED')
       DO UPDATE SET attempt_count = pending_effects.attempt_count
       RETURNING *`,
      [effectType, tenantId, payload, dedupKey, notificationType, documentId]
    );
    return rows[0];
  }

  const { rows } = await db.query(
    `INSERT INTO pending_effects (effect_type, tenant_id, payload, notification_type, document_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [effectType, tenantId, payload, notificationType, documentId]
  );
  return rows[0];
}

/**
 * The FAILED SRI_SEND/SRI_AUTHORIZE effect for one document, scoped to the
 * requesting tenant — backs POST /v1/documents/:accessKey/send/retry.
 * tenant_id is included not just for ownership but as a disambiguator: a
 * bare document_id match could theoretically collide across the independent
 * public.documents/sandbox.documents id sequences (see migration 082), and a
 * collision that also matches the same tenant is not a realistic concern.
 */
async function findFailedByDocumentId(documentId, tenantId) {
  const { rows } = await db.query(
    `SELECT * FROM pending_effects
     WHERE document_id = $1 AND tenant_id = $2
       AND effect_type IN ('SRI_SEND', 'SRI_AUTHORIZE')
       AND status = 'FAILED'`,
    [documentId, tenantId]
  );
  return rows[0] || null;
}

/**
 * Every FAILED SRI_SEND/SRI_AUTHORIZE effect for a tenant — backs
 * POST /v1/documents/retry-failed. No document_id needed here: tenant_id
 * and effect_type are real columns already, so this doesn't touch the
 * JSONB payload at all.
 */
async function findFailedByTenantId(tenantId) {
  const { rows } = await db.query(
    `SELECT * FROM pending_effects
     WHERE tenant_id = $1
       AND effect_type IN ('SRI_SEND', 'SRI_AUTHORIZE')
       AND status = 'FAILED'
     ORDER BY created_at ASC`,
    [tenantId]
  );
  return rows;
}

/**
 * Resets a FAILED effect back to a fresh, retryable state — a full new
 * attempt_count budget, not a continuation of the exhausted one, since a
 * manual retry is normally reached for after whatever caused the original
 * 5 failures (e.g. an SRI-side outage) is believed to be resolved.
 * dispatch_attempted_at is cleared to NULL so a subsequent reconciliation
 * sweep would pick it up immediately if the caller's own dispatch() (see
 * pending-effect.service.js's retry()) doesn't land. The `AND status =
 * 'FAILED'` guard makes this a no-op (returns null) on anything not
 * actually FAILED, so a race against a concurrent retry can't double-reset.
 */
async function resetForRetry(id) {
  const { rows } = await db.query(
    `UPDATE pending_effects
     SET status = 'PENDING', attempt_count = 0, last_error = NULL, dispatch_attempted_at = NULL
     WHERE id = $1 AND status = 'FAILED'
     RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

async function markDispatched(id) {
  const { rows } = await db.query(
    `UPDATE pending_effects SET status = 'DISPATCHED', dispatch_attempted_at = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Claim a row for processing inside an explicit transaction. Caller must
 * COMMIT/ROLLBACK and release the client — see pending-effect.service.js's
 * process(). The FOR UPDATE lock is what makes RabbitMQ's at-least-once
 * redelivery safe: a duplicate delivery of the same effectId blocks here
 * until the first attempt's transaction resolves, then sees the row's
 * post-attempt status and no-ops.
 */
async function claimForProcessing(client, id) {
  const { rows } = await client.query(`SELECT * FROM pending_effects WHERE id = $1 FOR UPDATE`, [id]);
  return rows[0] || null;
}

async function markDone(client, id) {
  await client.query(`UPDATE pending_effects SET status = 'DONE', processed_at = NOW() WHERE id = $1`, [id]);
}

/**
 * Record a failed attempt outside the claiming transaction (which was
 * already rolled back by the caller) — a fresh, unlocked write so this
 * bookkeeping survives independently of the handler's own failure.
 */
async function recordFailedAttempt(id, attemptCount, errorMessage, status) {
  await db.query(
    `UPDATE pending_effects SET attempt_count = $2, last_error = $3, status = $4 WHERE id = $1`,
    [id, attemptCount, errorMessage, status]
  );
}

/**
 * Rows whose dispatch was never confirmed or has gone stale, for
 * queue-reconciliation.service.js's single sweep. SRI_AUTHORIZE uses a
 * distinct timing regime (checkDelayMinutes for the first-ever attempt,
 * staleMinutes for re-attempts) from every other effect type (staleMinutes
 * only) — see CLAUDE.md's "Async worker: pending_effects outbox" entry.
 */
async function findStaleForReconciliation(client, { checkDelayMinutes, staleMinutes, effectStaleMinutes, batchLimit }) {
  const { rows } = await client.query(
    `SELECT id, effect_type FROM pending_effects
     WHERE status IN ('PENDING', 'DISPATCHED')
       AND (
         (effect_type = 'SRI_AUTHORIZE' AND (
           (dispatch_attempted_at IS NULL AND created_at < NOW() - ($1 * INTERVAL '1 minute'))
           OR (dispatch_attempted_at IS NOT NULL AND dispatch_attempted_at < NOW() - ($2 * INTERVAL '1 minute'))
         ))
         OR (effect_type != 'SRI_AUTHORIZE' AND
             (dispatch_attempted_at IS NULL OR dispatch_attempted_at < NOW() - ($3 * INTERVAL '1 minute')))
       )
     FOR UPDATE SKIP LOCKED
     LIMIT $4`,
    [checkDelayMinutes, staleMinutes, effectStaleMinutes, batchLimit]
  );
  return rows;
}

module.exports = {
  create,
  findFailedByDocumentId,
  findFailedByTenantId,
  resetForRetry,
  markDispatched,
  claimForProcessing,
  markDone,
  recordFailedAttempt,
  findStaleForReconciliation,
};
