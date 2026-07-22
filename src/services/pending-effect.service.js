// Producer/consumer mechanics for the pending_effects outbox (ADR-022,
// CLAUDE.md "Async worker: pending_effects outbox"). Generalizes Phase 1's
// per-document dispatch tracking (documents.send_dispatch_attempted_at/
// authorize_dispatch_attempted_at) to all 17 effect types, SRI send/authorize
// included.
//
// Every producer call site follows the same two-step shape:
//   const effect = await pendingEffectService.enqueue(EffectTypes.X, tenantId, payload);
//   pendingEffectService.dispatch(effect);
// enqueue() is a durable, awaited insert — the effect intent survives a
// crash even if dispatch() below never runs. dispatch() is best-effort (a
// failed/timed-out publish never fails the caller's request) — mirrors
// document-transmission.service.js's queueSend exactly. Anything left
// undispatched (or dispatched-but-never-processed) is picked up by
// queue-reconciliation.service.js's reconcilePendingEffects().
const db = require('../config/database');
const pendingEffectModel = require('../models/pending-effect.model');
const queueService = require('./queue.service');
const { routingKeyForEffectType } = require('../constants/effect-types');
const AppError = require('../errors/app-error');
const config = require('../config');

// A state-machine violation (400) means another delivery already advanced
// the underlying document past this state — expected under RabbitMQ's
// at-least-once redelivery, not a real failure. Same reasoning as
// workers/sri-worker.js's isBenignStateError before this refactor.
function isBenignStateError(err) {
  return err instanceof AppError && err.statusCode === 400;
}

async function enqueue(effectType, tenantId, payload, dedupKey = null) {
  return pendingEffectModel.create(effectType, tenantId, payload, dedupKey);
}

async function dispatch(effectRow) {
  const routingKey = routingKeyForEffectType(effectRow.effect_type);
  try {
    await queueService.publishConfirmed(routingKey, { effectId: effectRow.id });
    await pendingEffectModel.markDispatched(effectRow.id);
  } catch (err) {
    // Leave the row as-is — reconciliation will retry. Never fails the
    // caller's request, same as queueSend/queueAuthorizationCheck.
    console.warn(`[pending-effects] publish failed for ${effectRow.id} (${effectRow.effect_type}):`, err.message);
  }
}

/**
 * Claim and run one effect. Called by workers/worker.js for every message
 * across all three queues — which queue delivered it doesn't matter, the
 * claim/dispatch/retry logic is identical.
 *
 * Resolves normally (caller should ack) unless the handler threw a
 * non-benign error, in which case it rethrows (caller should nack, no
 * requeue — reconciliation is the retry mechanism, not RabbitMQ).
 */
async function process(effectId) {
  const { getHandler } = require('../effects'); // lazy: effects/index.js requires services that require this file
  const client = await db.getClient();
  let effect;
  let handlerError = null;
  let handlerResult = null;

  try {
    await client.query('BEGIN');
    effect = await pendingEffectModel.claimForProcessing(client, effectId);

    if (!effect || effect.status === 'DONE' || effect.status === 'FAILED') {
      await client.query('COMMIT');
      return;
    }

    try {
      handlerResult = await getHandler(effect.effect_type)(effect.payload);
    } catch (err) {
      handlerError = err;
    }

    if (!handlerError && handlerResult && handlerResult.requeue) {
      // SRI_AUTHORIZE only: SRI is still processing. Leave the row exactly
      // as-is (not DONE, attempt_count untouched) — reconciliation's
      // staleness window naturally re-dispatches it later.
      await client.query('COMMIT');
      return;
    }

    if (!handlerError) {
      await pendingEffectModel.markDone(client, effect.id);
      await client.query('COMMIT');
      return;
    }

    // Handler failed — release the transaction (no partial writes from a
    // half-finished handler linger) before recording the outcome.
    await client.query('ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Outcome bookkeeping happens outside the claiming transaction (already
  // closed above) via a fresh, unlocked write.
  if (isBenignStateError(handlerError)) {
    await pendingEffectModel.recordFailedAttempt(effect.id, effect.attempt_count, null, 'DONE');
    return;
  }
  const attempts = effect.attempt_count + 1;
  const status = attempts >= config.pendingEffects.maxAttempts ? 'FAILED' : effect.status;
  await pendingEffectModel.recordFailedAttempt(effect.id, attempts, String(handlerError.message).slice(0, 500), status);
  throw handlerError;
}

module.exports = { enqueue, dispatch, process, isBenignStateError };
