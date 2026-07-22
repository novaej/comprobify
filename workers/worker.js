// Standalone RabbitMQ consumer process for the pending_effects outbox
// (ADR-022, formerly workers/sri-worker.js under ADR-019 Phase 1). Started
// separately from the API (`npm run worker`), deployed as its own Render
// service. Consumes all three queues (sri.send, sri.authorize, app.effects)
// on the same shared confirm channel — each gets its own independent
// per-consumer prefetch window (RabbitMQ's basic.qos with global=false
// applies per-consumer despite being set on the channel), so a burst of
// slow side effects (e.g. WEBHOOK_FANOUT hitting a sluggish third-party
// endpoint) can never delay SRI message delivery.
//
// Every message just carries an effectId — pendingEffectService.process()
// (src/services/pending-effect.service.js) does the actual claim/dispatch/
// retry work via the effect registry (src/effects/index.js), identically
// regardless of which of the 3 queues delivered the message. This process
// never contains business logic of its own.
require('dotenv').config();
const Sentry = require('../instrument');

const config = require('../src/config');
const { validateCoreConfig } = require('../src/config/validate');
validateCoreConfig(config);

const queueService = require('../src/services/queue.service');
const pendingEffectService = require('../src/services/pending-effect.service');

// Must be set before the first connect() call (triggered lazily by
// queueService.onConnect() in start(), below) — otherwise this process would
// show up in the broker's management UI under the default 'comprobify-api'
// name, indistinguishable from the actual API process.
queueService.setConnectionName('comprobify-worker');

async function handleMessage(channel, msg, label) {
  const { effectId } = JSON.parse(msg.content.toString());
  try {
    await pendingEffectService.process(effectId);
    channel.ack(msg);
  } catch (err) {
    console.error(`[worker] ${label}: failed for effect ${effectId}:`, err.message);
    channel.nack(msg, false, false); // no requeue — reconciliation retries, not RabbitMQ
  }
}

async function registerConsumers(channel) {
  await channel.prefetch(10);

  await channel.consume(queueService.QUEUES.send, (msg) => {
    if (!msg) return;
    handleMessage(channel, msg, 'sri.send');
  });

  await channel.consume(queueService.QUEUES.authorize, (msg) => {
    if (!msg) return;
    handleMessage(channel, msg, 'sri.authorize');
  });

  await channel.consume(queueService.QUEUES.effects, (msg) => {
    if (!msg) return;
    handleMessage(channel, msg, 'app.effects');
  });

  console.log('[worker] consuming sri.send, sri.authorize, and app.effects');
}

async function start() {
  // Re-registers consumers on every (re)connect, including the first —
  // channels don't survive a reconnect, so without this the worker would
  // silently stop consuming after any connection drop.
  await queueService.onConnect((channel) => {
    registerConsumers(channel).catch((err) => {
      // The worker is connected but NOT consuming — worse than fully down,
      // since it looks alive. Sentry's automatic uncaught-exception capture
      // never sees this (we're catching it ourselves), so it needs an
      // explicit report or this failure mode is invisible everywhere except
      // Render's console logs.
      console.error('[worker] failed to register consumers:', err.message);
      Sentry.captureException(err);
    });
  });
}

start().catch(async (err) => {
  // The worker never came up at all (bad RABBITMQ_URL, DB unreachable,
  // etc.) — same reasoning as above: our own .catch() means Sentry's
  // automatic capture never fires, so report explicitly before exiting.
  // captureException() only queues the event — it doesn't send it — so
  // process.exit() right after would race the network request and could
  // kill the process before Sentry ever receives it. flush() waits (up to
  // 2s) for any queued events to actually go out first.
  console.error('[worker] fatal error during startup:', err);
  Sentry.captureException(err);
  await Sentry.flush(2000);
  process.exit(1);
});
