# Check Authorization

Queries the SRI for the authorization result of a previously submitted document.

```
GET /v1/documents/:accessKey/authorize
```

The document must be in `RECEIVED` status. On success it moves to `AUTHORIZED`, an email with the RIDE PDF and signed XML is automatically sent to the buyer's email address, and a `DOCUMENT_AUTHORIZED` notification is created — which fires a webhook to any registered endpoint subscribed to that event type (see [Webhooks](webhooks.md)). If SRI did not authorize it, the document moves to `NOT_AUTHORIZED` and must be rebuilt.

## Authentication

`Authorization: Bearer <api-key>` and `X-Issuer-Id: <issuer-id>` (numeric id from `GET /v1/issuers`)

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
| `BAD_REQUEST` | 400 | `X-Issuer-Id` header missing or malformed |
| `BAD_REQUEST` | 400 | Document is not in `RECEIVED` status |
| `UNAUTHORIZED` | 401 | Missing or invalid API key, or environment mismatch (sandbox key targeting a production tenant or vice versa) |
| `FORBIDDEN` | 403 | `X-Issuer-Id` issuer belongs to a different tenant |
| `ACCOUNT_SUSPENDED` | 403 | Tenant account is suspended — unlike most other document read endpoints (list, get, RIDE, XML, events, credit-notes), this one stays blocked while suspended because it makes a live SRI call and can send the authorization email; see the [error catalogue](../errors/index.md) |
| `NOT_FOUND` | 404 | `X-Issuer-Id` issuer does not exist |
| `NOT_FOUND` | 404 | Document not found |
| `SRI_SUBMISSION_FAILED` | 502 | Network error communicating with SRI |
