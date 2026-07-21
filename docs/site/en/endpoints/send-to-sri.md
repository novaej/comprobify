# Send to SRI

Queues the signed XML document for submission to the SRI SOAP service. This endpoint is asynchronous — it does not call SRI itself.

```
POST /v1/documents/:accessKey/send
```

The document must be in `SIGNED` status. A successful call immediately moves it to `PENDING_SEND` and returns — it does **not** wait for SRI. A standalone worker process picks up the queued job and calls SRI; the document eventually moves to `RECEIVED` (SRI accepted it for processing) or `RETURNED` (SRI rejected it — rebuild required). Poll [Get Document](get-document.md) or [Get Events](get-events.md) to observe that transition, or rely on the notification/webhook system for the eventual `AUTHORIZED` outcome once you've also called [Check Authorization](check-authorization.md).

If RabbitMQ is briefly unreachable when you call this endpoint, the document still durably moves to `PENDING_SEND` — nothing is lost. A periodic reconciliation job re-queues anything whose dispatch was never confirmed.

## Authentication

`Authorization: Bearer <api-key>` and `X-Issuer-Id: <issuer-id>` (UUID from `GET /v1/issuers`)

## Path parameters

| Parameter | Description |
|---|---|
| `accessKey` | The 49-digit access key of the document to send |

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
  }
}
```

This response only confirms the document was queued — it does not reflect SRI's outcome. Check back later via `GET /v1/documents/:accessKey` to see whether the document reached `RECEIVED` or `RETURNED`. If it's `RETURNED`, correct it with [Rebuild Invoice](rebuild-invoice.md) before sending again.

## Errors

| Code | Status | When |
|---|---|---|
| `BAD_REQUEST` | 400 | `X-Issuer-Id` header missing or malformed |
| `BAD_REQUEST` | 400 | Document is not in `SIGNED` status |
| `UNAUTHORIZED` | 401 | Missing or invalid API key, or environment mismatch (sandbox key targeting a production tenant or vice versa) |
| `FORBIDDEN` | 403 | `X-Issuer-Id` issuer belongs to a different tenant |
| `NOT_FOUND` | 404 | `X-Issuer-Id` issuer does not exist |
| `NOT_FOUND` | 404 | Document not found |

`SRI_SUBMISSION_FAILED` can no longer occur on this endpoint — network/SOAP failures now happen inside the asynchronous worker, after this endpoint has already responded. A failed attempt is recorded as an `ERROR` document event and the document remains eligible for another attempt via the reconciliation job.
