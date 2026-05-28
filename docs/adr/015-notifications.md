# ADR-015: In-App Notification System

**Status:** Accepted  
**Date:** 2026-05-28

---

## Context

Consumer systems built on top of this API typically have their own user management layer. Users need to be alerted to events that originate in the API — a document being authorized by SRI, a signing certificate approaching its expiry date — without having to poll individual document or issuer endpoints.

Two categories of triggering condition exist:

1. **Event-driven**: something happens inside an existing API flow (SRI authorization). A notification should appear as a side effect.
2. **Time-based**: a condition is assessed against current state rather than a triggered event (cert expiry date). This requires a periodic check.

The consumer system also needs to track read/unread state **per user**. This API has no concept of users — authentication is at the tenant level via API keys. Any notification delivery or read-state mechanism therefore needs to interoperate with the consumer's own user model.

---

## Decision

### 1. Delivery model: polling, not push

The consumer system (a Next.js application with its own backend) polls `GET /api/notifications` on a configurable interval. The API does not push events to the consumer.

**Reasons:**
- Server-Sent Events require a persistent connection per client tab. Across multiple users and browser tabs, this creates many idle connections on the API server. Since the consumer already has a backend, server-side polling is more efficient — one connection from the BFF, not one per user session.
- WebSockets are bidirectional and heavier than this use case requires.
- Outbound webhooks (API → consumer URL) are designed for server-to-server integration and require the consumer to expose a publicly accessible callback URL. This is the right model for document status events (see NEXT\_STEPS.md item 2) but not for in-app user notifications.

### 2. Event-driven notifications: inline, fire-and-forget

`DOCUMENT_AUTHORIZED` notifications are created inside `document-transmission.service.checkAuthorization()` immediately after SRI confirms authorization. The call is fire-and-forget (`.catch(err => console.warn(...))`): a failure to create the notification must never affect the HTTP response.

### 3. Batch aggregation for `DOCUMENT_AUTHORIZED`

A batch process that authorizes 100 invoices in quick succession would otherwise flood the notification list. Within a 60-second aggregation window, all `DOCUMENT_AUTHORIZED` events for the same issuer are merged into a single notification row:

- First authorization in the window → create row with `count: 1`.
- Subsequent authorizations within the window → update same row (increment `count`, append to `documents` metadata, update `title` and `message`).
- After the window elapses → next authorization starts a new row.

The frontend may see the same notification `id` with an increasing `count` across polls within the window. It must **upsert by `id`** rather than append, to avoid showing duplicate entries.

### 4. Time-based notifications: frontend-driven sync

The consumer backend calls `POST /api/notifications/sync` on a schedule of its choosing (e.g. on login, once daily). This endpoint runs all periodic checks — currently certificate expiry — and returns the updated notification list.

**Certificate expiry thresholds:**

| Days remaining | Type | Severity |
|---|---|---|
| > 30 | — (auto-dismiss if alert exists) | — |
| 8–30 | `CERT_EXPIRING` | `WARNING` |
| 1–7 | `CERT_EXPIRING` | `ERROR` |
| ≤ 0 | `CERT_EXPIRED` | `ERROR` |

At most one unread cert alert per issuer is maintained — the same row is updated in place to avoid accumulation. When a certificate is renewed, the next sync call auto-dismisses the existing alert.

Adding a future check type (quota warning, etc.) requires only a private function in `notification.service.js` and a single call from `runChecksForTenant()`. The endpoint never changes.

### 5. Per-user read state lives in the consumer

`readAt` on the notifications table is a **tenant-level** flag, not a per-user one. The consumer system maintains a separate `user_notifications` table (or equivalent) that maps `notification.id` to each user and tracks individual read state.

The consumer calls `POST /api/notifications/:id/read` only when **all users** with access to the notification have marked it read on their side. At that point the notification is globally read and excluded from `unreadCount` on future polls.

### 6. Issuer filter via `X-Issuer-Id`

The consumer system knows which issuers a given user can access. `GET /api/notifications` and `POST /api/notifications/sync` both accept an optional `X-Issuer-Id` header:

- When supplied: returns notifications for that issuer **plus** tenant-level notifications (`issuer_id IS NULL`).
- When absent: returns all tenant notifications (for admin or overview pages).

This mirrors the pattern used by all other authenticated endpoints.

### 7. Preferences at tenant level

Notification type preferences (`enabled`/`disabled`) are stored at the tenant level, not per user. This is appropriate because the preference controls whether the API creates notifications at all — it is an operational/admin decision, not a user preference. Per-user notification settings are the consumer's responsibility.

---

## Consequences

- **No background jobs in the API.** The cert-expiry check is triggered by the consumer; the API is stateless between requests.
- **`id` stability is guaranteed.** A notification row is never deleted or replaced — only updated in place (aggregation, cert alert refresh) or soft-closed via `read_at`. The consumer can safely use `id` as a stable foreign key.
- **Single-instance safe.** Because there are no background workers, there are no distributed scheduling concerns. The polling model is inherently multi-instance safe.
- **Aggregation is per-issuer, not per-tenant.** If a tenant has multiple issuers running parallel batch jobs, each issuer gets its own aggregated notification row.
- **Future scalability.** If the API ever moves to a multi-instance deployment with a message bus, event-driven notifications can be refactored to publish to the bus and let a separate consumer write notification rows, without changing the API surface.
