# Send to SRI

Submits the signed XML document to the SRI SOAP service.

```
POST /api/documents/:accessKey/send
```

The document must be in `SIGNED` status. After a successful call the document moves to `RECEIVED` (SRI accepted it for processing) or `RETURNED` (SRI rejected it — rebuild required).

## Authentication

`Authorization: Bearer <api-key>`

## Path parameters

| Parameter | Description |
|---|---|
| `accessKey` | The 49-digit access key of the document to send |

## Response

**200 OK**

```json
{
  "ok": true,
  "document": {
    "accessKey": "1503202601179234567800110010010000000011234567810",
    "documentType": "01",
    "sequential": "000000001",
    "status": "RECEIVED",
    "issueDate": "15/03/2026",
    "total": "115.00",
    "email": {
      "status": "PENDING"
    }
  }
}
```

If SRI returns `RETURNED`, the response still has `200 OK` but `status` will be `"RETURNED"`. The document must be corrected with [Rebuild Invoice](rebuild-invoice.md) before resending.

## Errors

| Code | Status | When |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `NOT_FOUND` | 404 | Document not found |
| `BAD_REQUEST` | 400 | Document is not in `SIGNED` status |
| `SRI_SUBMISSION_FAILED` | 502 | Network error communicating with SRI |
