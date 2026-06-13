# Mailgun Webhook

The Mailgun webhook is an inbound endpoint that Mailgun calls to report email delivery events. It updates the `email_status` on documents and verification emails so the API has an accurate delivery audit trail.

```
POST /api/mailgun/webhook
```

This endpoint is **not called by your application** — it is registered with Mailgun so that Mailgun calls it automatically when a delivery event occurs.

---

## Mailgun setup

In your Mailgun dashboard, go to **Sending → Webhooks** for your domain and register the following URL:

```
https://<your-api-host>/api/mailgun/webhook
```

Enable exactly these three event types:

| Event | Purpose |
|---|---|
| `delivered` | Marks `email_status` as `DELIVERED` |
| `failed` | Permanent failure → `FAILED`; temporary failure → logged but Mailgun retries automatically |
| `complained` | Spam report → `COMPLAINED` |

Other event types (opened, clicked, unsubscribed, etc.) are ignored by the handler — there is no harm in enabling them, but they produce no effect.

> **One webhook per environment.** Staging and production use separate Mailgun domains. Register the webhook on each domain pointing to the corresponding environment's URL.

---

## Security

Every request is verified with HMAC-SHA256 using the `MAILGUN_WEBHOOK_SIGNING_KEY` environment variable (found in Mailgun → Webhooks → Signing key). Requests that fail signature verification are rejected with `401`.

The handler also rejects replayed requests (duplicate timestamps). No action is needed on the caller side — this is transparent Mailgun behaviour.

---

## Event handling

| Mailgun event | Severity | Outcome |
|---|---|---|
| `delivered` | — | `email_status` → `DELIVERED`, event `EMAIL_DELIVERED` appended |
| `failed` | `permanent` | `email_status` → `FAILED`, event `EMAIL_FAILED` appended |
| `failed` | `temporary` | status unchanged (Mailgun retries), event `EMAIL_TEMP_FAILED` appended |
| `complained` | — | `email_status` → `COMPLAINED`, event `EMAIL_COMPLAINED` appended |

Both invoice emails and tenant verification emails are tracked through this endpoint. Lookup is by `email_message_id`, which is stored on each document and tenant row when the email is sent.

---

## Response

The endpoint always returns `200 OK` with `{ "ok": true }` for recognised events. Mailgun treats any non-2xx response as a failure and retries.
