// Standalone RabbitMQ consumer process for the async SRI send/authorize
// pipeline (see ADR-019). Started separately from the API
// (`npm run worker`), deployed as its own Render service. This is the only
// place that calls documentTransmissionService.sendToSri()/
// checkAuthorization() — the reconciliation job never does, it only
// re-publishes (see src/services/queue-reconciliation.service.js).
require('dotenv').config();
require('../instrument');

const config = require('../src/config');
const { validateCoreConfig } = require('../src/config/validate');
validateCoreConfig(config);

const queueService = require('../src/services/queue.service');
const documentTransmissionService = require('../src/services/document-transmission.service');
const issuerModel = require('../src/models/issuer.model');
const AppError = require('../src/errors/app-error');

// Must be set before the first connect() call (triggered lazily by
// queueService.onConnect() in start(), below) — otherwise this process would
// show up in the broker's management UI under the default 'comprobify-api'
// name, indistinguishable from the actual API process.
queueService.setConnectionName('comprobify-worker');

// issuer.sandbox is a virtual field (see CLAUDE.md "Sandbox environment" —
// issuers no longer have an environment column) normally set by the
// resolveIssuer middleware from req.tenant.sandbox. The worker has no
// request/tenant to resolve it from, so the publisher includes `sandbox`
// directly in the message payload instead, and we just re-apply it here.
async function resolveIssuer(issuerId, sandbox) {
  const issuer = await issuerModel.findById(issuerId);
  if (!issuer) {
    throw new Error(`Issuer ${issuerId} not found or inactive`);
  }
  issuer.sandbox = sandbox;
  return issuer;
}

// A state-machine violation (400 INVALID_STATE_TRANSITION) means another
// delivery already processed this document — expected under RabbitMQ's
// at-least-once redelivery (e.g. a reconciliation re-publish racing a
// delivery already in flight), not a real failure. Anything else is a
// genuine failure (SRI unreachable, etc.) already logged as an ERROR
// document_event inside sendToSri/checkAuthorization.
function isBenignStateError(err) {
  return err instanceof AppError && err.statusCode === 400;
}

async function handleMessage(channel, msg, label, run) {
  const { accessKey } = JSON.parse(msg.content.toString());
  try {
    await run(accessKey);
    channel.ack(msg);
  } catch (err) {
    if (isBenignStateError(err)) {
      console.warn(`[sri-worker] ${label}: skipping ${accessKey} (${err.message})`);
      channel.ack(msg);
    } else {
      console.error(`[sri-worker] ${label}: failed for ${accessKey}:`, err.message);
      channel.nack(msg, false, false); // no requeue — reconciliation retries, not RabbitMQ
    }
  }
}

async function registerConsumers(channel) {
  await channel.prefetch(10);

  await channel.consume(queueService.QUEUES.send, (msg) => {
    if (!msg) return;
    handleMessage(channel, msg, 'sri.send', async (accessKey) => {
      const { issuerId, sandbox } = JSON.parse(msg.content.toString());
      const issuer = await resolveIssuer(issuerId, sandbox);
      await documentTransmissionService.sendToSri(accessKey, issuer);
    });
  });

  await channel.consume(queueService.QUEUES.authorize, (msg) => {
    if (!msg) return;
    handleMessage(channel, msg, 'sri.authorize', async (accessKey) => {
      const { issuerId, sandbox } = JSON.parse(msg.content.toString());
      const issuer = await resolveIssuer(issuerId, sandbox);
      await documentTransmissionService.checkAuthorization(accessKey, issuer);
    });
  });

  console.log('[sri-worker] consuming sri.send and sri.authorize');
}

async function start() {
  // Re-registers consumers on every (re)connect, including the first —
  // channels don't survive a reconnect, so without this the worker would
  // silently stop consuming after any connection drop.
  await queueService.onConnect((channel) => {
    registerConsumers(channel).catch((err) => {
      console.error('[sri-worker] failed to register consumers:', err.message);
    });
  });
}

start().catch((err) => {
  console.error('[sri-worker] fatal error during startup:', err);
  process.exit(1);
});
