# Notifications

Tenant-level alerts surfaced to users of the system. The API produces two categories of notifications:

- **Event-driven** — created automatically when something happens (e.g. a document is authorized by SRI).
- **Scheduled** — created or updated by the API's own background job (e.g. certificate expiry). No consumer action required.

```
GET   /v1/notifications
POST  /v1/notifications/:id/read
GET   /v1/notifications/preferences
PATCH /v1/notifications/preferences
```

See [Webhooks](webhooks.md) for registering callback URLs that receive notifications in near-real time. Polling this endpoint with `?sinceId=` is the fallback for consumers that cannot expose a public HTTPS callback URL.

## Authentication

`Authorization: Bearer <api-key>` — any active key for the tenant. No `X-Issuer-Id` required by default; supply it to scope results to a specific issuer (see [Issuer filter](#issuer-filter)).

---

## Notification object

All list and single-notification responses use the same shape:

```json
{
  "id":        42,
  "type":      "DOCUMENT_AUTHORIZED",
  "severity":  "INFO",
  "title":     "Invoice authorized",
  "message":   "Invoice 001-001-000000012 for ACME Corp was authorized by SRI.",
  "metadata":  { "accessKey": "...", "sequential": "001-001-000000012", "total": "118.00" },
  "issuerId":  3,
  "readAt":    null,
  "expiresAt": null,
  "createdAt": "2026-05-28T14:30:00.000Z"
}
```

| Field | Type | Description |
|---|---|---|
| `id` | integer | Stable identifier. Use it to deduplicate across polls and track per-user read state. |
| `type` | string | Machine-readable type code — see [Notification types](#notification-types). |
| `severity` | string | `INFO` · `WARNING` · `ERROR` |
| `title` | string | Short human-readable headline. |
| `message` | string | Full human-readable description. |
| `metadata` | object\|null | Type-specific structured data (see [Notification types](#notification-types)). |
| `issuerId` | integer\|null | The issuer this notification concerns, or `null` for tenant-level alerts. |
| `readAt` | string\|null | ISO timestamp when the notification was marked read, or `null` if still unread. |
| `expiresAt` | string\|null | ISO timestamp after which the notification should be hidden, or `null` if it never expires. |
| `createdAt` | string | ISO timestamp of creation. |

---

## Notification types

### `DOCUMENT_AUTHORIZED`

Created automatically (fire-and-forget) inside `GET /:accessKey/authorize` when SRI confirms authorization. Multiple authorizations within a 60-second window are **aggregated into a single row** to avoid flooding the list during batch processing. The same notification `id` may have an updated `count` on successive polls within that window — the frontend should upsert by `id` rather than append.

A webhook payload is fired for each update to the aggregated row (including count increments).

**Severity:** `INFO`

**Metadata:**

```json
{
  "documents": [
    {
      "accessKey": "...",
      "sequential": "001-001-000000012",
      "buyerName": "ACME Corp",
      "buyerId": "0901234567001",
      "total": "118.00",
      "issueDate": "2026-05-28",
      "authorizationNumber": "2605202615..."
    }
  ],
  "count": 5
}
```

`documents` is capped at 50 entries when a batch is large; `count` always reflects the true total.

---

### `CERT_EXPIRING`

Created or updated by the API scheduler job when an issuer's certificate is within 30 days of its `notAfter` date. At most **one unread row per issuer** — the same row is updated in place on successive job runs (days remaining refreshes, severity may escalate). Auto-dismissed when the certificate is renewed and has > 30 days remaining.

**Severity:** `WARNING` (> 7 days) · `ERROR` (≤ 7 days)

**Metadata:**

```json
{
  "issuerId": 3,
  "certExpiry": "2026-06-15T00:00:00.000Z",
  "daysRemaining": 18,
  "branchCode": "001",
  "issuePointCode": "001"
}
```

---

### `CERT_EXPIRED`

Same conditions as `CERT_EXPIRING` but for a certificate whose `notAfter` date has already passed.

**Severity:** `ERROR`  
**Metadata:** same shape as `CERT_EXPIRING`, with `daysRemaining: 0`.

---

### Reserved types

The following types are defined in the schema and accepted by the preferences endpoint, but not yet produced by the API. They are reserved for future implementation:

| Type | Description |
|---|---|
| `SRI_SUBMISSION_FAILED` | SRI permanently rejected a document submission |
| `EMAIL_DELIVERY_FAILED` | Mailgun reported a permanent delivery failure |
| `QUOTA_WARNING` | Tenant is approaching their document quota |

---

## List notifications

```
GET /v1/notifications
```

Returns active (unexpired) notifications for the tenant, newest first. Both read and unread are included. Use `readAt` to decide what to show as new.

### Query parameters

| Parameter | Type | Description |
|---|---|---|
| `sinceId` | integer | Optional. When provided, returns only notifications with `id > sinceId`. Use for efficient catch-up polling: store the highest `id` seen on each poll and pass it on the next request. |

### Issuer filter

Supply `X-Issuer-Id: <id>` to restrict results to a specific issuer. When the header is present, the response includes:

- Notifications whose `issuerId` matches the supplied value.
- Tenant-level notifications (`issuerId: null`), such as future quota warnings.

Omit the header to receive all notifications across every issuer (useful for admin or overview pages).

### Response

**200 OK**

```json
{
  "notifications": [ ... ],
  "unreadCount": 3
}
```

### Errors

| Status | Code | When |
|---|---|---|
| `400` | `ISSUER_ID_INVALID` | `X-Issuer-Id` header is present but not a valid positive integer |
| `400` | `ISSUER_ID_INVALID` | `sinceId` is present but not a valid positive integer |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |

---

## Mark as read

```
POST /v1/notifications/:id/read
```

Marks a single notification as read (`readAt` is set to now). The notification is excluded from `unreadCount` on all subsequent polls.

**When to call:** the frontend manages per-user read state in its own database. It calls this endpoint only when **every user** with access to the notification has marked it read on their side. After this call the notification is considered globally read and will no longer appear in `unreadCount`.

### Path parameters

| Parameter | Description |
|---|---|
| `id` | Numeric notification id |

### Response

**200 OK**

```json
{
  "notification": { ... }
}
```

### Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `id` is not a positive integer |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `404` | `NOT_FOUND` | Notification does not exist, belongs to a different tenant, or is already read |

---

## Get preferences

```
GET /v1/notifications/preferences
```

Returns the notification preference for every type. Types the tenant has never explicitly configured default to `enabled: true` (opt-out model).

### Response

**200 OK**

```json
{
  "preferences": [
    { "type": "DOCUMENT_AUTHORIZED",   "enabled": true  },
    { "type": "CERT_EXPIRING",         "enabled": true  },
    { "type": "CERT_EXPIRED",          "enabled": true  },
    { "type": "SRI_SUBMISSION_FAILED", "enabled": true  },
    { "type": "EMAIL_DELIVERY_FAILED", "enabled": true  },
    { "type": "QUOTA_WARNING",         "enabled": true  }
  ]
}
```

---

## Update preferences

```
PATCH /v1/notifications/preferences
```

Bulk-upsert one or more preferences. Send only the types you want to change; unmentioned types are unchanged.

### Request body

An array of preference objects:

```json
[
  { "type": "DOCUMENT_AUTHORIZED", "enabled": false }
]
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | Yes | One of the valid notification types |
| `enabled` | boolean | Yes | `true` to enable, `false` to suppress |

When `enabled` is `false` for a type, the API will not create new notifications of that type for the tenant. Existing unread notifications of that type remain in the table and can still be marked as read.

### Response

**200 OK** — same shape as `GET /v1/notifications/preferences`, reflecting the full updated state.

### Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | Body is not an array, or an entry has an invalid `type` or non-boolean `enabled` |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |

---

## Recommended integration pattern

```
┌─────────────────────────────────────────────────────────────────────┐
│  Consumer backend (e.g. Next.js)                                    │
│                                                                     │
│  Primary (near-real-time):                                          │
│    Register a webhook endpoint → receive events via POST callback   │
│    Verify X-Comprobify-Signature on each incoming request           │
│                                                                     │
│  Fallback / catch-up:                                               │
│    Poll GET /v1/notifications?sinceId=<lastSeenId> every 60s       │
│    Store highest id seen → pass as sinceId on next poll             │
│                                                                     │
│  When user opens notification panel:                                │
│    Mark read in frontend DB per user                                │
│    When all users have read → POST /v1/notifications/:id/read      │
└─────────────────────────────────────────────────────────────────────┘
```
