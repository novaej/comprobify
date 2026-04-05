# Mailgun Webhook

Receives email delivery events from Mailgun and updates the document's `email_status`.

```
POST /api/mailgun/webhook
```

This endpoint is called by Mailgun, not by your application. Register it in your Mailgun dashboard under **Sending → Webhooks**.

## Authentication

Requests are verified with HMAC-SHA256 using `MAILGUN_WEBHOOK_SIGNING_KEY` from your Mailgun dashboard (Sending → Webhooks → Webhook signing key). Requests with an invalid or missing signature return `401`. Requests older than 5 minutes are rejected to prevent replay attacks.

## Events handled

| Mailgun event | Severity | `email_status` result |
|---|---|---|
| `delivered` | — | `DELIVERED` |
| `failed` | `permanent` | `FAILED` |
| `failed` | `temporary` | Unchanged (Mailgun retries automatically) |
| `complained` | — | `COMPLAINED` |

## Setup

1. In your Mailgun dashboard go to **Sending → Webhooks**
2. Add a new webhook URL: `https://your-deployment.com/api/mailgun/webhook`
3. Select the events: `delivered`, `failed`, `complained`
4. Copy the **Webhook signing key** and set it as `MAILGUN_WEBHOOK_SIGNING_KEY` in your environment

## Response

Mailgun expects a `200 OK` on success. Any other status causes Mailgun to retry delivery of the webhook.

```json
{ "ok": true }
```
