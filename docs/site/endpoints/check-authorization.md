# Check Authorization

Queries the SRI for the authorization result of a previously submitted document.

```
GET /api/documents/:accessKey/authorize
```

The document must be in `RECEIVED` status. On success it moves to `AUTHORIZED` and an email with the RIDE PDF and signed XML is automatically sent to the buyer's email address. If SRI did not authorize it, the document moves to `NOT_AUTHORIZED` and must be rebuilt.

## Authentication

`Authorization: Bearer <api-key>`

## Path parameters

| Parameter | Description |
|---|---|
| `accessKey` | The 49-digit access key of the document |

## Response

**200 OK** — authorization result returned regardless of outcome.

```json
{
  "ok": true,
  "document": {
    "accessKey": "1503202601179234567800110010010000000011234567810",
    "documentType": "01",
    "sequential": "000000001",
    "status": "AUTHORIZED",
    "issueDate": "15/03/2026",
    "total": "115.00",
    "authorizationNumber": "1503202601179234567800110010010000000011234567810",
    "authorizationDate": "2026-03-15T14:22:00-05:00",
    "email": {
      "status": "SENT",
      "sentAt": "2026-03-15T14:22:05.123Z"
    }
  }
}
```

If the document was not authorized, `status` will be `"NOT_AUTHORIZED"` and `authorizationNumber` / `authorizationDate` will be absent. Use [Rebuild Invoice](rebuild-invoice.md) to correct and resubmit.

## Errors

| Code | Status | When |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `NOT_FOUND` | 404 | Document not found |
| `BAD_REQUEST` | 400 | Document is not in `RECEIVED` status |
| `SRI_SUBMISSION_FAILED` | 502 | Network error communicating with SRI |
