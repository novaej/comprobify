# Retry Send/Authorize

Recovers a document whose asynchronous SRI dispatch (send or authorization check) exhausted its 5 automatic attempts and got stuck.

```
POST /v1/documents/:accessKey/send/retry
```

[Send to SRI](send-to-sri.md) and [Check Authorization](check-authorization.md) queue the real work, and a periodic reconciliation job (`POST /v1/admin/jobs/queue-reconciliation`, every 5 minutes) automatically re-publishes it while it stays unconfirmed — up to 5 attempts total (`PENDING_EFFECTS_MAX_ATTEMPTS`). If all 5 are exhausted (e.g. after a prolonged SRI outage), the underlying attempt is permanently marked failed and stops retrying on its own — this endpoint is how you recover it: it resets the attempt counter to zero and re-queues it immediately, without waiting for the next reconciliation cycle.

Works whether the document is stuck in `PENDING_SEND` (the send failed) or `RECEIVED` awaiting authorization (the authorization check failed) — it automatically detects which of the two attempts is the failed one.

## Authentication

`Authorization: Bearer <api-key>` and `X-Issuer-Id: <issuer-id>` (UUID from `GET /v1/issuers`)

## Path parameters

| Parameter | Description |
|---|---|
| `accessKey` | The 49-digit access key of the stuck document |

## Response

**202 Accepted**

```json
{
  "ok": true,
  "document": {
    "accessKey": "1503202601179234567800110010010000000011234567810",
    "documentType": "01",
    "sequential": "000000001",
    "status": "PENDING_SEND",
    "issueDate": "15/03/2026",
    "total": "115.00",
    "email": {
      "status": "PENDING"
    }
  },
  "effect": {
    "id": "019fbf85-4751-7a22-82d9-479022d58b0f",
    "effectType": "SRI_SEND",
    "status": "PENDING",
    "attemptCount": 0
  }
}
```

Same as [Send to SRI](send-to-sri.md), this response only confirms the retry was queued — not SRI's outcome. Check back later via `GET /v1/documents/:accessKey`, or check [Get SRI Responses](get-sri-responses.md) to see whether the new attempt also failed (e.g. with an `HTTP_<code>` status if SRI fails at the transport level again).

## Errors

| Code | Status | When |
|---|---|---|
| `BAD_REQUEST` | 400 | `X-Issuer-Id` header missing or malformed |
| `UNAUTHORIZED` | 401 | Missing or invalid API key, or environment mismatch |
| `FORBIDDEN` | 403 | `X-Issuer-Id` issuer belongs to a different tenant |
| `NOT_FOUND` | 404 | `X-Issuer-Id` issuer does not exist |
| `NOT_FOUND` | 404 | Document not found |
| `NOTHING_TO_RETRY` | 409 | No failed send/authorize attempt exists for this document — it may already be in progress, already completed, or never failed |

To recover several stuck documents at once (e.g. after an SRI outage affecting multiple branches), use [Retry All Failed Documents](retry-failed-documents.md) instead — no `X-Issuer-Id` needed, it covers every issuer on the tenant in one call.
