// "Make sure a message exists, never do the work" (NEXT_STEPS.md item 2).
// This never calls SRI — that's the worker's job alone
// (workers/sri-worker.js). It only finds documents whose publish to
// RabbitMQ was never confirmed or has gone stale, and re-publishes a fresh
// message for them, exactly like the original request would have. Runs on
// an external cron via POST /v1/admin/jobs/queue-reconciliation, same
// pattern as notification-scheduler.service.js.
//
// Scans public.documents and sandbox.documents as two separate SELECT ...
// FOR UPDATE SKIP LOCKED sweeps — Postgres doesn't allow FOR UPDATE with
// UNION, mirroring sequential.service.js's getCounters() precedent. Uses
// db.getClient() directly (no setIssuerContext) since this scans across all
// issuers/tenants — same RLS-bypass precedent as the Mailgun webhook and the
// other admin jobs (CLAUDE.md Common Mistake #13's exception clause).

const db = require('../config/database');
const queueService = require('./queue.service');
const config = require('../config');

const SCHEMAS = [
  { name: 'public', sandbox: false },
  { name: 'sandbox', sandbox: true },
];

async function reconcileSends(schemaName, sandbox) {
  const client = await db.getClient();
  let republished = 0;
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, access_key, issuer_id FROM ${schemaName}.documents
       WHERE status = 'PENDING_SEND'
         AND (send_dispatch_attempted_at IS NULL
              OR send_dispatch_attempted_at < NOW() - ($1 * INTERVAL '1 minute'))
       FOR UPDATE SKIP LOCKED
       LIMIT $2`,
      [config.queueReconciliation.sendStaleMinutes, config.queueReconciliation.batchLimit]
    );

    for (const row of rows) {
      try {
        await queueService.publishConfirmed(queueService.ROUTING_KEYS.send, {
          documentId: row.id,
          accessKey: row.access_key,
          issuerId: row.issuer_id,
          sandbox,
        });
        await client.query(
          `UPDATE ${schemaName}.documents SET send_dispatch_attempted_at = NOW() WHERE id = $1`,
          [row.id]
        );
        republished++;
      } catch (err) {
        // Leave the timestamp as-is — next sweep will retry this row.
        console.warn(`[queue-reconciliation] re-publish (send) failed for document ${row.id}:`, err.message);
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

async function reconcileAuthorizations(schemaName, sandbox) {
  const client = await db.getClient();
  let republished = 0;
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, access_key, issuer_id FROM ${schemaName}.documents
       WHERE status = 'RECEIVED'
         AND updated_at < NOW() - ($1 * INTERVAL '1 minute')
         AND (authorize_dispatch_attempted_at IS NULL
              OR authorize_dispatch_attempted_at < NOW() - ($2 * INTERVAL '1 minute'))
       FOR UPDATE SKIP LOCKED
       LIMIT $3`,
      [
        config.queueReconciliation.authorizeCheckDelayMinutes,
        config.queueReconciliation.authorizeStaleMinutes,
        config.queueReconciliation.batchLimit,
      ]
    );

    for (const row of rows) {
      try {
        await queueService.publishConfirmed(queueService.ROUTING_KEYS.authorize, {
          documentId: row.id,
          accessKey: row.access_key,
          issuerId: row.issuer_id,
          sandbox,
        });
        await client.query(
          `UPDATE ${schemaName}.documents SET authorize_dispatch_attempted_at = NOW() WHERE id = $1`,
          [row.id]
        );
        republished++;
      } catch (err) {
        console.warn(`[queue-reconciliation] re-publish (authorize) failed for document ${row.id}:`, err.message);
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
  let sendRepublished = 0;
  let authorizeRepublished = 0;

  for (const { name, sandbox } of SCHEMAS) {
    sendRepublished += await reconcileSends(name, sandbox);
    authorizeRepublished += await reconcileAuthorizations(name, sandbox);
  }

  return { sendRepublished, authorizeRepublished };
}

module.exports = { runAll };
