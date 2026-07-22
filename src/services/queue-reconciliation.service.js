// "Make sure a message exists, never do the work" (see ADR-019/ADR-022).
// This never calls SRI, sends an email, etc. — that's the worker's job
// alone (workers/worker.js via src/effects/index.js). It only finds
// pending_effects rows whose dispatch to RabbitMQ was never confirmed or has
// gone stale, and re-publishes a fresh message for them, exactly like the
// original enqueue would have. Runs on an external cron via
// POST /v1/admin/jobs/queue-reconciliation, same pattern as
// notification-scheduler.service.js.
//
// Phase 2 (ADR-022) replaced the two document-schema-scanning sweeps this
// file used to have (one for send, one for authorize, each run against
// public.documents and sandbox.documents) with one sweep against
// pending_effects, which isn't schema-scoped — every dispatch-tracking
// concern, SRI send/authorize included, now lives in that one table. Uses
// db.getClient() directly (no setIssuerContext) — same RLS-bypass precedent
// as the Mailgun webhook and the other admin jobs (CLAUDE.md Common
// Mistake #13's exception clause).

const db = require('../config/database');
const queueService = require('./queue.service');
const pendingEffectModel = require('../models/pending-effect.model');
const { routingKeyForEffectType } = require('../constants/effect-types');
const config = require('../config');

async function reconcilePendingEffects() {
  const client = await db.getClient();
  let republished = 0;
  try {
    await client.query('BEGIN');

    const rows = await pendingEffectModel.findStaleForReconciliation(client, {
      checkDelayMinutes: config.queueReconciliation.authorizeCheckDelayMinutes,
      staleMinutes: config.queueReconciliation.authorizeStaleMinutes,
      effectStaleMinutes: config.queueReconciliation.effectStaleMinutes,
      batchLimit: config.queueReconciliation.batchLimit,
    });

    for (const row of rows) {
      try {
        const routingKey = routingKeyForEffectType(row.effect_type);
        await queueService.publishConfirmed(routingKey, { effectId: row.id });
        await client.query(
          `UPDATE pending_effects SET status = 'DISPATCHED', dispatch_attempted_at = NOW() WHERE id = $1`,
          [row.id]
        );
        republished++;
      } catch (err) {
        // Leave the row as-is — next sweep will retry it.
        console.warn(`[queue-reconciliation] re-publish failed for effect ${row.id} (${row.effect_type}):`, err.message);
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return republished;
}

async function runAll() {
  const republished = await reconcilePendingEffects();
  return { republished };
}

module.exports = { runAll };
