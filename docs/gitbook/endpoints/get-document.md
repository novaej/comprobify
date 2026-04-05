# Get Document

Retrieves a document by its 49-digit access key.

```
GET /api/documents/:accessKey
```

## Authentication

`Authorization: Bearer <api-key>`

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
    }
  }
}
```

## Errors

| Code | Status | When |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `NOT_FOUND` | 404 | No document with that access key exists for this issuer |
