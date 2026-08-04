// Producer/consumer mechanics for the pending_effects outbox (ADR-022,
// CLAUDE.md "Async worker: pending_effects outbox"). Generalizes Phase 1's
// per-document dispatch tracking (documents.send_dispatch_attempted_at/
// authorize_dispatch_attempted_at) to all 8 effect types, SRI send/authorize
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
const logger = require('./logger.service');

// A state-machine violation (400) means another delivery already advanced
// the underlying document past this state — expected under RabbitMQ's
// at-least-once redelivery, not a real failure. Same reasoning as
// workers/sri-worker.js's isBenignStateError before this refactor.
function isBenignStateError(err) {
  return err instanceof AppError && err.statusCode === 400;
}

// Structured worker-side log line for process()'s outcome — correlated by the
// effect's own id and, when present in the payload, the document's
// accessKey/documentId (payload is "ids only" by design, see the outbox note
// above, so these are safe to read directly). See CLAUDE.md's "Structured
// request logging" entry — this is the worker-side half of that mechanism.
function logOutcome(effectId, effect, outcome, startedAt, err = null) {
  const entry = {
    timestamp: new Date().toISOString(),
    effectId,
    effectType: effect?.effect_type || null,
    tenantId: effect?.tenant_id || null,
    accessKey: effect?.payload?.accessKey || null,
    documentId: effect?.payload?.documentId || null,
    outcome,
    durationMs: Date.now() - startedAt,
  };
  if (err) {
    logger.error(`[worker] ${outcome}`, { ...entry, error: err.message });
  } else {
    logger.info(`[worker] ${outcome}`, entry);
  }
}

async function enqueue(effectType, tenantId, payload, dedupKey = null, notificationType = null, documentId = null) {
  return pendingEffectModel.create(effectType, tenantId, payload, dedupKey, notificationType, documentId);
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

// Manual recovery for one FAILED effect, given its row already resolved by
// the caller (see document-transmission.service.js's retrySend()/
// retryAllFailedForTenant(), the tenant-facing entry points — resolving
// *which* effect is in scope, e.g. by document ownership, is the caller's
// job; this is just the mechanical reset-and-redispatch shared by both the
// single and bulk paths). There's no automatic path back from FAILED
// (queue-reconciliation only ever looks at PENDING/DISPATCHED rows, and
// RabbitMQ itself never redelivers — see worker.js's nack(msg, false,
// false)), so this is the only way to recover an effect whose failure
// turned out to be transient (e.g. an SRI-side outage) once whatever caused
// it is believed to be resolved. Returns null (no-op) if the row wasn't
// actually FAILED anymore by the time this ran (e.g. a race against
// reconciliation) — the caller decides whether that's worth surfacing.
async function retryEffect(effectId) {
  const reset = await pendingEffectModel.resetForRetry(effectId);
  if (reset) dispatch(reset);
  return reset;
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
  const startedAt = Date.now();
  const client = await db.getClient();
  let effect;
  let handlerError = null;
  let handlerResult = null;

  try {
    await client.query('BEGIN');
    effect = await pendingEffectModel.claimForProcessing(client, effectId);

    if (!effect || effect.status === 'DONE' || effect.status === 'FAILED') {
      await client.query('COMMIT');
      logOutcome(effectId, effect, 'skipped', startedAt);
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
      logOutcome(effectId, effect, 'requeue', startedAt);
      return;
    }

    if (!handlerError) {
      await pendingEffectModel.markDone(client, effect.id);
      await client.query('COMMIT');
      logOutcome(effectId, effect, 'done', startedAt);
      return;
    }

    // Handler failed — release the transaction (no partial writes from a
    // half-finished handler linger) before recording the outcome.
    await client.query('ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK');
    logOutcome(effectId, effect, 'claim_error', startedAt, err);
    throw err;
  } finally {
    client.release();
  }

  // Outcome bookkeeping happens outside the claiming transaction (already
  // closed above) via a fresh, unlocked write.
  if (isBenignStateError(handlerError)) {
    await pendingEffectModel.recordFailedAttempt(effect.id, effect.attempt_count, null, 'DONE');
    logOutcome(effectId, effect, 'done_benign', startedAt, handlerError);
    return;
  }
  const attempts = effect.attempt_count + 1;
  const status = attempts >= config.pendingEffects.maxAttempts ? 'FAILED' : effect.status;
  await pendingEffectModel.recordFailedAttempt(effect.id, attempts, String(handlerError.message).slice(0, 500), status);
  logOutcome(effectId, effect, status === 'FAILED' ? 'failed_final' : 'failed_retry', startedAt, handlerError);
  throw handlerError;
}

module.exports = { enqueue, dispatch, process, isBenignStateError, retryEffect };
