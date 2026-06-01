/**
 * Webhook delivery status codes.
 *
 * PENDING  — row created; first delivery attempt not yet attempted.
 * SUCCESS  — consumer returned a 2xx response on any attempt.
 * RETRYING — last attempt failed; delivery will be retried at next_retry_at.
 * FAILED   — all 3 attempts exhausted without a 2xx response.
 */
const WebhookDeliveryStatus = Object.freeze({
  PENDING:  'PENDING',
  SUCCESS:  'SUCCESS',
  RETRYING: 'RETRYING',
  FAILED:   'FAILED',
});

module.exports = WebhookDeliveryStatus;
