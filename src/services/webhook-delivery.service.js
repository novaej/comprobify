/**
 * Webhook delivery service.
 *
 * Responsible for:
 *  - Computing HMAC-SHA256 signatures on outgoing payloads.
 *  - Delivering a notification to a single webhook endpoint (one HTTP POST).
 *  - Fan-out: given a notification, find all subscribed endpoints and deliver.
 *  - Processing retry queue: attempt re-delivery for RETRYING rows past their
 *    next_retry_at time.
 *
 * Signature format:
 *   X-Comprobify-Signature: sha256=<hmac-sha256(secret, "${timestamp}.${rawBody}")>
 *   X-Comprobify-Timestamp:  <unix seconds>
 *
 * Consumers should:
 *   1. Reject requests older than 5 minutes (timestamp drift protection).
 *   2. Compute HMAC-SHA256 over `"${timestamp}.${rawBody}"` using their secret.
 *   3. Compare with constant-time equality against the signature header.
 *
 * Retry schedule (attempt_count before failure):
 *   Attempt 1 — immediate (inline, fire-and-forget from notification service)
 *   Attempt 2 — 30 seconds after attempt 1 failure (admin job)
 *   Attempt 3 — 2 minutes after attempt 2 failure (admin job)
 *   After 3 failures → status = FAILED
 */
const crypto = require('crypto');
const webhookEndpointModel  = require('../models/webhook-endpoint.model');
const webhookDeliveryModel  = require('../models/webhook-delivery.model');
const { formatNotification } = require('../presenters/notification.presenter');

/** HTTP timeout for a single webhook attempt (ms). */
const DELIVERY_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * Compute the HMAC-SHA256 signature for a payload.
 *
 * @param {string} secret    - Raw webhook secret (64-char hex)
 * @param {number} timestamp - Unix timestamp (seconds)
 * @param {string} rawBody   - JSON-serialised payload string
 * @returns {string}         - "sha256=<hex>"
 */
function computeSignature(secret, timestamp, rawBody) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${timestamp}.${rawBody}`);
  return `sha256=${hmac.digest('hex')}`;
}

// ---------------------------------------------------------------------------
// Single delivery attempt
// ---------------------------------------------------------------------------

/**
 * Attempt to deliver one payload to one endpoint URL.
 *
 * Returns an object `{ ok: boolean, statusCode?: number, body?: string, error?: string }`.
 * Never throws — failures are captured in the return value.
 *
 * @param {string} url
 * @param {string} secret
 * @param {object} payload  - Plain JS object (will be JSON-serialised here)
 */
async function attemptDelivery(url, secret, payload) {
  const rawBody  = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = computeSignature(secret, timestamp, rawBody);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':              'application/json',
        'X-Comprobify-Signature':    signature,
        'X-Comprobify-Timestamp':    String(timestamp),
        'User-Agent':                'Comprobify-Webhook/1.0',
      },
      body:   rawBody,
      signal: controller.signal,
    });

    clearTimeout(timer);
    let body = '';
    try { body = await response.text(); } catch (_) { /* ignore */ }

    return { ok: response.ok, statusCode: response.status, body: body.slice(0, 500) };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, error: err.message?.slice(0, 200) || 'Unknown error' };
  }
}

// ---------------------------------------------------------------------------
// Fan-out
// ---------------------------------------------------------------------------

/**
 * Build the outgoing webhook payload for a notification.
 *
 * @param {object} notification  - Raw DB row from notifications table
 * @param {number} deliveryId    - ID of the webhook_deliveries row
 */
function buildPayload(notification, deliveryId) {
  return {
    event:      notification.type,
    deliveryId,
    timestamp:  Math.floor(new Date(notification.created_at).getTime() / 1000),
    tenantId:   notification.tenant_id,
    data:       formatNotification(notification),
  };
}

/**
 * Fan out a notification to all active, subscribed webhook endpoints.
 *
 * Called fire-and-forget after every notification create/update. Creates a
 * delivery row per endpoint, then attempts delivery immediately and records
 * the result. Failed attempts are left as RETRYING for the admin job to pick up.
 *
 * Never throws — all failures are swallowed and logged.
 *
 * @param {object} notification  - Raw DB row from notifications table
 */
async function fanOut(notification) {
  let endpoints;
  try {
    endpoints = await webhookEndpointModel.findSubscribedByTenantIdAndType(
      notification.tenant_id,
      notification.type
    );
  } catch (err) {
    console.warn('[webhook] Failed to query endpoints for fan-out:', err.message);
    return;
  }

  if (!endpoints.length) return;

  // Dedup guard (ADR-022): fanOut is now called from the WEBHOOK_FANOUT
  // effect handler, which can redeliver the same message at-least-once
  // (e.g. a worker crash between fanOut() sending and the effect being
  // marked DONE). Skip any endpoint that already has a delivery row for
  // this notification so a retry never double-sends.
  let alreadyDeliveredEndpointIds;
  try {
    const existing = await webhookDeliveryModel.findByNotificationId(notification.id);
    alreadyDeliveredEndpointIds = new Set(existing.map(row => row.webhook_id));
  } catch (err) {
    console.warn('[webhook] Failed to check existing deliveries for dedup:', err.message);
    alreadyDeliveredEndpointIds = new Set();
  }

  for (const endpoint of endpoints) {
    if (alreadyDeliveredEndpointIds.has(endpoint.id)) continue;

    let delivery;
    try {
      delivery = await webhookDeliveryModel.create({
        notificationId: notification.id,
        webhookId:      endpoint.id,
        tenantId:       notification.tenant_id,
      });
    } catch (err) {
      console.warn('[webhook] Failed to create delivery row:', err.message);
      continue;
    }

    const payload  = buildPayload(notification, delivery.id);
    const result   = await attemptDelivery(endpoint.url, endpoint.secret, payload);

    try {
      if (result.ok) {
        await webhookDeliveryModel.markSuccess(delivery.id, { statusCode: result.statusCode, body: result.body });
      } else {
        await webhookDeliveryModel.markFailure(delivery.id, delivery.attempt_count, result);
      }
    } catch (err) {
      console.warn('[webhook] Failed to update delivery row:', err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Retry queue processor
// ---------------------------------------------------------------------------

/**
 * Retry all RETRYING deliveries whose next_retry_at has passed.
 *
 * Called by the admin notification-jobs endpoint. Processes up to 100 due
 * retries per invocation — subsequent job runs handle the remainder.
 *
 * @returns {{ attempted: number, succeeded: number, failed: number, exhausted: number }}
 */
async function processDueRetries() {
  const due = await webhookDeliveryModel.findDueRetries(100);
  let succeeded = 0, failed = 0, exhausted = 0;

  for (const row of due) {
    // Fetch the notification to build the payload
    const notificationModel = require('../models/notification.model');
    let notification;
    try {
      notification = await notificationModel.findById(row.notification_id);
    } catch (err) {
      console.warn('[webhook] Could not fetch notification for retry:', err.message);
      continue;
    }
    if (!notification) continue;

    const payload = buildPayload(notification, row.id);
    const result  = await attemptDelivery(row.url, row.secret, payload);

    try {
      if (result.ok) {
        await webhookDeliveryModel.markSuccess(row.id, { statusCode: result.statusCode, body: result.body });
        succeeded++;
      } else {
        const updated = await webhookDeliveryModel.markFailure(row.id, row.attempt_count, result);
        if (updated?.status === 'FAILED') { exhausted++; } else { failed++; }
      }
    } catch (err) {
      console.warn('[webhook] Failed to update delivery row on retry:', err.message);
    }
  }

  return { attempted: due.length, succeeded, failed, exhausted };
}

module.exports = { fanOut, processDueRetries, computeSignature };
