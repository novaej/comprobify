# Retry All Failed Documents

Bulk variant of [Retry Send/Authorize](retry-send.md) — recovers **every** stuck document for the authenticated tenant in one call, no need to know individual access keys.

```
POST /v1/tenants/retry-failed-documents
```

Unlike the endpoints under `/v1/documents/*`, this one **does not require `X-Issuer-Id`** — it covers every issuer/branch on the tenant in a single call. It's the recommended way to recover from an SRI outage that affected multiple documents across different branches at once, instead of calling [Retry Send/Authorize](retry-send.md) once per document.

Best-effort per document — if re-queueing one fails (e.g. RabbitMQ briefly unreachable), it doesn't stop the rest; that particular document is simply picked up by the next reconciliation cycle instead.

## Authentication

`Authorization: Bearer <api-key>` (no `X-Issuer-Id`)

## Response

**202 Accepted**

```json
{
  "ok": true,
  "retried": 3,
  "effects": [
    { "id": "019fbf85-4751-7a22-82d9-479022d58b0f", "effectType": "SRI_SEND", "status": "PENDING", "attemptCount": 0 },
    { "id": "019fbf9a-1122-7a22-82d9-479022d58b0f", "effectType": "SRI_AUTHORIZE", "status": "PENDING", "attemptCount": 0 }
  ]
}
```

`retried` is how many documents actually had a failed attempt and got re-queued — `0` is a valid response and means there was nothing to recover.

## Errors

| Code | Status | When |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
