# Webhooks

Register HTTPS callback URLs to receive event notifications in near-real time. When the API creates or updates a notification (e.g. a document is authorized, a certificate is expiring), it immediately POSTs a signed payload to every active endpoint that has subscribed to that event type.

```
POST   /v1/webhooks
GET    /v1/webhooks
PATCH  /v1/webhooks/:id
DELETE /v1/webhooks/:id
```

## Authentication

`Authorization: Bearer <api-key>` — any active key for the tenant.

## Tier limits

| Tier | Max active endpoints |
|---|---|
| FREE | 1 |
| STARTER | 2 |
| GROWTH | 5 |
| BUSINESS | 10 |

---

## Webhook endpoint object

```json
{
  "id": "00000000-0000-0000-0000-000000000001",
  "url":        "https://app.example.com/v1/comprobify/events",
  "eventTypes": ["DOCUMENT_AUTHORIZED", "CERT_EXPIRING"],
  "active":     true,
  "createdAt":  "2026-05-31T10:00:00.000Z",
  "updatedAt":  "2026-05-31T10:00:00.000Z"
}
```

| Field | Type | Description |
|---|---|---|
| `id` | string (UUID) | Stable identifier |
| `url` | string | HTTPS URL the API POSTs events to |
| `eventTypes` | string[] | Subscribed event types. Empty array = subscribe to **all** event types. |
| `active` | boolean | `false` after deregistration; historical deliveries are preserved |
| `createdAt` | string | ISO timestamp of registration |
| `updatedAt` | string | ISO timestamp of last update |

> **Note:** the signing `secret` is never returned after initial registration. Store it immediately on creation.

---

## Register an endpoint

```
POST /v1/webhooks
```

Creates a new webhook endpoint and returns the signing secret. **The secret is shown exactly once** — store it immediately.

### Request body

```json
{
  "url":        "https://app.example.com/v1/comprobify/events",
  "eventTypes": ["DOCUMENT_AUTHORIZED"]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | string | Yes | Must be a valid HTTPS URL |
| `eventTypes` | string[] | No | Event types to subscribe to. Omit or pass `[]` to receive all events. Valid values: `DOCUMENT_AUTHORIZED`, `CERT_EXPIRING`, `CERT_EXPIRED`, `SRI_SUBMISSION_FAILED`, `EMAIL_DELIVERY_FAILED`, `QUOTA_WARNING` |

### Response

**201 Created**

```json
{
  "ok": true,
  "endpoint": {
    "id": "00000000-0000-0000-0000-000000000001",
    "url":        "https://app.example.com/v1/comprobify/events",
    "eventTypes": ["DOCUMENT_AUTHORIZED"],
    "active":     true,
    "createdAt":  "2026-05-31T10:00:00.000Z",
    "updatedAt":  "2026-05-31T10:00:00.000Z"
  },
  "secret": "a3f5c8d1e2b4..."
}
```

Store `secret` securely. It is used to verify the `X-Comprobify-Signature` header on incoming webhook requests.

### Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `url` is not a valid HTTPS URL, or an `eventType` is unrecognised |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `402` | `WEBHOOK_ENDPOINT_LIMIT_REACHED` | Tier limit on active endpoints reached |

---

## List endpoints

```
GET /v1/webhooks
```

Returns all active endpoints for the tenant (signing secrets are never included).

### Response

**200 OK**

```json
{
  "ok": true,
  "endpoints": [ ... ]
}
```

---

## Update an endpoint

```
PATCH /v1/webhooks/:id
```

Update the URL, event subscriptions, or active flag for an existing endpoint. All fields are optional — send only what you want to change.

### Request body

```json
{
  "url":        "https://app.example.com/v1/comprobify/events-v2",
  "eventTypes": ["DOCUMENT_AUTHORIZED", "CERT_EXPIRED"],
  "active":     true
}
```

### Response

**200 OK**

```json
{
  "ok": true,
  "endpoint": { ... }
}
```

### Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | Invalid `url`, unknown `eventType`, or non-boolean `active` |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `404` | `NOT_FOUND` | Endpoint not found or belongs to a different tenant |

---

## Deregister an endpoint

```
DELETE /v1/webhooks/:id
```

Soft-deletes the endpoint (`active = false`). The endpoint stops receiving deliveries immediately. Past delivery records are preserved in `webhook_deliveries` for audit purposes.

### Response

**200 OK**

```json
{ "ok": true }
```

### Errors

| Status | Code | When |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `404` | `NOT_FOUND` | Endpoint not found or belongs to a different tenant |

---

## Receiving webhooks

### Payload format

```json
{
  "event":      "DOCUMENT_AUTHORIZED",
  "deliveryId": "00000000-0000-0000-0000-000000000017",
  "timestamp":  1748649600,
  "tenantId": "00000000-0000-0000-0000-000000000007",
  "data": {
    "id": "00000000-0000-0000-0000-000000000042",
    "type":      "DOCUMENT_AUTHORIZED",
    "severity":  "INFO",
    "title":     "Invoice authorized",
    "message":   "Invoice 001-001-000000012 for ACME Corp was authorized by SRI.",
    "metadata":  { ... },
    "issuerId": "00000000-0000-0000-0000-000000000003",
    "readAt":    null,
    "expiresAt": null,
    "createdAt": "2026-05-28T14:30:00.000Z"
  }
}
```

| Field | Description |
|---|---|
| `event` | The notification type (mirrors `data.type`) |
| `deliveryId` | ID of the `webhook_deliveries` row. Use for deduplication — retried deliveries have the same `deliveryId`. |
| `timestamp` | Unix timestamp (seconds) when the event was originally created |
| `tenantId` | Your tenant ID |
| `data` | Full [notification object](notifications.md#notification-object) |

### Verifying signatures

Every request includes:

```
X-Comprobify-Signature: sha256=<hex>
X-Comprobify-Timestamp: <unix seconds>
```

To verify:

1. Read the raw request body as a string (before JSON parsing).
2. Compute `HMAC-SHA256(secret, "${timestamp}.${rawBody}")` where `secret` is your endpoint's signing secret.
3. Compare the result with the `sha256=` portion of `X-Comprobify-Signature` using a **constant-time** comparison function.
4. Reject the request if the signatures do not match or if `X-Comprobify-Timestamp` is more than 5 minutes in the past.

**Node.js example:**

```js
const crypto = require('crypto');

function verifyWebhook(secret, req) {
  const timestamp = req.headers['x-comprobify-timestamp'];
  const signature = req.headers['x-comprobify-signature'];
  const rawBody   = req.rawBody; // Buffer or string before JSON.parse

  if (!timestamp || !signature) return false;

  // Reject requests older than 5 minutes
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) return false;

  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );
}
```

### Response requirements

Return **any 2xx status** to acknowledge receipt. Any other status (including 3xx) is treated as a failure and triggers a retry.

Process the event **asynchronously** — respond with `200` immediately and handle the payload in a background job to avoid timeouts.

### Deduplication

Use `deliveryId` to deduplicate. A retry of the same delivery has the same `deliveryId` but arrives in a new HTTP request. Your handler should be **idempotent**: processing the same `deliveryId` twice must produce the same outcome.

### Retry schedule

| Attempt | Timing |
|---|---|
| 1 | Immediately on event creation |
| 2 | 30 seconds after attempt 1 fails |
| 3 | 2 minutes after attempt 2 fails |
| FAILED | After 3 failed attempts — no further retries |

If all retries are exhausted, use `GET /v1/notifications?sinceId=<lastId>` to catch up on missed events.
