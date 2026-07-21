# Get Document

Retrieves a document by its 49-digit access key.

```
GET /v1/documents/:accessKey
```

## Authentication

`Authorization: Bearer <api-key>` and `X-Issuer-Id: <issuer-id>` (UUID from `GET /v1/issuers`)

## Path parameters

| Parameter | Description |
|---|---|
| `accessKey` | The 49-digit numeric access key returned when the document was created |

## Response

**200 OK**

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
      "status": "DELIVERED",
      "sentAt": "2026-03-15T14:22:05.123Z"
    },
    "requestPayload": { }
  }
}
```

`requestPayload` contains the original request body that was used to create the document. It is omitted when `null`. Use it to pre-fill the [Rebuild Invoice](rebuild-invoice.md) form after a document is rejected.

## Errors

| Code | Status | When |
|---|---|---|
| `BAD_REQUEST` | 400 | `X-Issuer-Id` header missing or malformed |
| `UNAUTHORIZED` | 401 | Missing or invalid API key, or environment mismatch (sandbox key targeting a production tenant or vice versa) |
| `FORBIDDEN` | 403 | `X-Issuer-Id` issuer belongs to a different tenant |
| `NOT_FOUND` | 404 | `X-Issuer-Id` issuer does not exist |
| `NOT_FOUND` | 404 | No document with that access key exists for this issuer |
