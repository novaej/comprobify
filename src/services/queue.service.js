const amqp = require('amqplib');
const config = require('../config');

// Routing key -> queue name. The routing key is also what callers pass to
// publishConfirmed() — exported separately as ROUTING_KEYS below so calling
// code never hardcodes the string literal.
const QUEUES = {
  send: 'sri.send',
  authorize: 'sri.authorize',
};

const ROUTING_KEYS = {
  send: 'send',
  authorize: 'authorize',
};

let channel = null;
let connectionPromise = null;

// Shown as "Client provided name" in the broker's management UI (e.g.
// CloudAMQP) — otherwise every connection looks identical (just an IP:port),
// making it impossible to tell the API's publisher connection apart from
// the worker's consumer connection. Defaults to the API's name since
// document-transmission.service.js's queueSend/queueAuthorizationCheck are
// the only other caller of connect() outside the worker; sri-worker.js
// overrides this via setConnectionName() before triggering its own connect.
let connectionName = 'comprobify-api';

function setConnectionName(name) {
  connectionName = name;
}

// Declares the exchange/queue/DLX topology. Idempotent (assert* calls are
// no-ops if already declared with matching arguments) — safe to call from
// both the publisher (API process) and the consumer (worker process),
// whichever connects first. Re-run automatically on every reconnect via the
// amqplib `recovery.setup` hook below, so topology survives a broker restart.
async function declareTopology(ch) {
  const exchange = config.rabbitmq.sriExchange;
  const dlx = `${exchange}.dlx`;

  await ch.assertExchange(exchange, 'direct', { durable: true });
  await ch.assertExchange(dlx, 'direct', { durable: true });

  for (const [routingKey, queueName] of Object.entries(QUEUES)) {
    const dlq = `${queueName}.dlq`;
    // Dead-letter queue: no consumer reads this in Phase 1. It exists purely
    // for ops visibility (via the CloudAMQP management UI) into hard
    // failures — Postgres state is what actually guarantees no work is
    // lost, since the reconciliation job re-publishes independently of this.
    await ch.assertQueue(dlq, { durable: true });
    await ch.bindQueue(dlq, dlx, routingKey);

    await ch.assertQueue(queueName, {
      durable: true,
      arguments: { 'x-dead-letter-exchange': dlx },
    });
    await ch.bindQueue(queueName, exchange, routingKey);
  }
}

// Lazily connects using amqplib's built-in recovery (exponential backoff +
// jitter, unbounded retries by default) instead of hand-rolled reconnect
// logic. The `setup` hook re-creates the confirm channel and re-declares
// topology on every successful (re)connect, so `channel` is always valid by
// the time this promise resolves.
function connect() {
  if (!connectionPromise) {
    connectionPromise = amqp.connect(config.rabbitmq.url, {
      clientProperties: { connection_name: connectionName },
      recovery: {
        setup: async (model) => {
          channel = await model.createConfirmChannel();
          await declareTopology(channel);
        },
      },
    });
    connectionPromise.catch(() => {
      connectionPromise = null;
    });
  }
  return connectionPromise;
}

async function getChannel() {
  await connect();
  return channel;
}

// For consumers only (workers/sri-worker.js). A fresh channel object is
// created on every reconnect (amqplib does not transparently re-attach old
// channels), so a consumer registered via channel.consume() on a
// since-replaced channel would silently stop receiving messages after any
// connection drop. `callback` is invoked once immediately with the current
// channel, then again every time the underlying connection reconnects —
// callers should re-run their channel.consume() calls each time.
async function onConnect(callback) {
  const connection = await connect();
  connection.on('connect', () => callback(channel));
  callback(channel);
}

// Publishes with a broker-confirmed ack (never resolves on a merely-buffered
// write). Callers must not let this block indefinitely if the broker is
// unreachable — defaults to a 3s timeout, after which the caller should log
// and move on; the reconciliation job is the actual retry mechanism, not a
// long-hung publish attempt.
function publishConfirmed(routingKey, payload, { timeoutMs = 3000 } = {}) {
  return getChannel().then((ch) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`publishConfirmed timed out after ${timeoutMs}ms (routingKey=${routingKey})`));
    }, timeoutMs);

    const content = Buffer.from(JSON.stringify(payload));
    ch.publish(config.rabbitmq.sriExchange, routingKey, content, { persistent: true }, (err) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    });
  }));
}

module.exports = { QUEUES, ROUTING_KEYS, connect, getChannel, onConnect, publishConfirmed, declareTopology, setConnectionName };
