# ADR-010: Mailgun Webhook for Email Delivery Tracking

## Status
Accepted

## Date
2026-03-03

## Context

Mailgun's `messages.create()` returns HTTP 202 Accepted when the message is **queued**, not when it is delivered. Invalid or non-existent addresses are only reported later via an async push event. The result was that `email_status` stayed `SENT` even when Mailgun had silently bounced the delivery — the buyer never received the document, and the system had no record of it.

Four delivery outcomes need to be tracked:

| Mailgun event | Severity | Meaning |
|---|---|---|
| `delivered` | — | Recipient mail server accepted the message |
| `failed` | `permanent` | Hard bounce — invalid address, domain does not exist, etc. |
| `failed` | `temporary` | Soft bounce — Mailgun will retry automatically |
| `complained` | — | Recipient marked the email as spam |

The question was how to correlate an incoming Mailgun event back to the right document row.

## Decision

1. **Store the Mailgun message ID at send time.** `mailgun.provider.send()` returns `response.id` from the SDK and strips the surrounding angle brackets (Mailgun returns `<id@domain>` from the API but sends `id@domain` in webhook headers). This cleaned ID is stored in `documents.email_message_id`.

2. **Expose `POST /api/mailgun/webhook`.** A dedicated route receives Mailgun's delivery events. The middleware `verify-mailgun-webhook.js` performs HMAC-SHA256 verification against `MAILGUN_WEBHOOK_SIGNING_KEY` with a 5-minute timestamp window (replay protection). Requests with an invalid or missing signature return 401.

3. **Handle all four event types in `mailgun-webhook.service.js`:**
   - `delivered` → `email_status: DELIVERED`, `EMAIL_DELIVERED` event
   - `failed` + `permanent` → `email_status: FAILED`, `EMAIL_FAILED` event
   - `failed` + `temporary` → status unchanged (Mailgun retries), `EMAIL_TEMP_FAILED` event
   - `complained` → `email_status: COMPLAINED`, `EMAIL_COMPLAINED` event

4. **Normalise both Mailgun payload formats.** The service supports the v3 format (`event-data.message.headers.message-id`) and the legacy flat format (`message-id` at root), so existing Mailgun account configurations do not need to change.

### Representative webhook payloads

**delivered:**
```json
{
  "signature": { "timestamp": "…", "token": "…", "signature": "…" },
  "event-data": {
    "event": "delivered",
    "message": { "headers": { "message-id": "20240101.abc123@mg.yourdomain.com" } },
    "recipient": "buyer@example.com"
  }
}
```

**failed (permanent):**
```json
{
  "signature": { "…" },
  "event-data": {
    "event": "failed",
    "severity": "permanent",
    "reason": "bounce",
    "delivery-status": { "code": 550, "message": "5.1.1 User unknown." },
    "message": { "headers": { "message-id": "20240101.abc123@mg.yourdomain.com" } },
    "recipient": "invalid@example.com"
  }
}
```

**failed (temporary):**
```json
{
  "signature": { "…" },
  "event-data": {
    "event": "failed",
    "severity": "temporary",
    "reason": "generic",
    "delivery-status": { "code": 421, "message": "Try again later", "attempt-no": 3 },
    "message": { "headers": { "message-id": "20240101.abc123@mg.yourdomain.com" } },
    "recipient": "buyer@example.com"
  }
}
```

**complained:**
```json
{
  "signature": { "…" },
  "event-data": {
    "event": "complained",
    "message": { "headers": { "message-id": "20240101.abc123@mg.yourdomain.com" } },
    "recipient": "buyer@example.com"
  }
}
```

## Consequences

### Positive
- `email_status` now reflects actual delivery outcome, not just "Mailgun accepted the message".
- Spam complaints are captured — `COMPLAINED` status signals that the buyer's address should be suppressed from future sends.
- Temporary failures are visible in the audit trail without prematurely marking the document as failed, since Mailgun retries them internally.
- The angle-bracket normalisation fix (`<id>` → `id`) is applied at the source (provider), keeping the lookup query simple.

### Negative
- If the webhook is unreachable when Mailgun fires (server down, ngrok not running in dev), Mailgun retries for several hours. If all retries fail, `email_status` stays `SENT` indefinitely — there is no polling fallback.
- `MAILGUN_WEBHOOK_SIGNING_KEY` must be configured and the `/api/mailgun/webhook` URL must be publicly reachable. Misconfiguration silently degrades to no delivery tracking.

### Mitigation
- Mailgun's dashboard (Sending → Logs) remains the authoritative record of delivery events and can be consulted manually when `email_status` seems stale.
- A future polling reconciliation job could query Mailgun's Events API for any `email_message_id` still in `SENT` status after N hours, but this is not implemented now.

### Alternatives Considered
- **Poll Mailgun Events API on a schedule**: More resilient to webhook outages, but adds a background job, Mailgun API calls on every poll cycle, and pagination logic. Webhooks are simpler and sufficient for the current load.
- **Store raw webhook body in a separate table**: Adds storage and schema complexity with no query use case — Mailgun's dashboard already provides the raw event log. Rejected.
- **Use Mailgun's `tag` feature to correlate events**: Would avoid storing `email_message_id` but requires tagging every outgoing message with the access key and filtering on that. More fragile if the tag is missing. `message-id` is always present in the webhook.
