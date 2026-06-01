# ADR-015: Notification and Webhook System

**Status:** Accepted  
**Date:** 2026-05-31 (revised from 2026-05-28)

---

## Context

Consumer systems built on top of this API typically have their own user management layer. Users need to be alerted to events that originate in the API — a document being authorized by SRI, a signing certificate approaching its expiry date — without having to poll individual document or issuer endpoints.

Two categories of triggering condition exist:

1. **Event-driven**: something happens inside an existing API flow (SRI authorization). A notification should appear as a side effect.
2. **Time-based**: a condition is assessed against current state rather than a triggered event (cert expiry date). This requires a periodic check.

The consumer system may also need **near-real-time delivery** of these events to its own backend — waiting for the next poll interval (even 60 seconds) may be too slow for production workflows that process invoices in real time.

The consumer system also needs to track read/unread state **per user**. This API has no concept of users — authentication is at the tenant level via API keys. Any notification delivery or read-state mechanism therefore needs to interoperate with the consumer's own user model.

---

## Decision

### 1. Dual delivery: webhooks (primary) + polling (fallback)

The system provides two complementary delivery mechanisms:

**Webhooks (primary, near-real-time)**  
The tenant registers one or more HTTPS callback URLs (`POST /api/webhooks`). The API pushes a signed payload to each subscribed endpoint immediately after a notification is created or updated. This is the canonical pattern for server-to-server API integration (Stripe, GitHub, Twilio).

**Polling (fallback / catch-up)**  
The consumer backend polls `GET /api/notifications?sinceId=<id>` on a schedule. The `sinceId` cursor lets it catch up efficiently after any downtime without re-processing already-seen notifications.

These mechanisms are independent. The consumer may use webhooks only, polling only, or both together for maximum reliability.

### 2. Event-driven notifications: inline, fire-and-forget

`DOCUMENT_AUTHORIZED` notifications are created inside `document-transmission.service.checkAuthorization()` immediately after SRI confirms authorization. The call is fire-and-forget (`.catch(err => console.warn(...))`): a failure to create the notification must never affect the HTTP response.

Immediately after the notification row is created, the webhook delivery service fans the event out to all active, subscribed endpoints (also fire-and-forget, failures logged and swallowed).

### 3. Batch aggregation for `DOCUMENT_AUTHORIZED`

A batch process that authorizes 100 invoices in quick succession would otherwise flood the notification list. Within a 60-second aggregation window, all `DOCUMENT_AUTHORIZED` events for the same issuer are merged into a single notification row:

- First authorization in the window → create row with `count: 1`.
- Subsequent authorizations within the window → update same row (increment `count`, append to `documents` metadata, update `title` and `message`).
- After the window elapses → next authorization starts a new row.

The frontend may see the same notification `id` with an increasing `count` across polls within the window. It must **upsert by `id`** rather than append, to avoid showing duplicate entries.

Webhook payloads are sent for each update to the aggregated row so consumers receive incremental count updates in near-real-time.

### 4. Time-based notifications: API-owned scheduling

Certificate expiry checks and webhook retry processing are handled by a single admin job endpoint:

```
POST /api/admin/jobs/notifications
```

This endpoint is called by an external scheduler (infrastructure cron, monitoring service, etc.) on a regular interval (e.g. every 5 minutes). It:

1. Runs certificate expiry checks for **every non-suspended tenant**.
2. Processes the webhook retry queue.

The consumer never triggers checks — the API owns its own scheduling. This is the correct model for a generic API: consumers should not be responsible for running the API's maintenance tasks.

**Certificate expiry thresholds:**

| Days remaining | Type | Severity |
|---|---|---|
| > 30 | — (auto-dismiss if alert exists) | — |
| 8–30 | `CERT_EXPIRING` | `WARNING` |
| 1–7 | `CERT_EXPIRING` | `ERROR` |
| ≤ 0 | `CERT_EXPIRED` | `ERROR` |

At most one unread cert alert per issuer is maintained — the same row is updated in place to avoid accumulation. When a certificate is renewed, the next job run auto-dismisses the existing alert.

### 5. Webhook delivery: HMAC-signed, with retry

Each outgoing webhook POST is signed with HMAC-SHA256:

```
X-Comprobify-Signature: sha256=<hmac-sha256(secret, "${timestamp}.${body}")>
X-Comprobify-Timestamp: <unix seconds>
```

Consumers should:
1. Reject requests older than 5 minutes (timestamp drift protection).
2. Compute HMAC-SHA256 over `"${timestamp}.${body}"` using the secret.
3. Compare with constant-time equality against the signature header.

**Retry schedule** (after any non-2xx response or network error):

| Attempt | When |
|---|---|
| 1 | Immediate (inline, fire-and-forget) |
| 2 | 30 seconds after attempt 1 |
| 3 | 2 minutes after attempt 2 |
| — | `FAILED` after 3 attempts |

Retries are processed by `POST /api/admin/jobs/notifications`.

**Webhook secrets** are 32-byte random hex strings generated by the API. They are returned **once** at endpoint registration and never again — tenants must store them immediately. Each endpoint has its own secret. If the secret is lost, the tenant must deregister and re-register the endpoint.

**Tier limits** on the number of active webhook endpoints:

| Tier | Max endpoints |
|---|---|
| FREE | 1 |
| STARTER | 2 |
| GROWTH | 5 |
| BUSINESS | 10 |

### 6. Catch-up polling with `sinceId`

`GET /api/notifications?sinceId=<id>` returns only notifications with `id > sinceId`. The consumer should store the highest `id` seen from each poll and pass it on the next request. This efficiently skips already-processed notifications without re-fetching them.

### 7. Per-user read state lives in the consumer

`readAt` on the notifications table is a **tenant-level** flag, not a per-user one. The consumer system maintains a separate `user_notifications` table (or equivalent) that maps `notification.id` to each user and tracks individual read state.

The consumer calls `POST /api/notifications/:id/read` only when **all users** with access to the notification have marked it read on their side. At that point the notification is globally read and excluded from `unreadCount` on future polls.

### 8. Issuer filter via `X-Issuer-Id`

The consumer system knows which issuers a given user can access. `GET /api/notifications` accepts an optional `X-Issuer-Id` header:

- When supplied: returns notifications for that issuer **plus** tenant-level notifications (`issuerId: null`).
- When absent: returns all tenant notifications (for admin or overview pages).

This mirrors the pattern used by all other authenticated endpoints.

### 9. Preferences at tenant level

Notification type preferences (`enabled`/`disabled`) are stored at the tenant level, not per user. This is appropriate because the preference controls whether the API creates notifications at all — it is an operational/admin decision, not a user preference. Per-user notification settings are the consumer's responsibility.

---

## Consequences

- **`POST /api/notifications/sync` is removed.** The consumer no longer triggers cert checks. The admin job endpoint replaces it.
- **`id` stability is guaranteed.** A notification row is never deleted or replaced — only updated in place (aggregation, cert alert refresh) or soft-closed via `read_at`. The consumer can safely use `id` as a stable foreign key in its own `user_notifications` table.
- **Webhook secrets are shown once.** The consumer must record the secret at registration time. If lost, the endpoint must be re-registered to obtain a new secret.
- **Delivery is best-effort with 3 attempts.** If all 3 attempts fail, the event is marked `FAILED` in `webhook_deliveries`. The consumer can detect missed events via the polling fallback (`sinceId`).
- **Single-instance safe.** The retry queue is processed by the admin job, not a background worker. No distributed scheduling concerns. Multiple job invocations are safe (each row is marked before retry, preventing double delivery).
- **Aggregation is per-issuer, not per-tenant.** If a tenant has multiple issuers running parallel batch jobs, each issuer gets its own aggregated notification row.
