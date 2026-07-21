# Check Authorization

Queues an authorization check for a previously submitted document. This endpoint is asynchronous — it does not query SRI itself.

```
GET /v1/documents/:accessKey/authorize
```

The document must be in `RECEIVED` status. A successful call queues the check and returns immediately — it does **not** wait for SRI's response. A standalone worker process picks up the queued job and calls SRI; the document eventually moves to `AUTHORIZED` (an email with the RIDE PDF and signed XML is automatically sent to the buyer's email address, and a `DOCUMENT_AUTHORIZED` notification is created — which fires a webhook to any registered endpoint subscribed to that event type, see [Webhooks](webhooks.md)) or `NOT_AUTHORIZED` (the document must be rebuilt). You don't have to call this endpoint at all to eventually see the transition — a periodic reconciliation job also queues an authorization check for any `RECEIVED` document past a short delay, so the eventual outcome and its notification/webhook still arrive even if no client ever polls.

## Authentication

`Authorization: Bearer <api-key>` and `X-Issuer-Id: <issuer-id>` (UUID from `GET /v1/issuers`)

## Path parameters

| Parameter | Description |
|---|---|
| `accessKey` | The 49-digit access key of the document |

## Response

**202 Accepted** — confirms the check was queued, not the outcome.

```json
{
  "ok": true,
  "document": {
    "accessKey": "1503202601179234567800110010010000000011234567810",
    "documentType": "01",
    "sequential": "000000001",
    "status": "RECEIVED",
    "issueDate": "15/03/2026",
    "total": "115.00"
  }
}
```

`status` here is still `"RECEIVED"` — this response never reflects the authorization outcome. Poll `GET /v1/documents/:accessKey` afterward, or watch for the `DOCUMENT_AUTHORIZED` notification/webhook. If the document ends up `NOT_AUTHORIZED`, use [Rebuild Invoice](rebuild-invoice.md) to correct and resubmit.

## Errors

| Code | Status | When |
|---|---|---|
| `BAD_REQUEST` | 400 | `X-Issuer-Id` header missing or malformed |
| `BAD_REQUEST` | 400 | Document is not in `RECEIVED` status |
| `UNAUTHORIZED` | 401 | Missing or invalid API key, or environment mismatch (sandbox key targeting a production tenant or vice versa) |
| `FORBIDDEN` | 403 | `X-Issuer-Id` issuer belongs to a different tenant |
| `ACCOUNT_SUSPENDED` | 403 | Tenant account is suspended — unlike most other document read endpoints (list, get, RIDE, XML, events, credit-notes), this one stays blocked while suspended because it still results in an SRI call and the authorization email being sent (just asynchronously now, via the worker) — this is "using" the service, not passive viewing; see the [error catalogue](../errors/index.md) |
| `NOT_FOUND` | 404 | `X-Issuer-Id` issuer does not exist |
| `NOT_FOUND` | 404 | Document not found |

`SRI_SUBMISSION_FAILED` can no longer occur on this endpoint — network/SOAP failures now happen inside the asynchronous worker, after this endpoint has already responded. A failed attempt is recorded as an `ERROR` document event and the document remains eligible for another attempt via the reconciliation job.
