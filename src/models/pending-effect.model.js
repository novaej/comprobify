const db = require('../config/database');

/**
 * Insert a new pending_effects row, or — when dedupKey is given and an open
 * (PENDING/DISPATCHED) row with the same dedup_key already exists — return
 * that existing row untouched. Used by SRI_AUTHORIZE so a client repeatedly
 * calling GET /:key/authorize never creates duplicate open rows for the same
 * document (see idx_pending_effects_dedup).
 */
async function create(effectType, tenantId, payload, dedupKey = null) {
  if (dedupKey) {
    // The ON CONFLICT predicate below must match idx_pending_effects_dedup's
    // index predicate EXACTLY (including dedup_key IS NOT NULL) — Postgres's
    // arbiter-index inference for a partial unique index requires the two
    // WHERE clauses to be syntactically identical, not just "compatible".
    // Omitting `dedup_key IS NOT NULL` here causes 42P10 ("no unique or
    // exclusion constraint matching the ON CONFLICT specification") even
    // though the index exists and would otherwise apply.
    const { rows } = await db.query(
      `INSERT INTO pending_effects (effect_type, tenant_id, payload, dedup_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL AND status IN ('PENDING', 'DISPATCHED')
       DO UPDATE SET attempt_count = pending_effects.attempt_count
       RETURNING *`,
      [effectType, tenantId, payload, dedupKey]
    );
    return rows[0];
  }

  const { rows } = await db.query(
    `INSERT INTO pending_effects (effect_type, tenant_id, payload) VALUES ($1, $2, $3) RETURNING *`,
    [effectType, tenantId, payload]
  );
  return rows[0];
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
  markDispatched,
  claimForProcessing,
  markDone,
  recordFailedAttempt,
  findStaleForReconciliation,
};
